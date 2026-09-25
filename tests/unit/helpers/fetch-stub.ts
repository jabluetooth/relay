// Scripts globalThis.fetch for one test, recording every request. Each entry
// in `responses` is used once, in order; a function entry can inspect the
// request, and an Error entry is thrown as a network failure.
//
// One dispatcher is installed for the whole test file and each stubFetch()
// call re-scripts it, rather than swapping globalThis.fetch per test: SDK
// clients such as groq-sdk are module-level singletons that capture `fetch`
// when first constructed, and would otherwise keep calling a stale stub.

export interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
  body: unknown;
}

type Scripted = Response | Error | ((url: string, init?: RequestInit) => Response | Promise<Response>);

let active: { responses: Scripted[]; requests: RecordedRequest[] } | null = null;
let installed = false;

function install() {
  if (installed) return;
  installed = true;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!active) throw new Error(`Unexpected fetch to ${url} (no stub active)`);

    let body: unknown = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // Not JSON; keep the raw string.
      }
    }
    active.requests.push({ url, init, body });

    const next = active.responses.shift();
    if (next === undefined) throw new Error(`Unexpected fetch to ${url}`);
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(url, init) : next;
  }) as typeof fetch;
}

export function stubFetch(...responses: Scripted[]) {
  install();
  const script = { responses, requests: [] as RecordedRequest[] };
  active = script;
  return {
    requests: script.requests,
    restore() {
      if (active === script) active = null;
    },
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
