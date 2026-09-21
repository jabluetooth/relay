import { Client } from "@upstash/qstash";

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
