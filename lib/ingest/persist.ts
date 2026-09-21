import { createHash, randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { embedText } from "@/lib/rag/embed";
import { upsertPoint, deletePoints } from "@/lib/qdrant";
import { splitIntoChunks } from "@/lib/ingest/chunk";
import type { IngestedChunk } from "@/lib/ingest/types";

/**
 * Upserts one ingested document: skips re-embedding if the content hasn't
 * changed since last sync (change detection via contentHash), otherwise
 * splits it into fixed-size chunks (lib/ingest/chunk.ts) and writes each to
 * both Postgres (provenance/citations) and Qdrant (the actual vector).
 */
export async function persistChunk(connectionId: string, chunk: IngestedChunk): Promise<{ skipped: boolean }> {
  const contentHash = createHash("sha256").update(chunk.content).digest("hex");

  const [existingDoc] = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.connectionId, connectionId),
        eq(schema.documents.surface, chunk.surface),
        eq(schema.documents.sourceId, chunk.sourceId)
      )
    )
    .limit(1);

  if (existingDoc && existingDoc.contentHash === contentHash) {
    // A matching hash alone isn't enough to skip: if a previous run wrote
    // the document row but then failed before the chunk/embedding step
    // (e.g. an HF API error), the hash already reflects the "final" content
    // even though no chunk was ever created. Verify a chunk actually exists
    // before trusting the fast path, so an orphaned document self-heals on
    // the next sync instead of being silently skipped forever.
    const [existingChunk] = await db
      .select({ id: schema.chunks.id })
      .from(schema.chunks)
      .where(eq(schema.chunks.documentId, existingDoc.id))
      .limit(1);
    if (existingChunk) {
      return { skipped: true };
    }
  }

  const documentId =
    existingDoc?.id ??
    (
      await db
        .insert(schema.documents)
        .values({
          connectionId,
          surface: chunk.surface,
          sourceId: chunk.sourceId,
          title: chunk.title,
          url: chunk.url,
          contentHash,
        })
        .returning({ id: schema.documents.id })
    )[0].id;

  if (existingDoc) {
    await db
      .update(schema.documents)
      .set({ title: chunk.title, url: chunk.url, contentHash, updatedAt: new Date() })
      .where(eq(schema.documents.id, documentId));
    // Re-chunk the whole document from scratch on change rather than
    // diffing old/new chunks — fine at this project's scale. Delete the old
    // Qdrant points explicitly first: Postgres cascades chunk rows away
    // just fine on its own, but nothing previously told Qdrant to drop the
    // vectors those rows pointed to, so every re-sync of a changed document
    // left its old points behind as permanent orphans.
    const staleChunks = await db
      .select({ qdrantPointId: schema.chunks.qdrantPointId })
      .from(schema.chunks)
      .where(eq(schema.chunks.documentId, documentId));
    if (staleChunks.length > 0) {
      await deletePoints(staleChunks.map((c) => c.qdrantPointId));
    }
    await db.delete(schema.chunks).where(eq(schema.chunks.documentId, documentId));
  }

  const pieces = splitIntoChunks(chunk.content);

  for (let i = 0; i < pieces.length; i++) {
    const vector = await embedText(pieces[i]);
    const qdrantPointId = randomUUID();

    await upsertPoint(qdrantPointId, vector, {
      documentId,
      connectionId,
      surface: chunk.surface,
      content: pieces[i],
    });

    await db.insert(schema.chunks).values({
      documentId,
      qdrantPointId,
      content: pieces[i],
      metadata: { ...chunk.metadata, chunkIndex: i, chunkCount: pieces.length },
    });
  }

  return { skipped: false };
}

export async function persistChunks(connectionId: string, chunks: IngestedChunk[]) {
  let persisted = 0;
  let skipped = 0;
  for (const chunk of chunks) {
    const result = await persistChunk(connectionId, chunk);
    if (result.skipped) skipped++;
    else persisted++;
  }
  return { persisted, skipped };
}
