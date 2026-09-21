// One-time setup: creates the recurring QStash Schedules this project needs
// (PRD §5 reliability). Safe to re-run — passing the same scheduleId
// updates each schedule in place instead of creating a duplicate.
//
// Run this against a real, public APP_BASE_URL (not localhost) — QStash
// rejects a loopback destination the same way it rejects one for a regular
// publish (see lib/qstash.ts).
import { qstash, appBaseUrl } from "../lib/qstash";

const SCHEDULES = [
  {
    id: "relay-watch-renewal",
    path: "/api/jobs/renew-watch-channels",
    // Every 6 hours — comfortable margin inside the 2h renewal window
    // (lib/google/watch.ts's RENEWAL_WINDOW_MS) against a ~24h channel
    // lifetime. Covers both Drive's and Calendar's push channels.
    cron: "0 */6 * * *",
  },
  {
    id: "relay-gmail-poll",
    path: "/api/jobs/gmail-sync",
    // Every 5 minutes — matches PRD §2.1's own sync-freshness target ("index
    // reflects a source change within 5 minutes, end to end"), which Gmail
    // can only meet by polling that often since FR-11 rules out push
    // notifications here.
    cron: "*/5 * * * *",
  },
];

async function main() {
  for (const s of SCHEDULES) {
    const { scheduleId } = await qstash().schedules.create({
      scheduleId: s.id,
      destination: `${appBaseUrl()}${s.path}`,
      cron: s.cron,
    });
    console.log(`QStash schedule ready: ${scheduleId} (cron: ${s.cron})`);
  }
}

main().catch((err) => {
  console.error("Failed to register QStash schedules:", err);
  process.exit(1);
});
