import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { qstash, appBaseUrl } from "@/lib/qstash";
import { safeEqual } from "@/lib/crypto";

// Google's push-notification receiver for Calendar (FR-10) — same shape as
// app/api/webhooks/drive/route.ts (Calendar's `events.watch` channel
// notifications use the identical `x-goog-*` header set Drive's does).
export async function POST(req: NextRequest) {
  const channelId = req.headers.get("x-goog-channel-id");
  const resourceState = req.headers.get("x-goog-resource-state");
  const channelToken = req.headers.get("x-goog-channel-token");

  if (!channelId || !channelToken) {
    return NextResponse.json({ error: "Missing Google push notification headers" }, { status: 400 });
  }

  const [channel] = await db
    .select()
    .from(schema.webhookChannels)
    .where(and(eq(schema.webhookChannels.channelId, channelId), eq(schema.webhookChannels.surface, "calendar")))
    .limit(1);

  if (!channel || !safeEqual(channel.channelToken, channelToken)) {
    return NextResponse.json({ error: "Unknown or unverified channel" }, { status: 403 });
  }

  // "sync" is Google's initial handshake notification when the channel is
  // first created — not an actual change, nothing to do yet.
  if (resourceState === "sync") {
    return NextResponse.json({ ok: true });
  }

  // Defense in depth — see app/api/webhooks/drive/route.ts's identical check.
  const [connection] = await db
    .select({ autoSyncEnabled: schema.googleConnections.autoSyncEnabled })
    .from(schema.googleConnections)
    .where(eq(schema.googleConnections.id, channel.connectionId))
    .limit(1);
  if (!connection?.autoSyncEnabled) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Auto-sync is off for this connection" });
  }

  const { messageId } = await qstash().publishJSON({
    url: `${appBaseUrl()}/api/jobs/calendar-sync`,
    body: { connectionId: channel.connectionId },
  });

  return NextResponse.json({ ok: true, queued: true, messageId });
}
