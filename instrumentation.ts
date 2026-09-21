import { startDevServer } from "@upstash/qstash";

// Local-dev-only: starts Upstash's local QStash emulator (env-gated by
// QSTASH_DEV=true in .env.local, see .env.example) before any request is
// handled — including routes that can't start it themselves. This is what
// lets `npm run dev` publish/deliver background jobs against plain
// `http://localhost:3000` with zero public exposure, instead of needing a
// real public URL (a tunnel, or a real deployment) the way the actual
// cloud QStash service requires. No-op in production or when QSTASH_DEV
// isn't set — see lib/qstash.ts and every `verifySignatureAppRouter` call
// for the corresponding read side of this same env var.
export async function register() {
  await startDevServer();
}
