import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { enqueueBackfill } from "@/lib/backfill";
import { validateGmailScope } from "@/lib/ingest/gmail";
import { parseBody } from "@/lib/api";

const bodySchema = z.object({
  connectionId: z.string().uuid(),
  surface: z.enum(["drive", "gmail", "calendar", "sheets"]),
  // Per-surface scope (FR-6 for Gmail: a label and/or date range). Optional
  // on the request — if omitted, whatever was saved from a previous call is
  // reused, so a user doesn't have to re-specify it on every manual sync.
  config: z.record(z.string(), z.unknown()).optional(),
});

// Publishes the actual backfill work to QStash (app/api/jobs/backfill.ts)
// instead of running it inline in this request/response cycle — the
// previous synchronous version was fine for local dev but risked hitting a
// serverless function's duration limit against a real, large Drive/mailbox
// (see README "Known limitations"). QStash handles retry/backoff on
// failure on its own; this route's job now is just validating, resolving
// scope, and enqueueing.
export async function POST(req: NextRequest) {
  const body = await parseBody(req, bodySchema);
  if (body.error) return body.error;
  const { connectionId, surface } = body.data;
  let config = body.data.config;

  const [connection] = await db
    .select({ id: schema.googleConnections.id })
    .from(schema.googleConnections)
    .where(eq(schema.googleConnections.id, connectionId))
    .limit(1);

  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  if (surface === "gmail") {
    if (!config) {
      const [existing] = await db
        .select({ config: schema.surfaceSync.config })
        .from(schema.surfaceSync)
        .where(and(eq(schema.surfaceSync.connectionId, connectionId), eq(schema.surfaceSync.surface, "gmail")))
        .limit(1);
      config = existing?.config as Record<string, unknown> | undefined;
    }
    // Validated here, synchronously, for fast feedback — without this, an
    // unscoped Gmail request would enqueue successfully and only fail once
    // the job actually ran, with no faster way to tell the requester why.
    try {
      validateGmailScope(config);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }

  if (config) {
    await db
      .insert(schema.surfaceSync)
      .values({ connectionId, surface, config })
      .onConflictDoUpdate({
        target: [schema.surfaceSync.connectionId, schema.surfaceSync.surface],
        set: { config, updatedAt: new Date() },
      });
  }

  const { messageId } = await enqueueBackfill(connectionId, surface, config);

  return NextResponse.json({ queued: true, messageId }, { status: 202 });
}
