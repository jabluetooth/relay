// Real fixed-size chunking (PRD §6.5 open question — resolved: fixed-size
// with overlap, not a structured per-surface splitter, is enough for v1).
// Character-based since no tokenizer dependency is in the stack. Sized well
// under both the reranker's per-text cap (lib/rag/rerank.ts,
// MAX_CHARS_PER_TEXT=1200) and the generation per-source cap
// (lib/rag/generate.ts, MAX_CHARS_PER_SOURCE=1500), so those two caps go
// back to being pure safety nets against a pathological single chunk,
// rather than the primary truncation mechanism they were standing in for.
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;

/**
 * Splits document text into overlapping, fixed-size chunks, preferring to
 * break on a paragraph/sentence/word boundary near the window edge instead
 * of mid-word. Overlap keeps context that would otherwise be severed right
 * at a chunk boundary retrievable from either neighboring chunk.
 */
export function splitIntoChunks(content: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  if (trimmed.length <= chunkSize) return [trimmed];

  const chunks: string[] = [];
  let start = 0;

  while (start < trimmed.length) {
    let end = Math.min(start + chunkSize, trimmed.length);

    if (end < trimmed.length) {
      const window = trimmed.slice(start, end);
      const lastBreak = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf(" "));
      // Only honor the boundary if it doesn't shrink this chunk to near
      // nothing — otherwise a text with no whitespace at all would still
      // make forward progress via the hard cut below.
      if (lastBreak > chunkSize * 0.5) {
        end = start + lastBreak + 1;
      }
    }

    const piece = trimmed.slice(start, end).trim();
    if (piece) chunks.push(piece);

    if (end >= trimmed.length) break;
    start = end - overlap;
  }

  return chunks;
}
