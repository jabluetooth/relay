import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { embedText } from "@/lib/rag/embed";
import { searchPoints } from "@/lib/qdrant";
import { rerank } from "@/lib/rag/rerank";
import { generateAnswer } from "@/lib/rag/generate";

// Mimo's tuned value (0.45) does NOT transfer to this reranker/content
// combination — verified empirically against real ingested Drive content,
// not assumed. Recalibrated a second time once PRD §7's real ground-truth
// suite existed and could do what it was always meant to: the original
// 0.05 (a single-pair estimate — see git history) turned out to
// false-refuse a real, correctly-ingested Calendar fact ("Who is
// interviewing me for the Pivotly screening?" scored 0.0482, just under
// the old cutoff) — found by actually running the eval, not assumed.
// Checked the real score distribution before moving it: genuine
// out-of-scope refusals scored 0.00037 and 0.0025 (a real Gmail
// scope-boundary case and a real Calendar out-of-window case), while every
// genuinely answerable case scored at least 0.048. 0.02 sits with a
// comfortable margin on both sides of that real gap — about 8x above the
// highest confirmed-irrelevant score, well below the lowest confirmed-
// relevant one — rather than splitting the difference from a single pair.
const CONFIDENCE_THRESHOLD = 0.02;
const RETRIEVE_CANDIDATES = 12;
const RERANK_TOP_K = 4;

export interface QueryResult {
  answer: string;
  refused: boolean;
  confidence: number;
  citations: Array<{ chunkId: string; title: string; url: string | null; snippet: string }>;
}

export async function answerQuery(query: string): Promise<QueryResult> {
  const startedAt = Date.now();

  const queryVector = await embedText(query);
  const hits = await searchPoints(queryVector, RETRIEVE_CANDIDATES);

  if (hits.length === 0) {
    return refuse(0, startedAt, query);
  }

  const chunkIds = hits.map((h) => String(h.id));
  const chunkRows = await db
    .select()
    .from(schema.chunks)
    .where(inArray(schema.chunks.qdrantPointId, chunkIds));

  const byPointId = new Map(chunkRows.map((c) => [c.qdrantPointId, c]));

  const candidates = hits
    .map((h) => {
      const row = byPointId.get(String(h.id));
      return row ? { id: row.id, text: row.content } : null;
    })
    .filter((c): c is { id: string; text: string } => c !== null);

  const ranked = await rerank(query, candidates);
  const topScore = ranked[0]?.score ?? 0;

  // Confidence gate happens BEFORE generation, same as Mimo — a low-confidence
  // retrieval never reaches the LLM at all (cost control, and it's the
  // retrieval quality that's actually uncertain, not something an LLM
  // self-reporting "confidence" would judge more honestly).
  if (topScore < CONFIDENCE_THRESHOLD) {
    return refuse(topScore, startedAt, query);
  }

  const top = ranked.slice(0, RERANK_TOP_K);
  const topRows = top
    .map((t) => chunkRows.find((c) => c.id === t.id))
    .filter((r): r is typeof chunkRows[number] => r !== undefined);

  const documentIds = [...new Set(topRows.map((r) => r.documentId))];
  const docs = await db
    .select()
    .from(schema.documents)
    .where(inArray(schema.documents.id, documentIds));
  const docById = new Map(docs.map((d) => [d.id, d]));

  const grounded = topRows.map((r) => ({
    id: r.id,
    title: docById.get(r.documentId)?.title ?? "Untitled",
    url: docById.get(r.documentId)?.url ?? null,
    content: r.content,
  }));

  const { answer, citedChunkIds } = await generateAnswer(query, grounded);

  const citations = citedChunkIds
    .map((id) => grounded.find((g) => g.id === id))
    .filter((g): g is (typeof grounded)[number] => g !== undefined)
    .map((g) => ({ chunkId: g.id, title: g.title, url: g.url, snippet: g.content.slice(0, 240) }));

  await db.insert(schema.queryLogs).values({
    query,
    latencyMs: Date.now() - startedAt,
    refused: false,
    confidence: topScore,
  });

  return { answer, refused: false, confidence: topScore, citations };
}

async function refuse(confidence: number, startedAt: number, query: string): Promise<QueryResult> {
  await db.insert(schema.queryLogs).values({
    query,
    latencyMs: Date.now() - startedAt,
    refused: true,
    confidence,
  });

  return {
    answer: "I couldn't find anything in your connected Google Workspace confident enough to answer that.",
    refused: true,
    confidence,
    citations: [],
  };
}
