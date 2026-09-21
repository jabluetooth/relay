import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { verifiedJob } from "@/lib/qstash";
import { getValidAccessToken } from "@/lib/google/tokens";
import { registerOrRenewDriveWatch, registerOrRenewCalendarWatch } from "@/lib/google/watch";
import { adapters, type Surface } from "@/lib/ingest";
import { persistChunk } from "@/lib/ingest/persist";
import { claimSyncLock, releaseSyncLock } from "@/lib/sync-lock";

const bodySchema = z.object({
  connectionId: z.string().uuid(),
  surface: z.enum(["drive", "gmail", "calendar", "sheets"]),
  config: z.record(z.string(), z.unknown()).optional(),
});

// The actual backfill work — moved here from
// app/api/ingest/backfill/route.ts, which now only publishes this as a
// QStash job instead of running it inline (see that route's own comment).
// verifySignatureAppRouter below means only a request QStash itself signed
// reaches this handler; nothing here re-checks auth on its own.
async function handler(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { connectionId, surface, config } = parsed.data as {
    connectionId: string;
    surface: Surface;
    config?: Record<string, unknown>;
  };

  // Durable dedup guard (lib/sync-lock.ts) — confirmed necessary in
  // practice, not just in theory: QStash delivered this exact job twice
  // for a real ~5-minute Gmail backfill, and both ran concurrently,
  // doubling the real Gmail API call rate and tripping Gmail's own rate
  // quota (see README "Known limitations").
  const claimed = await claimSyncLock(connectionId, surface);
  if (!claimed) {
    // Still a 2xx: this isn't a failure QStash should retry, it's a
    // duplicate delivery of a job already being handled.
    return NextResponse.json({ skipped: true, reason: "A backfill for this connection/surface is already in progress" });
  }

  try {
    const accessToken = await getValidAccessToken(connectionId);
    const adapter = adapters[surface];

    let persisted = 0;
    let skipped = 0;
    try {
      for await (const chunk of adapter.backfill(accessToken, config)) {
        const result = await persistChunk(connectionId, chunk);
        if (result.skipped) skipped++;
        else persisted++;
      }
    } catch (err) {
      await db
        .update(schema.surfaceSync)
        .set({ lastError: (err as Error).message, updatedAt: new Date() })
        .where(and(eq(schema.surfaceSync.connectionId, connectionId), eq(schema.surfaceSync.surface, surface)));
      // A non-2xx status tells QStash to retry per its own backoff policy,
      // rather than a failed backfill being silently swallowed here.
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }

    await db
      .update(schema.surfaceSync)
      .set({ lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(and(eq(schema.surfaceSync.connectionId, connectionId), eq(schema.surfaceSync.surface, surface)));

    if (surface === "drive") {
      // Best-effort: a fresh Drive backfill is the natural point to
      // establish (or re-establish) the push-notification channel (FR-10),
      // since it's exactly when a valid startPageToken cursor is
      // available. Registration failing (e.g. the webhook domain isn't
      // verified with Google yet) shouldn't fail a backfill that otherwise
      // succeeded — freshness sync degrades to "none until this succeeds,"
      // not data loss.
      try {
        await registerOrRenewDriveWatch(connectionId, accessToken);
      } catch (err) {
        console.error(`Drive watch registration failed for connection ${connectionId} (backfill still succeeded):`, err);
      }
    }

    if (surface === "calendar") {
      // Same best-effort reasoning as Drive above.
      try {
        const calendarId = typeof config?.calendarId === "string" ? config.calendarId : "primary";
        await registerOrRenewCalendarWatch(connectionId, accessToken, calendarId);
      } catch (err) {
        console.error(`Calendar watch registration failed for connection ${connectionId} (backfill still succeeded):`, err);
      }
    }

    return NextResponse.json({ persisted, skipped });
  } finally {
    await releaseSyncLock(connectionId, surface);
  }
}

// `url` pins the exact address QStash's signature is checked against;
// without it the SDK falls back to auto-detecting VERCEL_URL, which doesn't
// exist outside a Vercel deployment.
export const POST = verifiedJob(handler, "/api/jobs/backfill");
