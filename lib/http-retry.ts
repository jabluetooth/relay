// Bounded retry-with-backoff for transient upstream failures (5xx, network
// errors) — NOT for 4xx client errors, which won't succeed on retry and
// should fail fast instead. Same reliability bar Insight's own changelog
// documents adding after finding its external calls had zero resilience
// against transient failures.

interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  { attempts = 3, baseDelayMs = 500 }: RetryOptions = {}
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, init);
      // Only retry server-side/transient failures. A 4xx (bad request, auth,
      // permissions) means retrying with the same input will just fail
      // again — return it immediately so the caller can surface the real error.
      if (res.ok || res.status < 500) return res;
      lastError = new Error(`HTTP ${res.status}: ${await res.clone().text()}`);
    } catch (err) {
      lastError = err;
    }

    if (attempt < attempts) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
