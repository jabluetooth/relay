import { calendarClient } from "@/lib/google/client";
import { getGoogleApiErrorStatus } from "@/lib/google/api-errors";
import { stripHtml } from "@/lib/text";
import type { IngestAdapter, IngestedChunk } from "@/lib/ingest/types";
import type { calendar_v3 } from "@googleapis/calendar";

// M2 scope (PRD §9, FR-7, FR-10). Unlike Gmail, Calendar isn't called out
// in PRD §8 as needing FR-6-style opt-in scoping — it defaults to the
// user's primary calendar with zero configuration required, matching
// FR-7's "primary by default" wording exactly. A different calendar can
// still be targeted via config.calendarId ("user-selected calendar").
export interface CalendarConfig {
  calendarId?: string;
}

function resolveCalendarId(config: Record<string, unknown> | undefined): string {
  return typeof config?.calendarId === "string" ? config.calendarId : "primary";
}

// Calendar's API has no equivalent of Drive's cheap getStartPageToken() —
// establishing a sync watermark means doing a real listing (see
// syncChanges's own comment). Bounding how far back/forward that reaches
// keeps a real, long-lived calendar's history from meaning years of
// recurring-meeting instances get ingested. Deliberate default, not a
// hard limit — override via config if a wider window is ever needed.
const DEFAULT_PAST_DAYS = 90;
const DEFAULT_FUTURE_DAYS = 180;

function defaultWindow(): { timeMin: string; timeMax: string } {
  const now = Date.now();
  return {
    timeMin: new Date(now - DEFAULT_PAST_DAYS * 86_400_000).toISOString(),
    timeMax: new Date(now + DEFAULT_FUTURE_DAYS * 86_400_000).toISOString(),
  };
}

function formatEventTime(dt: calendar_v3.Schema$EventDateTime | undefined): string {
  if (!dt) return "unknown";
  return dt.date ?? dt.dateTime ?? "unknown"; // `date` for all-day events, `dateTime` otherwise
}

/**
 * Cancelled events (status: "cancelled") return null rather than a chunk —
 * same "don't clean up what's already ingested" limitation Drive/Gmail
 * already accept for v1 (a deleted source doesn't retract its old chunks),
 * not a new gap introduced here.
 */
function eventToChunk(event: calendar_v3.Schema$Event): IngestedChunk | null {
  if (!event.id || event.status === "cancelled") return null;

  const summary = event.summary || "(no title)";
  const attendees = (event.attendees ?? [])
    .map((a) => a.displayName || a.email)
    .filter((v): v is string => Boolean(v))
    .join(", ");
  const description = event.description ? stripHtml(event.description) : "";

  const content = [
    `Title: ${summary}`,
    `When: ${formatEventTime(event.start)} to ${formatEventTime(event.end)}`,
    event.location && `Location: ${event.location}`,
    attendees && `Attendees: ${attendees}`,
    description && `Description: ${description}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    sourceId: event.id,
    surface: "calendar",
    title: summary,
    // Calendar hands back a real, ready-made link — unlike Drive/Gmail,
    // nothing needs to be hand-constructed here.
    url: event.htmlLink ?? null,
    content,
    metadata: { start: event.start, end: event.end, status: event.status },
  };
}

async function listEvents(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  params: calendar_v3.Params$Resource$Events$List
): Promise<{ chunks: IngestedChunk[]; nextSyncToken: string | null }> {
  const chunks: IngestedChunk[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  do {
    const { data } = await calendar.events.list({ ...params, calendarId, pageToken });
    for (const event of data.items ?? []) {
      const chunk = eventToChunk(event);
      if (chunk) chunks.push(chunk);
    }
    pageToken = data.nextPageToken ?? undefined;
    if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
  } while (pageToken);

  return { chunks, nextSyncToken };
}

async function* backfill(accessToken: string, config?: Record<string, unknown>): AsyncGenerator<IngestedChunk> {
  const calendarId = resolveCalendarId(config);
  const calendar = calendarClient(accessToken);
  const { timeMin, timeMax } = defaultWindow();

  const { chunks } = await listEvents(calendar, calendarId, { singleEvents: true, maxResults: 250, timeMin, timeMax });
  for (const chunk of chunks) yield chunk;
}

async function syncChanges(
  accessToken: string,
  cursor: string | null,
  config?: Record<string, unknown>
): Promise<{ chunks: IngestedChunk[]; nextCursor: string | null }> {
  const calendarId = resolveCalendarId(config);
  const calendar = calendarClient(accessToken);

  if (!cursor) {
    // Establishing the watermark means doing a real windowed listing
    // identical to backfill()'s own — Calendar has no free-standing
    // "just give me a starting token" call the way Drive's
    // getStartPageToken is. A one-time cost paid once per connection (the
    // first webhook delivery after connecting), not a recurring one: real
    // incremental syncs afterward use the syncToken and only fetch actual
    // deltas.
    const { timeMin, timeMax } = defaultWindow();
    const { nextSyncToken } = await listEvents(calendar, calendarId, { singleEvents: true, maxResults: 250, timeMin, timeMax });
    if (!nextSyncToken) throw new Error("Calendar did not return a nextSyncToken to establish a sync watermark");
    return { chunks: [], nextCursor: nextSyncToken };
  }

  try {
    // Per Google's own docs, timeMin/timeMax/orderBy/q can't be combined
    // with syncToken — incremental sync tracks changes across the whole
    // calendar from here on, not bounded to the original backfill window.
    // Deliberate API behavior, not a bug worked around here: a new event
    // created far outside that original window still needs to be caught.
    // showDeleted must be true with a syncToken (Google rejects false).
    const { chunks, nextSyncToken } = await listEvents(calendar, calendarId, {
      singleEvents: true,
      maxResults: 250,
      syncToken: cursor,
      showDeleted: true,
    });
    return { chunks, nextCursor: nextSyncToken ?? cursor };
  } catch (err) {
    // 410 Gone is Calendar's own "syncToken expired, do a full resync"
    // signal — same role as Gmail's 404 on a stale startHistoryId.
    if (getGoogleApiErrorStatus(err) === 410) {
      throw new Error(
        "Calendar sync token expired (410 Gone) — a fresh backfill is required to re-establish the watermark."
      );
    }
    throw err;
  }
}

export const calendarAdapter: IngestAdapter = {
  surface: "calendar",
  backfill,
  syncChanges,
};
