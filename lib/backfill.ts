import { qstash, appBaseUrl } from "@/lib/qstash";
import type { Surface } from "@/lib/ingest/types";

/**
 * Publishes a backfill job to QStash (app/api/jobs/backfill/route.ts does
 * the real work). Shared between the manual "Sync now" endpoint
 * (app/api/ingest/backfill/route.ts) and the auto-sync toggle
 * (app/api/connections/[connectionId]/auto-sync/route.ts) so enabling
 * auto-sync and clicking "Sync now" both kick off work the exact same way.
 */
export async function enqueueBackfill(connectionId: string, surface: Surface, config?: Record<string, unknown>) {
  return qstash().publishJSON({
    url: `${appBaseUrl()}/api/jobs/backfill`,
    body: { connectionId, surface, config },
  });
}
