interface GoogleApiErrorShape {
  code?: number;
  response?: {
    status?: number;
    headers?: Record<string, string>;
    data?: { error?: { errors?: Array<{ reason?: string }> } };
  };
}

// Google API client errors (via gaxios) don't have a single consistent
// shape across every failure path — sometimes the HTTP status lands on
// `.response.status`, sometimes directly on `.code`. Checked in both
// places rather than picking one and guessing wrong. Shared by
// lib/ingest/gmail.ts and lib/ingest/calendar.ts.
export function getGoogleApiErrorStatus(err: unknown): number | undefined {
  const e = err as GoogleApiErrorShape;
  return e?.response?.status ?? e?.code;
}

// A real "Quota exceeded for quota metric ... and limit 'Units per minute
// per user'" (Gmail's Service Usage rate limiting) was observed coming back
// as 429, but Google's older reason-coded quota errors
// (rateLimitExceeded/userRateLimitExceeded/quotaExceeded) return 403
// instead — retrying on 429 alone silently skipped that whole class of
// transient, retry-worthy error. Excludes dailyLimitExceeded on purpose:
// waiting doesn't help a daily cap, so that one should fail fast with a
// clear error instead of burning a retry budget on it.
const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"]);

export function isRateLimitError(err: unknown): boolean {
  const status = getGoogleApiErrorStatus(err);
  if (status === 429) return true;
  if (status !== 403) return false;
  const reason = (err as GoogleApiErrorShape)?.response?.data?.error?.errors?.[0]?.reason;
  return reason !== undefined && RATE_LIMIT_REASONS.has(reason);
}

// Google's 429s for this kind of quota error often carry a `Retry-After`
// header naming exactly how long the window needs — authoritative over a
// guessed backoff when present.
export function getRetryAfterMs(err: unknown): number | undefined {
  const header = (err as GoogleApiErrorShape)?.response?.headers?.["retry-after"];
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}
