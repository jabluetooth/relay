import { Client } from "@upstash/qstash";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";

// Background-job publisher (README "Known limitations" / former TODO in
// app/api/ingest/backfill/route.ts): moves ingestion off the synchronous
// request cycle so it doesn't hit a serverless function's duration limit
// against a real, large Drive. `new Client()` with no config reads
// QSTASH_URL/QSTASH_TOKEN from the environment itself.
let client: Client | null = null;
export function qstash(): Client {
  if (!client) {
    if (!process.env.QSTASH_TOKEN) throw new Error("QSTASH_TOKEN is not set — see .env.example");
    client = new Client();
  }
  return client;
}

/** This app's own public base URL, used to build the job callback target QStash delivers to. */
export function appBaseUrl(): string {
  const url = process.env.APP_BASE_URL;
  if (!url) throw new Error("APP_BASE_URL is not set — see .env.example");
  return url;
}

/**
 * Wraps a job handler so only requests QStash itself signed reach it.
 * `verifySignatureAppRouter` throws if the signing keys are missing, and
 * calling it at module scope made every `next build` (which imports each
 * route) require them, so the public site-only deployment could not build.
 * Building the verifier on the first request keeps the same protection —
 * a missing key still fails, closed, on the request — without that.
 */
export function verifiedJob(handler: (req: Request) => Promise<Response>, path: string) {
  let verified: ((req: Request) => Promise<Response>) | null = null;
  return (req: Request): Promise<Response> => {
    verified ??= verifySignatureAppRouter(handler, {
      url: process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL}${path}` : undefined,
    }) as (req: Request) => Promise<Response>;
    return verified(req);
  };
}
