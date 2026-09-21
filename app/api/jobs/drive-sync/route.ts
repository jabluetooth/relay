import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { verifiedJob } from "@/lib/qstash";
import { getValidAccessToken } from "@/lib/google/tokens";
import { driveAdapter } from "@/lib/ingest/drive";
import { sheetsAdapter } from "@/lib/ingest/sheets";
import { persistChunks } from "@/lib/ingest/persist";
import { claimSyncLock, releaseSyncLock } from "@/lib/sync-lock";

const bodySchema = z.object({ connectionId: z.string().uuid() });

// The actual sync work for a Drive push notification — moved here from
// app/api/webhooks/drive/route.ts, which now only verifies the channel
// token and enqueues this job (see that route's own comment). Same
// signature-verified-only access as app/api/jobs/backfill/route.ts, and
// the same durable dedup guard (lib/sync-lock.ts) — Google's own push
// notifications are at-least-once delivery too (FR-9/§5), not just
// QStash's.
async function handler(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { connectionId } = parsed.data;

  const claimed = await claimSyncLock(connectionId, "drive");
  if (!claimed) {
    return NextResponse.json({ skipped: true, reason: "A sync for this connection/surface is already in progress" });
  }

  try {
    const [syncState] = await db
      .select()
      .from(schema.surfaceSync)
      .where(and(eq(schema.surfaceSync.connectionId, connectionId), eq(schema.surfaceSync.surface, "drive")))
      .limit(1);

    const accessToken = await getValidAccessToken(connectionId);
    let persisted = 0;
    let skipped = 0;
    try {
      const { chunks, nextCursor } = await driveAdapter.syncChanges(accessToken, syncState?.cursor ?? null);
      ({ persisted, skipped } = await persistChunks(connectionId, chunks));

      await db
        .update(schema.surfaceSync)
        .set({ cursor: nextCursor, lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(and(eq(schema.surfaceSync.connectionId, connectionId), eq(schema.surfaceSync.surface, "drive")));
    } catch (err) {
      await db
        .update(schema.surfaceSync)
        .set({ lastError: (err as Error).message, updatedAt: new Date() })
        .where(and(eq(schema.surfaceSync.connectionId, connectionId), eq(schema.surfaceSync.surface, "drive")));
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }

    // FR-12: a Sheet is a Drive file, so its freshness rides on this same
    // Drive push notification rather than a channel of its own — only
    // once Sheets has actually been backfilled (a surfaceSync row exists),
    // matching FR-6/FR-7's own "requires an explicit first action" posture
    // for the other surfaces. Best-effort and independently locked: a
    // Sheets sync failing shouldn't fail the Drive sync that triggered it.
    const [sheetsSync] = await db
      .select()
      .from(schema.surfaceSync)
      .where(and(eq(schema.surfaceSync.connectionId, connectionId), eq(schema.surfaceSync.surface, "sheets")))
      .limit(1);
    if (sheetsSync) {
      const claimedSheets = await claimSyncLock(connectionId, "sheets");
      if (claimedSheets) {
        try {
          const { chunks: sheetChunks, nextCursor: sheetsCursor } = await sheetsAdapter.syncChanges(accessToken, sheetsSync.cursor);
          await persistChunks(connectionId, sheetChunks);
          await db
            .update(schema.surfaceSync)
            .set({ cursor: sheetsCursor, lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
            .where(and(eq(schema.surfaceSync.connectionId, connectionId), eq(schema.surfaceSync.surface, "sheets")));
        } catch (err) {
          await db
            .update(schema.surfaceSync)
            .set({ lastError: (err as Error).message, updatedAt: new Date() })
            .where(and(eq(schema.surfaceSync.connectionId, connectionId), eq(schema.surfaceSync.surface, "sheets")));
          console.error(`Sheets sync (triggered by Drive webhook) failed for connection ${connectionId}:`, err);
        } finally {
          await releaseSyncLock(connectionId, "sheets");
        }
      }
    }

    return NextResponse.json({ persisted, skipped });
  } finally {
    await releaseSyncLock(connectionId, "drive");
  }
}

export const POST = verifiedJob(handler, "/api/jobs/drive-sync");
