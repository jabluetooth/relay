import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { getValidAccessToken } from "@/lib/google/tokens";
import { driveClient, calendarClient } from "@/lib/google/client";
import { SURFACE_SCOPES } from "@/lib/google/scopes";
import { enqueueBackfill } from "@/lib/backfill";
import type { Surface } from "@/lib/ingest/types";

const bodySchema = z.object({ enabled: z.boolean() });

// One unified toggle per connection (see googleConnections.autoSyncEnabled's
// own comment) rather than a separate switch per surface — turning it on
// kicks off an initial sync for every surface this connection actually has
// scope for, then leaves each to its own ongoing mechanism (Drive/Calendar:
// the push channel that backfill's own success path already registers;
// Sheets: rides on Drive's own channel, FR-12; Gmail: the shared polling
// job, gated on this same flag). Turning it off actually stops Drive's AND
// Calendar's push channels with Google (`channels.stop`), not just ignores
// future notifications — a stopped-but-not-told-Google channel would keep
// firing webhooks Google still thinks are wanted. Sheets has no channel of
// its own to stop; it simply stops getting triggered once Drive's does.
export async function POST(req: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { enabled } = parsed.data;

  const [connection] = await db
    .select()
    .from(schema.googleConnections)
    .where(eq(schema.googleConnections.id, connectionId))
    .limit(1);
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  await db
    .update(schema.googleConnections)
    .set({ autoSyncEnabled: enabled, updatedAt: new Date() })
    .where(eq(schema.googleConnections.id, connectionId));

  if (enabled) {
    // Drive is the one surface every connection has by construction —
    // kick off its initial backfill, whose own success path registers the
    // push channel (lib/google/watch.ts) so it stays fresh from then on
    // with no further action here.
    await enqueueBackfill(connectionId, "drive");

    // Calendar needs no FR-6-style opt-in scope the way Gmail does — scope
    // granted is enough to start (PRD §7's own "primary by default").
    if (connection.scopes.includes(SURFACE_SCOPES.calendar)) {
      await enqueueBackfill(connectionId, "calendar");
    }

    // Sheets needs no opt-in scope either — FR-12 rides its ongoing
    // freshness on Drive's own channel, but the initial backfill is its
    // own explicit action, same as every other surface here.
    if (connection.scopes.includes(SURFACE_SCOPES.sheets)) {
      await enqueueBackfill(connectionId, "sheets");
    }

    // Gmail only if scope's actually granted AND a scope (label/date
    // range) has already been configured — FR-6's opt-in requirement
    // applies here exactly as it does to a manual sync; auto-sync can't
    // silently start indexing an inbox nothing was ever configured for.
    if (connection.scopes.includes(SURFACE_SCOPES.gmail)) {
      const [gmailSync] = await db
        .select({ config: schema.surfaceSync.config })
        .from(schema.surfaceSync)
        .where(and(eq(schema.surfaceSync.connectionId, connectionId), eq(schema.surfaceSync.surface, "gmail")))
        .limit(1);
      const config = gmailSync?.config as Record<string, unknown> | undefined;
      if (config && Object.keys(config).length > 0) {
        await enqueueBackfill(connectionId, "gmail", config);
      }
    }
  } else {
    await stopChannelIfAny(connectionId, "drive");
    await stopChannelIfAny(connectionId, "calendar");
  }

  return NextResponse.json({ autoSyncEnabled: enabled });
}

async function stopChannelIfAny(connectionId: string, surface: Surface) {
  const [channel] = await db
    .select()
    .from(schema.webhookChannels)
    .where(and(eq(schema.webhookChannels.connectionId, connectionId), eq(schema.webhookChannels.surface, surface)))
    .limit(1);
  if (!channel) return;

  try {
    const accessToken = await getValidAccessToken(connectionId);
    const requestBody = { id: channel.channelId, resourceId: channel.resourceId };
    if (surface === "drive") {
      await driveClient(accessToken).channels.stop({ requestBody });
    } else {
      await calendarClient(accessToken).channels.stop({ requestBody });
    }
  } catch (err) {
    // Best-effort: an already-expired/already-stopped channel erroring
    // here shouldn't block turning auto-sync off — the DB row is deleted
    // regardless, which is what stops this app's own webhook receiver from
    // acting on any further deliveries either way.
    console.error(`Failed to stop ${surface} watch channel ${channel.channelId} while disabling auto-sync:`, err);
  }
  await db.delete(schema.webhookChannels).where(eq(schema.webhookChannels.id, channel.id));
}
