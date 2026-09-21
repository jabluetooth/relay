import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { verifiedJob } from "@/lib/qstash";
import { getValidAccessToken } from "@/lib/google/tokens";
import { findChannelsDueForRenewal, registerOrRenewDriveWatch, registerOrRenewCalendarWatch } from "@/lib/google/watch";

// Scheduled via a QStash Schedule (see scripts/register-qstash-schedules.mts)
// rather than triggered by any user action — PRD §5's reliability
// requirement is that channels renew "before expiry," which by definition
// can't wait for the next backfill/sync request. Runs periodically well
// inside the ~2h renewal window (lib/google/watch.ts) so a missed run or
// two isn't a real risk of the channel actually lapsing. Renews both
// Drive's and Calendar's channels — the only two surfaces that get a real
// push-notification channel at all (Gmail polls instead, Sheets rides on
// Drive's own channel).
async function handler() {
  const failures: Array<{ connectionId: string; surface: string; error: string }> = [];
  let renewed = 0;

  for (const dueChannel of await findChannelsDueForRenewal("drive")) {
    try {
      const accessToken = await getValidAccessToken(dueChannel.connectionId);
      await registerOrRenewDriveWatch(dueChannel.connectionId, accessToken);
      renewed++;
    } catch (err) {
      failures.push({ connectionId: dueChannel.connectionId, surface: "drive", error: (err as Error).message });
    }
  }

  for (const dueChannel of await findChannelsDueForRenewal("calendar")) {
    try {
      const accessToken = await getValidAccessToken(dueChannel.connectionId);
      const [sync] = await db
        .select({ config: schema.surfaceSync.config })
        .from(schema.surfaceSync)
        .where(and(eq(schema.surfaceSync.connectionId, dueChannel.connectionId), eq(schema.surfaceSync.surface, "calendar")))
        .limit(1);
      const config = sync?.config as Record<string, unknown> | undefined;
      const calendarId = typeof config?.calendarId === "string" ? config.calendarId : "primary";
      await registerOrRenewCalendarWatch(dueChannel.connectionId, accessToken, calendarId);
      renewed++;
    } catch (err) {
      failures.push({ connectionId: dueChannel.connectionId, surface: "calendar", error: (err as Error).message });
    }
  }

  // A partial failure still returns non-2xx so it shows up in QStash's own
  // logs/retries rather than being silently swallowed (PRD §5: "renew
  // before expiry with an alert if a renewal fails silently") — a real
  // Slack/email alert is the next step beyond this, not yet wired up.
  if (failures.length > 0) {
    console.error("Watch channel renewal failures:", failures);
    return NextResponse.json({ renewed, failures }, { status: 500 });
  }

  return NextResponse.json({ renewed });
}

export const POST = verifiedJob(handler, "/api/jobs/renew-watch-channels");
