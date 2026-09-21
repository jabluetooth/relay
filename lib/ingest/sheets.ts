import { driveClient, sheetsClient } from "@/lib/google/client";
import type { IngestAdapter, IngestedChunk } from "@/lib/ingest/types";
import type { sheets_v4, drive_v3 } from "googleapis";

// M2 scope (PRD §9, FR-8, FR-12). Unlike Gmail, Sheets needs no FR-6-style
// opt-in scope — backfill indexes every spreadsheet found in Drive, the
// same posture driveAdapter already takes for Docs/PDFs.
//
// FR-8's own distinction ("structured, retrievable facts rather than
// flattening a sheet into an unstructured text blob") is why this adapter
// yields one IngestedChunk PER ROW rather than one blob per spreadsheet
// split by character count the way Drive/Gmail/Calendar's prose content
// is — a row is already the natural unit of a "fact," and
// lib/ingest/chunk.ts's arbitrary character windows would cut through
// structured data mid-row. The header row supplies field names for every
// data row's own chunk, so "Name: John Doe, Status: Active" reads as a
// real fact on its own, not a floating comma-separated fragment.
//
// FR-12: Sheets doesn't get its own push channel — a Sheet is a Drive
// file, so its freshness rides on Drive's existing changes.watch channel.
// app/api/jobs/drive-sync/route.ts calls this adapter's own syncChanges
// (its own independent cursor over that same underlying Drive change
// feed) after handling Drive's own sync, whenever Sheets has already been
// backfilled at least once.
//
// Known limitation, worth naming precisely rather than leaving implicit:
// a row's sourceId is positional (`spreadsheetId:tab:rowIndex`), not
// content-based, since there's no reliable stable key across arbitrary
// spreadsheets. Deleting row 3 shifts every later row up by one, so what
// was row 4's content now lands under row 3's old sourceId — persistChunk
// correctly treats that as "row 3 changed" and re-embeds it (not silently
// wrong), but the sheet's true last row's old slot becomes an orphan
// (never revisited, since the sheet is now one row shorter) until
// something else touches it. Same class of "doesn't retract removed
// content" limitation already accepted for Drive/Gmail/Calendar deletions
// — here it can also mean a citation briefly points at a shifted row
// until the next sync catches up, not just a stale leftover.

const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

function columnLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Quotes a tab name for use in an A1-notation range — required whenever the name has spaces or other special characters. */
function quoteTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

function rowToChunk(
  spreadsheetId: string,
  spreadsheetTitle: string,
  tab: string,
  sheetId: number,
  headers: unknown[],
  row: unknown[],
  rowIndex: number
): IngestedChunk | null {
  if (row.every((cell) => cell === undefined || cell === null || cell === "")) return null;

  const fields = headers
    .map((header, i) => {
      const value = row[i];
      if (value === undefined || value === null || value === "") return null;
      const label = typeof header === "string" && header ? header : `Column ${columnLetter(i)}`;
      return `${label}: ${value}`;
    })
    .filter((f): f is string => f !== null);
  if (fields.length === 0) return null;

  // +2: header row occupies row 1, and this loop's rowIndex is 0-based
  // among the data rows that follow it.
  const sheetRow = rowIndex + 2;
  const lastCol = columnLetter(Math.max(headers.length, row.length) - 1);
  const a1Range = `${quoteTab(tab)}!A${sheetRow}:${lastCol}${sheetRow}`;

  const content = `Spreadsheet: ${spreadsheetTitle}\nTab: ${tab}\n${fields.join("\n")}`;

  return {
    sourceId: `${spreadsheetId}:${tab}:${rowIndex}`,
    surface: "sheets",
    title: `${spreadsheetTitle} — ${tab} (row ${sheetRow})`,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}&range=${encodeURIComponent(a1Range)}`,
    content,
    metadata: { spreadsheetId, tab, sheetId, range: a1Range, rowIndex },
  };
}

async function* ingestSpreadsheet(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  spreadsheetTitle: string
): AsyncGenerator<IngestedChunk> {
  const { data: meta } = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title,sheets.properties.sheetId",
  });

  for (const sheet of meta.sheets ?? []) {
    const tab = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    if (!tab || sheetId === undefined || sheetId === null) continue;

    const { data: valuesResp } = await sheets.spreadsheets.values.get({ spreadsheetId, range: quoteTab(tab) });
    const rows = valuesResp.values ?? [];
    if (rows.length < 2) continue; // header-only or empty tab — nothing to index

    const [headers, ...dataRows] = rows;
    for (let i = 0; i < dataRows.length; i++) {
      const chunk = rowToChunk(spreadsheetId, spreadsheetTitle, tab, sheetId, headers, dataRows[i], i);
      if (chunk) yield chunk;
    }
  }
}

async function* backfill(accessToken: string): AsyncGenerator<IngestedChunk> {
  const drive = driveClient(accessToken);
  const sheets = sheetsClient(accessToken);

  let pageToken: string | undefined;
  do {
    const { data } = await drive.files.list({
      q: `mimeType = '${SPREADSHEET_MIME}' and trashed = false`,
      fields: "nextPageToken, files(id, name)",
      pageSize: 100,
      pageToken,
    });

    for (const file of data.files ?? []) {
      if (!file.id || !file.name) continue;
      yield* ingestSpreadsheet(sheets, file.id, file.name);
    }

    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
}

// Reuses Drive's own change feed rather than a Sheets-specific one — FR-12
// is explicit that a Sheet is a Drive file and its changes are Drive
// changes. This duplicates driveAdapter.syncChanges's own pagination
// shape (lib/ingest/drive.ts) rather than sharing it: Sheets tracks this
// feed as its own independent surface with its own cursor, deliberately
// separate bookkeeping from Drive's own Docs/PDF tracking even though both
// read the same underlying API.
async function syncChanges(accessToken: string, cursor: string | null): Promise<{ chunks: IngestedChunk[]; nextCursor: string | null }> {
  const drive = driveClient(accessToken);
  const sheets = sheetsClient(accessToken);

  if (!cursor) {
    const { data } = await drive.changes.getStartPageToken({});
    return { chunks: [], nextCursor: data.startPageToken ?? null };
  }

  const chunks: IngestedChunk[] = [];
  let pageToken: string | undefined = cursor;
  let nextCursor = cursor;

  do {
    const res = await drive.changes.list({
      pageToken,
      fields: "nextPageToken, newStartPageToken, changes(fileId, removed, file(id, name, mimeType, trashed))",
    });
    const data: drive_v3.Schema$ChangeList = res.data;

    for (const change of data.changes ?? []) {
      const file = change.file;
      if (change.removed || file?.trashed || !file?.id || !file?.name) continue;
      if (file.mimeType !== SPREADSHEET_MIME) continue;
      for await (const chunk of ingestSpreadsheet(sheets, file.id, file.name)) {
        chunks.push(chunk);
      }
    }

    pageToken = data.nextPageToken ?? undefined;
    if (data.newStartPageToken) nextCursor = data.newStartPageToken;
  } while (pageToken);

  return { chunks, nextCursor };
}

export const sheetsAdapter: IngestAdapter = {
  surface: "sheets",
  backfill,
  syncChanges,
};
