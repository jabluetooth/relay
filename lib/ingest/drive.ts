import { createHash } from "crypto";
import { driveClient, docsClient } from "@/lib/google/client";
import { extractPdfText } from "@/lib/ingest/pdf";
import type { IngestAdapter, IngestedChunk } from "@/lib/ingest/types";
import type { docs_v1 } from "@googleapis/docs";
import type { drive_v3 } from "@googleapis/drive";

// M1 scope (PRD §9): Google Docs and PDF content, backfill + incremental
// sync via Drive's changes API.

const DOC_MIME = "application/vnd.google-apps.document";
const PDF_MIME = "application/pdf";
const SUPPORTED_MIME_QUERY = `(mimeType = '${DOC_MIME}' or mimeType = '${PDF_MIME}') and trashed = false`;

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Flattens a Google Doc's structural body content into plain text. */
function extractDocText(doc: docs_v1.Schema$Document): string {
  const parts: string[] = [];
  for (const el of doc.body?.content ?? []) {
    for (const run of el.paragraph?.elements ?? []) {
      if (run.textRun?.content) parts.push(run.textRun.content);
    }
    // Tables aren't flattened cell-by-cell yet — noted as a known gap
    // rather than silently dropping their text entirely at some point.
  }
  return parts.join("").trim();
}

async function fetchDocChunk(accessToken: string, fileId: string, title: string): Promise<IngestedChunk | null> {
  const docs = docsClient(accessToken);
  const { data } = await docs.documents.get({ documentId: fileId });
  const content = extractDocText(data);
  if (!content) return null;

  return {
    sourceId: fileId,
    surface: "drive",
    title,
    url: `https://docs.google.com/document/d/${fileId}/edit`,
    content,
    metadata: { mimeType: DOC_MIME, contentHash: hashContent(content) },
  };
}

async function fetchPdfChunk(accessToken: string, fileId: string, title: string): Promise<IngestedChunk | null> {
  const drive = driveClient(accessToken);
  // responseType "arraybuffer" is what makes googleapis return the raw file
  // bytes in `data` instead of trying to JSON-parse a binary body.
  const { data } = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  const content = await extractPdfText(new Uint8Array(data as ArrayBuffer));
  if (!content) return null;

  return {
    sourceId: fileId,
    surface: "drive",
    title,
    url: `https://drive.google.com/file/d/${fileId}/view`,
    content,
    metadata: { mimeType: PDF_MIME, contentHash: hashContent(content) },
  };
}

async function* backfill(accessToken: string): AsyncGenerator<IngestedChunk> {
  const drive = driveClient(accessToken);
  let pageToken: string | undefined;

  do {
    const { data } = await drive.files.list({
      q: SUPPORTED_MIME_QUERY,
      fields: "nextPageToken, files(id, name, mimeType)",
      pageSize: 100,
      pageToken,
    });

    for (const file of data.files ?? []) {
      if (!file.id || !file.name) continue;
      const chunk =
        file.mimeType === PDF_MIME
          ? await fetchPdfChunk(accessToken, file.id, file.name)
          : await fetchDocChunk(accessToken, file.id, file.name);
      if (chunk) yield chunk;
    }

    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
}

async function syncChanges(
  accessToken: string,
  cursor: string | null
): Promise<{ chunks: IngestedChunk[]; nextCursor: string | null }> {
  const drive = driveClient(accessToken);

  let startPageToken = cursor;
  if (!startPageToken) {
    const { data } = await drive.changes.getStartPageToken({});
    startPageToken = data.startPageToken ?? null;
    // First call after connecting establishes the watermark; caller should
    // treat this as "no changes yet" and re-sync from here next time.
    return { chunks: [], nextCursor: startPageToken };
  }

  const chunks: IngestedChunk[] = [];
  let pageToken: string | undefined = startPageToken;
  let nextCursor = startPageToken;

  do {
    const res = await drive.changes.list({
      pageToken,
      fields: "nextPageToken, newStartPageToken, changes(fileId, removed, file(id, name, mimeType, trashed))",
    });
    const data: drive_v3.Schema$ChangeList = res.data;

    for (const change of data.changes ?? []) {
      const file = change.file;
      if (change.removed || file?.trashed || !file?.id || !file?.name) continue;
      if (file.mimeType !== DOC_MIME && file.mimeType !== PDF_MIME) continue;
      const chunk =
        file.mimeType === PDF_MIME
          ? await fetchPdfChunk(accessToken, file.id, file.name)
          : await fetchDocChunk(accessToken, file.id, file.name);
      if (chunk) chunks.push(chunk);
    }

    pageToken = data.nextPageToken ?? undefined;
    if (data.newStartPageToken) nextCursor = data.newStartPageToken;
  } while (pageToken);

  return { chunks, nextCursor };
}

export const driveAdapter: IngestAdapter = {
  surface: "drive",
  backfill,
  syncChanges,
};
