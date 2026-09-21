import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { qstash, appBaseUrl } from "@/lib/qstash";

// Google's push-notification receiver for Drive (FR-10). Google expects a
// fast 2xx ack — the channel token is verified synchronously (that check
// IS the security boundary and has to stay inline), but the actual sync
// work is now enqueued as a QStash job (app/api/jobs/drive-sync.ts) instead
// of running here, so this handler stays fast regardless of how much
// changed. See README "Known limitations" for the prior synchronous version.
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
    .where(and(eq(schema.webhookChannels.channelId, channelId), eq(schema.webhookChannels.surface, "drive")))
    .limit(1);

  if (!channel || channel.channelToken !== channelToken) {
    // Reject unverified notifications outright rather than trusting the
    // channel id alone (FR-10's whole point).
    return NextResponse.json({ error: "Unknown or unverified channel" }, { status: 403 });
  }

  // "sync" is Google's initial handshake notification when the channel is
  // first created — not an actual change, nothing to do yet.
  if (resourceState === "sync") {
    return NextResponse.json({ ok: true });
  }

  // Defense in depth: turning auto-sync off calls channels.stop() with
  // Google and deletes this row (app/api/connections/[connectionId]/auto-sync/route.ts),
  // so this shouldn't normally be reachable with auto-sync off — but a
  // notification already in flight when it was turned off could still land
  // here. Ack without doing anything rather than syncing content nobody
  // asked to keep fresh anymore.
  const [connection] = await db
    .select({ autoSyncEnabled: schema.googleConnections.autoSyncEnabled })
    .from(schema.googleConnections)
    .where(eq(schema.googleConnections.id, channel.connectionId))
    .limit(1);
  if (!connection?.autoSyncEnabled) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Auto-sync is off for this connection" });
  }

  const { messageId } = await qstash().publishJSON({
    url: `${appBaseUrl()}/api/jobs/drive-sync`,
    body: { connectionId: channel.connectionId },
  });

  return NextResponse.json({ ok: true, queued: true, messageId });
}
