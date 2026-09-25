// Ingestion adapters (Gmail, Calendar, Sheets, Drive) against scripted fake
// Google API clients. No network and no Google account: lib/google/client.ts
// and the PDF extractor are replaced with module mocks.
import assert from "node:assert/strict";
import { describe, it, mock, beforeEach } from "node:test";
import { mockModule } from "./helpers/fake-db";
import type { IngestedChunk } from "../../lib/ingest/types";

// Each test sets the fakes it needs; the mocked client factories hand them out.
const fakes: Record<string, unknown> = {};
const clientCalls: Array<{ api: string; method: string; params: Record<string, unknown> }> = [];

/** Records every call as { api, method, params } and returns what `impl` says. */
function recorder(api: string, method: string, impl: (params: Record<string, unknown>) => unknown) {
  return async (params: Record<string, unknown> = {}) => {
    clientCalls.push({ api, method, params });
    return impl(params);
  };
}

mockModule("lib/google/client.ts", {
    gmailClient: () => fakes.gmail,
    calendarClient: () => fakes.calendar,
    sheetsClient: () => fakes.sheets,
    driveClient: () => fakes.drive,
    docsClient: () => fakes.docs,
  });
const pdfText = mock.fn<(data: Uint8Array) => Promise<string>>(async () => "Extracted PDF text");
mockModule("lib/ingest/pdf.ts", { extractPdfText: pdfText });

const { gmailAdapter } = await import("../../lib/ingest/gmail");
const { calendarAdapter } = await import("../../lib/ingest/calendar");
const { sheetsAdapter } = await import("../../lib/ingest/sheets");
const { driveAdapter } = await import("../../lib/ingest/drive");

async function collect(gen: AsyncGenerator<IngestedChunk>): Promise<IngestedChunk[]> {
  const out: IngestedChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const callsOf = (method: string) => clientCalls.filter((c) => c.method === method);

beforeEach(() => {
  for (const k of Object.keys(fakes)) delete fakes[k];
  clientCalls.length = 0;
  pdfText.mock.resetCalls();
});

// ---------------------------------------------------------------- Gmail

function gmailMessage(id: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { data: { id, threadId: `t-${id}`, labelIds: ["INBOX"], payload, ...extra } };
}
const headers = (subject?: string, from?: string) => [
  ...(subject !== undefined ? [{ name: "Subject", value: subject }] : []),
  ...(from ? [{ name: "From", value: from }] : []),
];

function fakeGmail(opts: {
  pages?: Array<{ messages: Array<{ id: string }>; nextPageToken?: string }>;
  messages?: Record<string, unknown>;
  history?: Array<unknown | Error>;
  profile?: unknown;
  getErrors?: unknown[];
}) {
  const pages = [...(opts.pages ?? [])];
  const history = [...(opts.history ?? [])];
  const getErrors = [...(opts.getErrors ?? [])];
  fakes.gmail = {
    users: {
      messages: {
        list: recorder("gmail", "messages.list", () => ({ data: pages.shift() ?? { messages: [] } })),
        get: recorder("gmail", "messages.get", (p) => {
          if (getErrors.length > 0) throw getErrors.shift();
          return opts.messages?.[p.id as string];
        }),
      },
      getProfile: recorder("gmail", "getProfile", () => ({ data: opts.profile })),
      history: {
        list: recorder("gmail", "history.list", () => {
          const next = history.shift();
          if (next instanceof Error || (next && typeof next === "object" && "response" in next)) throw next;
          return { data: next };
        }),
      },
    },
  };
}

describe("Gmail adapter (lib/ingest/gmail.ts)", () => {
  it("refuses to backfill without an explicit label or date scope (opt-in only)", async () => {
    fakeGmail({});
    await assert.rejects(collect(gmailAdapter.backfill("tok", {})), /explicit scope/);
    assert.equal(clientCalls.length, 0, "no Gmail call should happen before the scope check");
  });

  it("turns the scope into a label filter and a date query", async () => {
    fakeGmail({ pages: [{ messages: [] }] });
    await collect(gmailAdapter.backfill("tok", { labelId: "Label_7", after: "2026/01/01", before: "2026/02/01" }));
    const [list] = callsOf("messages.list");
    assert.deepEqual(list.params.labelIds, ["Label_7"]);
    assert.equal(list.params.q, "after:2026/01/01 before:2026/02/01");
  });

  it("follows pagination until Gmail stops returning a page token", async () => {
    const msg = gmailMessage("m", { mimeType: "text/plain", headers: headers("S"), body: { data: b64("body") } });
    fakeGmail({
      pages: [{ messages: [{ id: "a" }], nextPageToken: "p2" }, { messages: [{ id: "b" }] }],
      messages: { a: msg, b: msg },
    });
    const chunks = await collect(gmailAdapter.backfill("tok", { labelId: "INBOX" }));
    assert.equal(chunks.length, 2);
    assert.equal(callsOf("messages.list")[1].params.pageToken, "p2");
  });

  it("prefers the text/plain part of a nested multipart message", async () => {
    fakeGmail({
      pages: [{ messages: [{ id: "m1" }] }],
      messages: {
        m1: gmailMessage("m1", {
          mimeType: "multipart/mixed",
          headers: headers("Invoice 42", "Ana <ana@example.com>"),
          parts: [
            {
              mimeType: "multipart/alternative",
              parts: [
                { mimeType: "text/html", body: { data: b64("<p>HTML version</p>") } },
                { mimeType: "text/plain", body: { data: b64("Plain version") } },
              ],
            },
          ],
        }),
      },
    });
    const [chunk] = await collect(gmailAdapter.backfill("tok", { labelId: "INBOX" }));
    assert.equal(chunk.content, "Subject: Invoice 42\nFrom: Ana <ana@example.com>\nPlain version");
    assert.equal(chunk.surface, "gmail");
    assert.equal(chunk.sourceId, "m1");
    assert.equal(chunk.url, "https://mail.google.com/mail/u/0/#all/m1");
    assert.match(String(chunk.metadata.contentHash), /^[0-9a-f]{64}$/);
  });

  it("falls back to stripped HTML, then to the snippet, and names subjectless mail", async () => {
    fakeGmail({
      pages: [{ messages: [{ id: "h" }, { id: "s" }] }],
      messages: {
        h: gmailMessage("h", { mimeType: "text/html", headers: headers("Hi"), body: { data: b64("<b>Bold</b> text") } }),
        s: gmailMessage("s", { mimeType: "multipart/mixed", headers: headers(), parts: [] }, { snippet: "Preview only" }),
      },
    });
    const [html, snippet] = await collect(gmailAdapter.backfill("tok", { labelId: "INBOX" }));
    assert.equal(html.content, "Subject: Hi\nBold text");
    assert.equal(snippet.title, "(no subject)");
    assert.match(snippet.content, /Preview only$/);
  });

  it("waits and retries a rate-limited message fetch instead of failing the backfill", async () => {
    const rateLimited = { code: 429, response: { status: 429, headers: { "retry-after": "0" } } };
    fakeGmail({
      pages: [{ messages: [{ id: "m" }] }],
      messages: { m: gmailMessage("m", { mimeType: "text/plain", headers: headers("S"), body: { data: b64("x") } }) },
      getErrors: [rateLimited, rateLimited],
    });
    const chunks = await collect(gmailAdapter.backfill("tok", { labelId: "INBOX" }));
    assert.equal(chunks.length, 1);
    assert.equal(callsOf("messages.get").length, 3);
  });

  it("does not burn retries on a daily-cap 403", async () => {
    const daily = { response: { status: 403, data: { error: { errors: [{ reason: "dailyLimitExceeded" }] } } } };
    fakeGmail({ pages: [{ messages: [{ id: "m" }] }], getErrors: [daily] });
    await assert.rejects(collect(gmailAdapter.backfill("tok", { labelId: "INBOX" })));
    assert.equal(callsOf("messages.get").length, 1);
  });

  it("establishes a history watermark on the first sync without indexing anything", async () => {
    fakeGmail({ profile: { historyId: "h-100" } });
    assert.deepEqual(await gmailAdapter.syncChanges("tok", null, { labelId: "INBOX" }), { chunks: [], nextCursor: "h-100" });
  });

  it("fails clearly if Gmail returns no historyId to start from", async () => {
    fakeGmail({ profile: {} });
    await assert.rejects(gmailAdapter.syncChanges("tok", null, { labelId: "INBOX" }), /historyId/);
  });

  it("indexes messages added since the cursor and advances it", async () => {
    fakeGmail({
      history: [
        { history: [{ messagesAdded: [{ message: { id: "n1" } }, { message: {} }] }], historyId: "h-200" },
      ],
      messages: { n1: gmailMessage("n1", { mimeType: "text/plain", headers: headers("New"), body: { data: b64("hello") } }) },
    });
    const res = await gmailAdapter.syncChanges("tok", "h-100", { labelId: "INBOX" });
    assert.equal(res.chunks.length, 1);
    assert.equal(res.nextCursor, "h-200");
    const [h] = callsOf("history.list");
    assert.equal(h.params.startHistoryId, "h-100");
    assert.equal(h.params.labelId, "INBOX");
  });

  it("turns a stale history cursor (404) into a clear 'resync required' error", async () => {
    fakeGmail({ history: [{ response: { status: 404 } }] });
    await assert.rejects(gmailAdapter.syncChanges("tok", "old", { labelId: "INBOX" }), /stale/);
  });

  it("keeps partial progress when a rate limit outlasts the retries mid-sync", async () => {
    const rateLimited = { response: { status: 429, headers: { "retry-after": "0" } } };
    fakeGmail({
      history: [
        { history: [{ messagesAdded: [{ message: { id: "a" } }] }], historyId: "h-150", nextPageToken: "pg2" },
        ...Array.from({ length: 6 }, () => rateLimited),
      ],
      messages: { a: gmailMessage("a", { mimeType: "text/plain", headers: headers("A"), body: { data: b64("a") } }) },
    });
    const res = await gmailAdapter.syncChanges("tok", "h-100", { labelId: "INBOX" });
    assert.equal(res.nextCursor, "h-150", "the cursor should move past the page that finished");
    assert.equal(res.chunks.length, 1);
  });

  it("still throws a rate limit that hit before any progress was made", async () => {
    const rateLimited = { response: { status: 429, headers: { "retry-after": "0" } } };
    fakeGmail({ history: Array.from({ length: 6 }, () => rateLimited) });
    await assert.rejects(gmailAdapter.syncChanges("tok", "h-100", { labelId: "INBOX" }));
  });
});

// ------------------------------------------------------------- Calendar

function fakeCalendar(pages: Array<unknown | Error>) {
  const queue = [...pages];
  fakes.calendar = {
    events: {
      list: recorder("calendar", "events.list", () => {
        const next = queue.shift();
        if (next && typeof next === "object" && ("code" in next || "response" in next)) throw next;
        return { data: next ?? { items: [] } };
      }),
    },
  };
}

describe("Calendar adapter (lib/ingest/calendar.ts)", () => {
  it("turns an event into a readable fact with time, place, attendees and cleaned description", async () => {
    fakeCalendar([
      {
        items: [
          {
            id: "e1",
            summary: "Pivotly screening",
            htmlLink: "https://calendar.google.com/event?eid=e1",
            start: { dateTime: "2026-10-01T09:00:00+08:00" },
            end: { dateTime: "2026-10-01T09:30:00+08:00" },
            location: "Google Meet",
            attendees: [{ displayName: "Keith Rufo" }, { email: "hr@example.com" }, {}],
            description: "<p>Bring your <b>portfolio</b></p>",
          },
        ],
      },
    ]);
    const [chunk] = await collect(calendarAdapter.backfill("tok"));
    assert.equal(
      chunk.content,
      [
        "Title: Pivotly screening",
        "When: 2026-10-01T09:00:00+08:00 to 2026-10-01T09:30:00+08:00",
        "Location: Google Meet",
        "Attendees: Keith Rufo, hr@example.com",
        "Description: Bring your portfolio",
      ].join("\n"),
    );
    assert.equal(chunk.url, "https://calendar.google.com/event?eid=e1");
  });

  it("uses the date of an all-day event and skips cancelled or id-less events", async () => {
    fakeCalendar([
      {
        items: [
          { id: "a", start: { date: "2026-12-25" }, end: { date: "2026-12-26" } },
          { id: "c", status: "cancelled", summary: "Gone" },
          { summary: "No id" },
        ],
      },
    ]);
    const chunks = await collect(calendarAdapter.backfill("tok"));
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].title, "(no title)");
    assert.match(chunks[0].content, /When: 2026-12-25 to 2026-12-26/);
  });

  it("defaults to the primary calendar inside a bounded -90/+180 day window", async () => {
    fakeCalendar([{ items: [] }]);
    await collect(calendarAdapter.backfill("tok"));
    const [call] = callsOf("events.list");
    assert.equal(call.params.calendarId, "primary");
    const days = (iso: unknown) => (new Date(String(iso)).getTime() - Date.now()) / 86_400_000;
    assert.ok(Math.abs(days(call.params.timeMin) + 90) < 0.01);
    assert.ok(Math.abs(days(call.params.timeMax) - 180) < 0.01);
    assert.equal(call.params.singleEvents, true);
  });

  it("uses a configured calendar id instead of primary", async () => {
    fakeCalendar([{ items: [] }]);
    await collect(calendarAdapter.backfill("tok", { calendarId: "team@group.calendar.google.com" }));
    assert.equal(callsOf("events.list")[0].params.calendarId, "team@group.calendar.google.com");
  });

  it("establishes a sync token on the first sync without indexing anything", async () => {
    fakeCalendar([{ items: [{ id: "x" }], nextPageToken: "p2" }, { items: [], nextSyncToken: "sync-1" }]);
    assert.deepEqual(await calendarAdapter.syncChanges("tok", null), { chunks: [], nextCursor: "sync-1" });
  });

  it("syncs incrementally with the sync token, showing deletions as Google requires", async () => {
    fakeCalendar([{ items: [{ id: "n", summary: "New" }], nextSyncToken: "sync-2" }]);
    const res = await calendarAdapter.syncChanges("tok", "sync-1");
    assert.equal(res.nextCursor, "sync-2");
    assert.equal(res.chunks.length, 1);
    const [call] = callsOf("events.list");
    assert.equal(call.params.syncToken, "sync-1");
    assert.equal(call.params.showDeleted, true);
    assert.equal(call.params.timeMin, undefined, "timeMin cannot be combined with syncToken");
  });

  it("keeps the old cursor if Google returns no new sync token", async () => {
    fakeCalendar([{ items: [] }]);
    assert.equal((await calendarAdapter.syncChanges("tok", "sync-1")).nextCursor, "sync-1");
  });

  it("turns 410 Gone into a clear 'resync required' error", async () => {
    fakeCalendar([{ code: 410 }]);
    await assert.rejects(calendarAdapter.syncChanges("tok", "sync-1"), /410 Gone/);
  });
});

// ---------------------------------------------------------------- Sheets

function fakeSheets(opts: {
  files: Array<{ id: string; name: string }>;
  tabs: Record<string, Array<{ title: string; sheetId: number }>>;
  values: Record<string, unknown[][]>;
  changes?: unknown[];
}) {
  const changes = [...(opts.changes ?? [])];
  fakes.drive = {
    files: { list: recorder("drive", "files.list", () => ({ data: { files: opts.files } })) },
    changes: {
      getStartPageToken: recorder("drive", "changes.getStartPageToken", () => ({ data: { startPageToken: "start-1" } })),
      list: recorder("drive", "changes.list", () => ({ data: changes.shift() })),
    },
  };
  fakes.sheets = {
    spreadsheets: {
      get: recorder("sheets", "spreadsheets.get", (p) => ({
        data: { sheets: (opts.tabs[p.spreadsheetId as string] ?? []).map((properties) => ({ properties })) },
      })),
      values: {
        get: recorder("sheets", "values.get", (p) => ({ data: { values: opts.values[`${p.spreadsheetId}|${p.range}`] } })),
      },
    },
  };
}

describe("Sheets adapter (lib/ingest/sheets.ts)", () => {
  it("indexes one labelled fact per row, with a link to that exact row", async () => {
    fakeSheets({
      files: [{ id: "ss1", name: "Clients" }],
      tabs: { ss1: [{ title: "Active", sheetId: 7 }] },
      values: { "ss1|'Active'": [["Name", "Status"], ["Ana", "Paid"], ["Ben", "Overdue"]] },
    });
    const chunks = await collect(sheetsAdapter.backfill("tok"));
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].content, "Spreadsheet: Clients\nTab: Active\nName: Ana\nStatus: Paid");
    assert.equal(chunks[1].title, "Clients — Active (row 3)");
    assert.equal(chunks[1].sourceId, "ss1:Active:1");
    assert.equal(
      chunks[1].url,
      `https://docs.google.com/spreadsheets/d/ss1/edit#gid=7&range=${encodeURIComponent("'Active'!A3:B3")}`,
    );
  });

  it("labels headerless columns by letter, including past column Z", async () => {
    const headers = Array.from({ length: 28 }, (_, i) => (i === 0 ? "Name" : ""));
    const row = Array.from({ length: 28 }, (_, i) => (i === 0 ? "Ana" : i === 26 ? "AA-value" : i === 27 ? "AB-value" : ""));
    fakeSheets({
      files: [{ id: "ss", name: "Wide" }],
      tabs: { ss: [{ title: "T", sheetId: 0 }] },
      values: { "ss|'T'": [headers, row] },
    });
    const [chunk] = await collect(sheetsAdapter.backfill("tok"));
    assert.match(chunk.content, /Column AA: AA-value/);
    assert.match(chunk.content, /Column AB: AB-value/);
    assert.equal(chunk.metadata.range, "'T'!A2:AB2");
  });

  it("quotes a tab name with spaces or apostrophes in the A1 range", async () => {
    fakeSheets({
      files: [{ id: "ss", name: "Book" }],
      tabs: { ss: [{ title: "Q1 Ana's", sheetId: 1 }] },
      values: { "ss|'Q1 Ana''s'": [["A"], ["x"]] },
    });
    const [chunk] = await collect(sheetsAdapter.backfill("tok"));
    assert.equal(chunk.metadata.range, "'Q1 Ana''s'!A2:A2");
  });

  it("skips blank rows, header-only tabs and tabs without an id", async () => {
    fakeSheets({
      files: [{ id: "ss", name: "Book" }],
      tabs: { ss: [{ title: "Data", sheetId: 1 }, { title: "Empty", sheetId: 2 }, { title: "NoId" } as never] },
      values: { "ss|'Data'": [["A", "B"], ["", ""], [], ["x", ""]], "ss|'Empty'": [["A", "B"]] },
    });
    const chunks = await collect(sheetsAdapter.backfill("tok"));
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].sourceId, "ss:Data:2");
  });

  it("only re-reads spreadsheets from Drive's change feed, ignoring removed and trashed files", async () => {
    fakeSheets({
      files: [],
      tabs: { live: [{ title: "T", sheetId: 0 }] },
      values: { "live|'T'": [["K"], ["v"]] },
      changes: [
        {
          changes: [
            { file: { id: "live", name: "Live", mimeType: "application/vnd.google-apps.spreadsheet" } },
            { removed: true, file: { id: "r", name: "R", mimeType: "application/vnd.google-apps.spreadsheet" } },
            { file: { id: "t", name: "T", trashed: true, mimeType: "application/vnd.google-apps.spreadsheet" } },
            { file: { id: "d", name: "Doc", mimeType: "application/vnd.google-apps.document" } },
          ],
          newStartPageToken: "next-1",
        },
      ],
    });
    const res = await sheetsAdapter.syncChanges("tok", "cur-1");
    assert.equal(res.chunks.length, 1);
    assert.equal(res.nextCursor, "next-1");
    assert.equal(callsOf("spreadsheets.get").length, 1);
  });

  it("establishes a change-feed cursor on the first sync", async () => {
    fakeSheets({ files: [], tabs: {}, values: {} });
    assert.deepEqual(await sheetsAdapter.syncChanges("tok", null), { chunks: [], nextCursor: "start-1" });
  });
});

// ----------------------------------------------------------------- Drive

function fakeDrive(opts: { files?: unknown[]; docs?: Record<string, unknown>; changes?: unknown[] }) {
  const changes = [...(opts.changes ?? [])];
  fakes.drive = {
    files: {
      list: recorder("drive", "files.list", () => ({ data: { files: opts.files ?? [] } })),
      get: recorder("drive", "files.get", () => ({ data: new ArrayBuffer(4) })),
    },
    changes: {
      getStartPageToken: recorder("drive", "changes.getStartPageToken", () => ({ data: { startPageToken: "s-1" } })),
      list: recorder("drive", "changes.list", () => ({ data: changes.shift() })),
    },
  };
  fakes.docs = {
    documents: { get: recorder("docs", "documents.get", (p) => ({ data: opts.docs?.[p.documentId as string] })) },
  };
}
const doc = (...runs: string[]) => ({
  body: { content: [{ paragraph: { elements: runs.map((content) => ({ textRun: { content } })) } }, { table: {} }] },
});

describe("Drive adapter (lib/ingest/drive.ts)", () => {
  it("only lists Docs and PDFs that are not in the trash", async () => {
    fakeDrive({});
    await collect(driveAdapter.backfill("tok"));
    const q = String(callsOf("files.list")[0].params.q);
    assert.match(q, /application\/vnd\.google-apps\.document/);
    assert.match(q, /application\/pdf/);
    assert.match(q, /trashed = false/);
  });

  it("flattens a Google Doc's paragraphs and links to the doc", async () => {
    fakeDrive({
      files: [{ id: "d1", name: "Refund policy", mimeType: "application/vnd.google-apps.document" }],
      docs: { d1: doc("Refunds within ", "30 days.\n") },
    });
    const [chunk] = await collect(driveAdapter.backfill("tok"));
    assert.equal(chunk.content, "Refunds within 30 days.");
    assert.equal(chunk.url, "https://docs.google.com/document/d/d1/edit");
  });

  it("downloads PDFs as bytes and extracts their text", async () => {
    fakeDrive({ files: [{ id: "p1", name: "Contract.pdf", mimeType: "application/pdf" }] });
    const [chunk] = await collect(driveAdapter.backfill("tok"));
    assert.equal(chunk.content, "Extracted PDF text");
    assert.equal(chunk.url, "https://drive.google.com/file/d/p1/view");
    assert.equal(pdfText.mock.callCount(), 1);
    assert.equal(callsOf("files.get")[0].params.alt, "media");
  });

  it("skips an empty document instead of indexing a blank chunk", async () => {
    fakeDrive({
      files: [{ id: "e", name: "Empty", mimeType: "application/vnd.google-apps.document" }],
      docs: { e: doc("   \n") },
    });
    assert.equal((await collect(driveAdapter.backfill("tok"))).length, 0);
  });

  it("re-reads only changed Docs/PDFs and advances to the new start token", async () => {
    fakeDrive({
      docs: { d: doc("changed") },
      changes: [
        {
          changes: [
            { file: { id: "d", name: "D", mimeType: "application/vnd.google-apps.document" } },
            { removed: true, fileId: "gone" },
            { file: { id: "img", name: "photo.png", mimeType: "image/png" } },
          ],
          nextPageToken: "pg2",
        },
        { changes: [], newStartPageToken: "s-2" },
      ],
    });
    const res = await driveAdapter.syncChanges("tok", "s-1");
    assert.deepEqual(res.chunks.map((c) => c.sourceId), ["d"]);
    assert.equal(res.nextCursor, "s-2");
    assert.equal(callsOf("changes.list")[1].params.pageToken, "pg2");
  });

  it("establishes a change-feed cursor on the first sync", async () => {
    fakeDrive({});
    assert.deepEqual(await driveAdapter.syncChanges("tok", null), { chunks: [], nextCursor: "s-1" });
  });
});

