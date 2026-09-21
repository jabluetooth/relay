// A failing API route (database down, unhandled exception) answers with a
// 500 and an EMPTY body, so a bare `await res.json()` throws "Unexpected
// end of JSON input" and the whole page dies in an overlay. This reads the
// body as text first, tolerates an empty or non-JSON one, and turns any
// non-2xx into a plain Error with a message a page can actually show.
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();

  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON (an HTML error page, say). Treated the same as no body.
    }
  }

  if (!res.ok) {
    const message = (body as { error?: unknown } | null)?.error;
    throw new Error(typeof message === "string" ? message : `The server returned ${res.status}.`);
  }
  return body as T;
}

export const SERVER_DOWN_HINT =
  "Relay couldn't reach its data. If you run it locally, check that Postgres and Qdrant are up (Docker Desktop running?).";
