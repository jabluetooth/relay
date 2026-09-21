import { createHash } from "crypto";
import { gmailClient } from "@/lib/google/client";
import { isRateLimitError, getRetryAfterMs, getGoogleApiErrorStatus } from "@/lib/google/api-errors";
import { stripHtml } from "@/lib/text";
import type { IngestAdapter, IngestedChunk } from "@/lib/ingest/types";
import type { gmail_v1 } from "@googleapis/gmail";

// M2 scope (PRD §9, FR-6, FR-11). Gmail is the highest-risk untrusted-content
// surface this project ingests (FR-14) — real inbox content, someone else's
// wording, forwarded/quoted text that could carry a planted prompt
// injection. Two things follow directly from that and from FR-6's own
// "opt-in scoping" requirement (PRD §8: real personal email is sensitive,
// this app doesn't index everything by default):
//   1. `validateGmailScope` refuses to backfill/sync at all without an
//      explicit label and/or date range configured — there's no
//      "everything" default to silently fall back to.
//   2. Incremental sync (FR-11) polls via `history.list` rather than a
//      push-notification channel — a Pub/Sub topic would force a future
//      multi-tenant user through GCP project setup just to connect Gmail
//      (documented tradeoff, PRD §6).

export interface GmailScope {
  /**
   * A Gmail label ID, not its display name — `history.list`'s own `labelId`
   * param only accepts an ID, so backfill uses the same ID (via
   * `messages.list`'s `labelIds`) to keep both paths scoped identically.
   * Built-in labels (INBOX, IMPORTANT, SENT, ...) use that same string as
   * their ID; a custom label's ID looks like "Label_123" — see
   * GET /api/ingest/gmail/labels for the real list on a given connection.
   */
  labelId?: string;
  /** Gmail search date syntax, e.g. "2026/01/01". Backfill-only — see syncChanges's own comment on why an ongoing poll doesn't re-apply this. */
  after?: string;
  before?: string;
}

// These values are spliced into a Gmail search string ("after:2026/01/01"), so
// they are checked against the exact shape Gmail expects instead of being
// trusted: a free-form string could otherwise smuggle in extra search
// operators (from:, has:, -label:) and quietly widen or redirect what gets
// indexed from the mailbox.
const GMAIL_DATE = /^\d{4}\/\d{2}\/\d{2}$/;
const GMAIL_LABEL_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function validateGmailScope(config: Record<string, unknown> | undefined): GmailScope {
  const labelId = typeof config?.labelId === "string" && config.labelId ? config.labelId : undefined;
  const after = typeof config?.after === "string" && config.after ? config.after : undefined;
  const before = typeof config?.before === "string" && config.before ? config.before : undefined;

  if (labelId && !GMAIL_LABEL_ID.test(labelId)) throw new Error("Invalid Gmail label id.");
  if (after && !GMAIL_DATE.test(after)) throw new Error("Invalid \"after\" date; expected YYYY/MM/DD.");
  if (before && !GMAIL_DATE.test(before)) throw new Error("Invalid \"before\" date; expected YYYY/MM/DD.");

  if (!labelId && !after && !before) {
    throw new Error(
      "Gmail ingestion requires an explicit scope (a label and/or date range) configured first — see FR-6. Real inbox content isn't indexed by default."
    );
  }
  return { labelId, after, before };
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// Gmail's per-user quota is a short rolling window, not just a generous
// daily cap — confirmed in practice, not assumed: a real ~211-message
// sequential backfill tripped "Units per minute per user" (root cause
// traced to a QStash duplicate-delivery bug, since fixed in
// app/api/jobs/backfill/route.ts, that briefly doubled the real call
// rate). A brief pause and retry clears a transient rate-limit error
// rather than failing the whole backfill/sync outright.
//
// Two real gaps found after that fix, from a genuine "Quota exceeded for
// quota metric 'Total Query Cost' and limit 'Units per minute per user'"
// error that didn't clear on its own within a job run:
//   1. `isRateLimitError` (not a bare `=== 429` check) — Google's
//      Service-Usage quota errors (this one) come back as 429, but the
//      older reason-coded ones (userRateLimitExceeded, etc.) come back as
//      403. Checking only 429 silently never retried that second class.
//   2. The backoff ceiling was 8s over 5 attempts (~15s total) — nowhere
//      near enough headroom to clear a *per-minute* quota window if it was
//      already exhausted when the first attempt landed. Raised to a 32s
//      ceiling over 6 attempts (~62s total, deliberately just past a full
//      minute), and a `Retry-After` header, when Google sends one, wins
//      over the guessed backoff.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const maxAttempts = 6;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= maxAttempts) throw err;
      const delayMs = getRetryAfterMs(err) ?? Math.min(2 ** attempt * 1000, 32000) + Math.random() * 500;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

/** Depth-first search for a text/plain part; falls back to text/html with tags stripped. */
function extractBodyText(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const text = extractBodyText(child);
    if (text) return text;
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return stripHtml(decodeBase64Url(part.body.data));
  }
  return "";
}

async function fetchMessageChunk(gmail: gmail_v1.Gmail, messageId: string): Promise<IngestedChunk | null> {
  const { data } = await withRetry(() => gmail.users.messages.get({ userId: "me", id: messageId, format: "full" }));
  const headers = data.payload?.headers;
  const subject = getHeader(headers, "Subject") || "(no subject)";
  const from = getHeader(headers, "From");
  const bodyText = extractBodyText(data.payload);

  // FR-6 asks for subject, snippet, AND body — snippet is folded in only as
  // a fallback rather than always appended: it's a truncated preview of the
  // same body text, so embedding both when the real body extracted fine
  // would just be redundant noise, not additional coverage. It still
  // guarantees a message with no cleanly extractable body doesn't get
  // silently dropped instead of ingested with at least a preview.
  const content = [`Subject: ${subject}`, from && `From: ${from}`, bodyText || data.snippet || ""]
    .filter(Boolean)
    .join("\n");
  if (!content.trim()) return null;

  return {
    sourceId: messageId,
    surface: "gmail",
    title: subject,
    // #all/ rather than #inbox/ — works regardless of which label(s) the
    // message actually carries, since a scoped label might not be INBOX.
    url: `https://mail.google.com/mail/u/0/#all/${messageId}`,
    content,
    metadata: {
      threadId: data.threadId,
      labelIds: data.labelIds,
      internalDate: data.internalDate,
      contentHash: hashContent(content),
    },
  };
}

async function* backfill(accessToken: string, config?: Record<string, unknown>): AsyncGenerator<IngestedChunk> {
  const scope = validateGmailScope(config);
  const gmail = gmailClient(accessToken);

  const dateParts: string[] = [];
  if (scope.after) dateParts.push(`after:${scope.after}`);
  if (scope.before) dateParts.push(`before:${scope.before}`);

  let pageToken: string | undefined;
  do {
    const { data } = await withRetry(() =>
      gmail.users.messages.list({
        userId: "me",
        labelIds: scope.labelId ? [scope.labelId] : undefined,
        q: dateParts.length > 0 ? dateParts.join(" ") : undefined,
        maxResults: 100,
        pageToken,
      })
    );

    for (const message of data.messages ?? []) {
      if (!message.id) continue;
      const chunk = await fetchMessageChunk(gmail, message.id);
      if (chunk) yield chunk;
    }

    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
}

async function syncChanges(
  accessToken: string,
  cursor: string | null,
  config?: Record<string, unknown>
): Promise<{ chunks: IngestedChunk[]; nextCursor: string | null }> {
  const scope = validateGmailScope(config);
  const gmail = gmailClient(accessToken);

  if (!cursor) {
    // First call establishes the watermark — mirrors driveAdapter.syncChanges's
    // own "no cursor yet" handshake rather than re-running a full backfill
    // here. A caller that wants the existing scoped mail indexed still needs
    // to call backfill() itself first; this only marks "start watching from now."
    const { data } = await withRetry(() => gmail.users.getProfile({ userId: "me" }));
    if (!data.historyId) throw new Error("Gmail did not return a historyId to establish a sync watermark");
    return { chunks: [], nextCursor: data.historyId };
  }

  const chunks: IngestedChunk[] = [];
  let pageToken: string | undefined;
  let nextCursor = cursor;

  try {
    do {
      const { data } = await withRetry(() =>
        gmail.users.history.list({
          userId: "me",
          startHistoryId: cursor,
          historyTypes: ["messageAdded"],
          // history.list only takes one labelId (no date filter at all) —
          // the date-range half of scope only ever bounded the initial
          // backfill import; an ongoing poll is inherently forward-looking,
          // so there's no "before" to re-apply and no "after" left to enforce
          // once we're already polling from a cursor newer than it.
          labelId: scope.labelId,
          pageToken,
        })
      );

      for (const record of data.history ?? []) {
        for (const added of record.messagesAdded ?? []) {
          const messageId = added.message?.id;
          if (!messageId) continue;
          const chunk = await fetchMessageChunk(gmail, messageId);
          if (chunk) chunks.push(chunk);
        }
      }

      pageToken = data.nextPageToken ?? undefined;
      if (data.historyId) nextCursor = data.historyId;
    } while (pageToken);
  } catch (err) {
    // A startHistoryId older than Gmail's own retention window (about a
    // week, per Google's docs) 404s rather than returning an empty diff —
    // that's a real "go do a full resync" signal, not a transient failure.
    if (getGoogleApiErrorStatus(err) === 404) {
      throw new Error(
        "Gmail history cursor is stale (history is only retained for about a week) — a fresh backfill is required to re-establish the watermark."
      );
    }
    // A real bug found in practice: a rate-limit error that survives
    // `withRetry`'s own backoff used to discard this entire call's progress
    // — cursor included — so the *next* poll restarted from the exact same
    // stale cursor and reprocessed an identical (or, days later, larger)
    // backlog, guaranteeing it tripped the same per-minute quota again.
    // Confirmed against a real account stuck failing every 5-minute poll
    // for 4 straight days this way. `nextCursor` only ever advances above
    // once every message in a page has been fetched (see the loop above),
    // so if it moved past the original `cursor` at all, at least one full
    // page is safely committable — return that partial progress instead of
    // throwing it away, so each poll converges closer to caught-up instead
    // of retrying the same growing backlog forever. Zero progress (the
    // very first page already failed) still throws, same as before.
    if (isRateLimitError(err) && nextCursor !== cursor) {
      return { chunks, nextCursor };
    }
    throw err;
  }

  return { chunks, nextCursor };
}

export const gmailAdapter: IngestAdapter = {
  surface: "gmail",
  backfill,
  syncChanges,
};
