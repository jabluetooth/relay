import { NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getValidAccessToken } from "@/lib/google/tokens";
import { gmailAdapter } from "@/lib/ingest/gmail";
import { persistChunks } from "@/lib/ingest/persist";
import { claimSyncLock, releaseSyncLock } from "@/lib/sync-lock";

// Scheduled via a QStash Schedule (scripts/register-qstash-schedules.mts),
// same shape as app/api/jobs/renew-drive-watch/route.ts — Gmail has no
// push-notification channel to react to (FR-11's documented tradeoff), so
// polling is the only way freshness happens at all here. The schedule
// itself is permanent, always-firing infrastructure; `autoSyncEnabled`
// (joined in below) is the per-connection opt-in this actually respects —
// a connection with a Gmail scope configured but auto-sync off is
// deliberately skipped, not synced anyway. Iterates every connection
// rather than being told which one: v1 is single-tenant (PRD §2.2) so in
// practice this is 0 or 1 rows, and this avoids having to register/manage
// a schedule per connection.
async function handler() {
  const rows = await db
    .select({
      id: schema.surfaceSync.id,
      connectionId: schema.surfaceSync.connectionId,
      cursor: schema.surfaceSync.cursor,
      config: schema.surfaceSync.config,
    })
    .from(schema.surfaceSync)
    .innerJoin(schema.googleConnections, eq(schema.surfaceSync.connectionId, schema.googleConnections.id))
    .where(and(eq(schema.surfaceSync.surface, "gmail"), eq(schema.googleConnections.autoSyncEnabled, true)));

  const results: Array<{ connectionId: string; persisted?: number; skipped?: number; error?: string }> = [];

  for (const row of rows) {
    const config = row.config as Record<string, unknown>;
    // No scope saved yet (surfaceSync row exists from an earlier attempt
    // that failed validation, or from before scope was ever set) — nothing
    // to poll for. Not an error, just nothing to do this row.
    if (!config || Object.keys(config).length === 0) continue;

    // Durable dedup guard (lib/sync-lock.ts) — the 5-minute poll cadence
    // (scripts/register-qstash-schedules.mts) can outlast a slow poll on a
    // very active inbox, same class of bug that let a Gmail backfill run
    // twice concurrently and trip Gmail's own rate quota.
    const claimed = await claimSyncLock(row.connectionId, "gmail");
    if (!claimed) {
      results.push({ connectionId: row.connectionId, skipped: 0, persisted: 0 });
      continue;
    }

    try {
      const accessToken = await getValidAccessToken(row.connectionId);
      const { chunks, nextCursor } = await gmailAdapter.syncChanges(accessToken, row.cursor, config);
      const { persisted, skipped } = await persistChunks(row.connectionId, chunks);

      await db
        .update(schema.surfaceSync)
        .set({ cursor: nextCursor, lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(schema.surfaceSync.id, row.id));

      results.push({ connectionId: row.connectionId, persisted, skipped });
    } catch (err) {
      await db
        .update(schema.surfaceSync)
        .set({ lastError: (err as Error).message, updatedAt: new Date() })
        .where(eq(schema.surfaceSync.id, row.id));
      results.push({ connectionId: row.connectionId, error: (err as Error).message });
    } finally {
      await releaseSyncLock(row.connectionId, "gmail");
    }
  }

  const hasFailures = results.some((r) => r.error);
  return NextResponse.json({ results }, { status: hasFailures ? 500 : 200 });
}

export const POST = verifySignatureAppRouter(handler, {
  url: process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL}/api/jobs/gmail-sync` : undefined,
});
