import { randomBytes, randomUUID } from "crypto";
import { eq, and, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { driveClient, calendarClient } from "@/lib/google/client";
import { appBaseUrl } from "@/lib/qstash";
import type { Surface } from "@/lib/ingest/types";

// Drive push-notification channel registration (FR-10, PRD §5 reliability:
// "renew push channels before expiry"). Verified against real Google
// infrastructure through a temporary ngrok tunnel: an arbitrary,
// non-domain-verified HTTPS address worked fine for `changes.watch` — no
// Search Console verification step turned out to be required in practice,
// despite that being a real requirement for some other Google push-notification
// setups. What DID need fixing empirically: omitting `expiration` below got
// a channel silently capped to just 1 hour, not the ~24h documented as the
// default — requesting it explicitly gets the real ~24h lifetime (confirmed:
// 23:59:58 granted). Worth knowing if this behavior differs by API/account
// again in the future — don't assume, check what Google actually returns.
//
// Uses `changes.watch`, not `files.watch` — the latter only watches a
// single file's metadata, not Drive's own change feed. This also reuses
// the exact "establish a startPageToken" call driveAdapter.syncChanges()
// makes when it has no cursor yet, so the channel's start point and the
// app's own sync cursor are never inconsistent with each other.
export async function registerOrRenewDriveWatch(connectionId: string, accessToken: string): Promise<void> {
  const drive = driveClient(accessToken);

  const [existing] = await db
    .select()
    .from(schema.webhookChannels)
    .where(and(eq(schema.webhookChannels.connectionId, connectionId), eq(schema.webhookChannels.surface, "drive")))
    .limit(1);

  if (existing) {
    // Google channels can't be edited in place — stop the old one first.
    // Best-effort: an already-expired or already-stopped channel returning
    // an error here shouldn't block creating its replacement.
    try {
      await drive.channels.stop({ requestBody: { id: existing.channelId, resourceId: existing.resourceId } });
    } catch (err) {
      console.error(`Failed to stop old Drive watch channel ${existing.channelId} (continuing anyway):`, err);
    }
    await db.delete(schema.webhookChannels).where(eq(schema.webhookChannels.id, existing.id));
  }

  const { data: tokenData } = await drive.changes.getStartPageToken({});
  const pageToken = tokenData.startPageToken;
  if (!pageToken) throw new Error("Drive did not return a startPageToken for changes.watch");

  const channelId = randomUUID();
  const channelToken = randomBytes(24).toString("base64url");

  const { data: channel } = await drive.changes.watch({
    pageToken,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: `${appBaseUrl()}/api/webhooks/drive`,
      token: channelToken,
      // Explicit, even though Google's docs describe 24h as the default:
      // observed empirically (against this app's real, unverified webhook
      // domain) that omitting this got a channel capped to just 1 hour,
      // not 24 — worth requesting the longer lifetime explicitly and
      // finding out whether Google actually grants it or silently caps it
      // anyway, rather than assuming the docs' default applies here.
      expiration: String(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  if (!channel.resourceId || !channel.expiration) {
    throw new Error("Drive changes.watch response missing resourceId/expiration");
  }

  await db.insert(schema.webhookChannels).values({
    connectionId,
    surface: "drive",
    channelId,
    resourceId: channel.resourceId,
    channelToken,
    // Google returns `expiration` as a Unix ms timestamp encoded as a string.
    expiresAt: new Date(Number(channel.expiration)),
  });
}

// Calendar's push channel — simpler to set up than Drive's in one way (no
// getStartPageToken-equivalent prerequisite call needed before
// events.watch) but doesn't itself produce anything usable for content
// sync: the actual incremental-sync watermark (a syncToken) only comes
// from calendarAdapter.syncChanges's own listing call, not from this
// channel-registration step. This function's only job is telling Google
// where to send notifications; lib/ingest/calendar.ts's syncChanges owns
// the sync-token lifecycle entirely separately.
export async function registerOrRenewCalendarWatch(connectionId: string, accessToken: string, calendarId: string): Promise<void> {
  const calendar = calendarClient(accessToken);

  const [existing] = await db
    .select()
    .from(schema.webhookChannels)
    .where(and(eq(schema.webhookChannels.connectionId, connectionId), eq(schema.webhookChannels.surface, "calendar")))
    .limit(1);

  if (existing) {
    try {
      await calendar.channels.stop({ requestBody: { id: existing.channelId, resourceId: existing.resourceId } });
    } catch (err) {
      console.error(`Failed to stop old Calendar watch channel ${existing.channelId} (continuing anyway):`, err);
    }
    await db.delete(schema.webhookChannels).where(eq(schema.webhookChannels.id, existing.id));
  }

  const channelId = randomUUID();
  const channelToken = randomBytes(24).toString("base64url");

  const { data: channel } = await calendar.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: `${appBaseUrl()}/api/webhooks/calendar`,
      token: channelToken,
      // Same lesson learned from Drive's watch — request the lifetime
      // explicitly rather than trusting an undocumented default.
      expiration: String(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  if (!channel.resourceId || !channel.expiration) {
    throw new Error("Calendar events.watch response missing resourceId/expiration");
  }

  await db.insert(schema.webhookChannels).values({
    connectionId,
    surface: "calendar",
    channelId,
    resourceId: channel.resourceId,
    channelToken,
    expiresAt: new Date(Number(channel.expiration)),
  });
}

/** Watch channels (any surface) expiring within this window are due for renewal. */
const RENEWAL_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours — well inside a ~24h channel lifetime.

export async function findChannelsDueForRenewal(surface: Surface) {
  return db
    .select()
    .from(schema.webhookChannels)
    .where(and(eq(schema.webhookChannels.surface, surface), lt(schema.webhookChannels.expiresAt, new Date(Date.now() + RENEWAL_WINDOW_MS))));
}
