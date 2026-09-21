import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { verifiedJob } from "@/lib/qstash";
import { getValidAccessToken } from "@/lib/google/tokens";
import { calendarAdapter } from "@/lib/ingest/calendar";
import { persistChunks } from "@/lib/ingest/persist";
import { claimSyncLock, releaseSyncLock } from "@/lib/sync-lock";

const bodySchema = z.object({ connectionId: z.string().uuid() });

// The actual sync work for a Calendar push notification — same shape as
// app/api/jobs/drive-sync/route.ts.
async function handler(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { connectionId } = parsed.data;

  const claimed = await claimSyncLock(connectionId, "calendar");
  if (!claimed) {
    return NextResponse.json({ skipped: true, reason: "A sync for this connection/surface is already in progress" });
  }

  try {
    const [syncState] = await db
      .select()
      .from(schema.surfaceSync)
      .where(and(eq(schema.surfaceSync.connectionId, connectionId), eq(schema.surfaceSync.surface, "calendar")))
      .limit(1);

    const accessToken = await getValidAccessToken(connectionId);
    const config = (syncState?.config as Record<string, unknown>) ?? {};
    let persisted = 0;
    let skipped = 0;
    try {
      const { chunks, nextCursor } = await calendarAdapter.syncChanges(accessToken, syncState?.cursor ?? null, config);
      ({ persisted, skipped } = await persistChunks(connectionId, chunks));

      await db
        .update(schema.surfaceSync)
        .set({ cursor: nextCursor, lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(and(eq(schema.surfaceSync.connectionId, connectionId), eq(schema.surfaceSync.surface, "calendar")));
    } catch (err) {
      await db
        .update(schema.surfaceSync)
        .set({ lastError: (err as Error).message, updatedAt: new Date() })
        .where(and(eq(schema.surfaceSync.connectionId, connectionId), eq(schema.surfaceSync.surface, "calendar")));
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }

    return NextResponse.json({ persisted, skipped });
  } finally {
    await releaseSyncLock(connectionId, "calendar");
  }
}

export const POST = verifiedJob(handler, "/api/jobs/calendar-sync");
