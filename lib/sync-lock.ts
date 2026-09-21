import { sql, eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Surface } from "@/lib/ingest/types";

// Generous upper bound past any real observed run (~5 minutes for a
// 211-message Gmail backfill) — long enough that a lock this old almost
// certainly means a crashed job left it dangling, not one genuinely still
// running, so a later attempt isn't blocked forever by a stuck lock.
const STALE_AFTER_MS = 20 * 60 * 1000;

/**
 * Atomically claims the sync lock for (connectionId, surface): succeeds
 * unless another job already holds a fresh lock. Durable (Postgres-backed
 * via `surface_sync.sync_started_at`), not an in-process Set — survives a
 * server restart and works across multiple instances, closing the exact
 * gap that let QStash's at-least-once delivery run the same ~5-minute
 * Gmail backfill twice concurrently and trip Gmail's own rate quota (see
 * README "Known limitations"). Doubles as the signal the connections UI
 * polls to show a real "Syncing…" state instead of the instant, misleading
 * flash a fire-and-forget 202 response gives on its own.
 */
export async function claimSyncLock(connectionId: string, surface: Surface): Promise<boolean> {
  const rows = await db.execute(sql`
    insert into surface_sync (connection_id, surface, sync_started_at, updated_at)
    values (${connectionId}, ${surface}, now(), now())
    on conflict (connection_id, surface) do update
      set sync_started_at = now(), updated_at = now()
      where surface_sync.sync_started_at is null
         or surface_sync.sync_started_at < now() - (${STALE_AFTER_MS}::text || ' milliseconds')::interval
    returning id
  `);
  return rows.length > 0;
}

/** Releases the lock — call in a `finally` so a thrown error still clears it. */
export async function releaseSyncLock(connectionId: string, surface: Surface): Promise<void> {
  await db
    .update(schema.surfaceSync)
    .set({ syncStartedAt: null })
    .where(and(eq(schema.surfaceSync.connectionId, connectionId), eq(schema.surfaceSync.surface, surface)));
}
