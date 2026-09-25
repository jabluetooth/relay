// answerQuery (lib/rag/pipeline.ts) and persistChunk (lib/ingest/persist.ts)
// with their collaborators mocked: embedding, Qdrant, reranking, generation
// and Postgres. What's under test is the orchestration: the confidence gate,
// citation mapping, query logging, and change detection on re-sync.
import assert from "node:assert/strict";
import { describe, it, mock, beforeEach } from "node:test";
import { createFakeDb, mockModule } from "./helpers/fake-db";
import * as schema from "../../lib/db/schema";

const fake = createFakeDb();
mockModule("lib/db/index.ts", { db: fake.db, schema });

const embedText = mock.fn<(text: string) => Promise<number[]>>(async () => [0.1, 0.2]);
mockModule("lib/rag/embed.ts", { embedText });

let hits: Array<{ id: string; score: number }> = [];
const searchPoints = mock.fn<(vector: number[], limit: number) => Promise<typeof hits>>(async () => hits);
const upsertPoint = mock.fn<(id: string, vector: number[], payload: Record<string, unknown>) => Promise<void>>(async () => {});
const deletePoints = mock.fn<(ids: string[]) => Promise<void>>(async () => {});
mockModule("lib/qdrant.ts", { searchPoints, upsertPoint, deletePoints });

let scores: Record<string, number> = {};
const rerank = mock.fn(async (_q: string, cands: Array<{ id: string; text: string }>) =>
  cands.map((c) => ({ ...c, score: scores[c.id] ?? 0 })).sort((a, b) => b.score - a.score),
);
mockModule("lib/rag/rerank.ts", { rerank });

let citedIds: string[] = [];
const generateAnswer = mock.fn<(query: string, chunks: Array<{ id: string }>) => Promise<{ answer: string; citedChunkIds: string[] }>>(
  async () => ({ answer: "The answer [1]", citedChunkIds: citedIds }),
);
mockModule("lib/rag/generate.ts", { generateAnswer });

const { answerQuery } = await import("../../lib/rag/pipeline");
const { persistChunk, persistChunks } = await import("../../lib/ingest/persist");

beforeEach(() => {
  fake.reset();
  for (const m of [embedText, searchPoints, upsertPoint, deletePoints, rerank, generateAnswer]) m.mock.resetCalls();
  hits = [];
  scores = {};
  citedIds = [];
});

const chunkRow = (n: number, documentId = "doc-1") => ({
  id: `chunk-${n}`,
  qdrantPointId: `pt-${n}`,
  documentId,
  content: `Content of chunk ${n}`,
});

function loggedQueries() {
  return fake.callsTo("insert", schema.queryLogs).map((c) => c.values as { refused: boolean; confidence: number; query: string });
}

describe("answerQuery confidence gate (lib/rag/pipeline.ts)", () => {
  it("refuses when retrieval finds nothing, without reranking or generating", async () => {
    const res = await answerQuery("Who is my landlord?");
    assert.equal(res.refused, true);
    assert.deepEqual(res.citations, []);
    assert.equal(rerank.mock.callCount(), 0);
    assert.equal(generateAnswer.mock.callCount(), 0);
    assert.deepEqual(loggedQueries().map((q) => q.refused), [true]);
  });

  it("refuses below the confidence threshold, so a weak match never reaches the LLM", async () => {
    hits = [{ id: "pt-1", score: 0.8 }];
    fake.queue([chunkRow(1)]);
    scores = { "chunk-1": 0.0025 }; // a real out-of-scope case's score, per the eval
    const res = await answerQuery("Something unrelated");
    assert.equal(res.refused, true);
    assert.equal(res.confidence, 0.0025);
    assert.equal(generateAnswer.mock.callCount(), 0, "generation is skipped entirely");
    assert.equal(loggedQueries()[0].confidence, 0.0025);
  });

  it("answers at or above the threshold (the lowest real answerable score was 0.048)", async () => {
    hits = [{ id: "pt-1", score: 0.5 }];
    fake.queue([chunkRow(1)], [{ id: "doc-1", title: "Interview", url: "https://cal/e1" }]);
    scores = { "chunk-1": 0.048 };
    citedIds = ["chunk-1"];
    const res = await answerQuery("Who is interviewing me?");
    assert.equal(res.refused, false);
    assert.equal(generateAnswer.mock.callCount(), 1);
  });

  it("sends only the top 4 reranked chunks to generation, best first", async () => {
    hits = Array.from({ length: 6 }, (_, i) => ({ id: `pt-${i}`, score: 0.5 }));
    fake.queue(Array.from({ length: 6 }, (_, i) => chunkRow(i)), [{ id: "doc-1", title: "Doc", url: null }]);
    scores = { "chunk-0": 0.1, "chunk-1": 0.9, "chunk-2": 0.3, "chunk-3": 0.7, "chunk-4": 0.05, "chunk-5": 0.5 };
    await answerQuery("q");
    const sent = generateAnswer.mock.calls[0].arguments[1].map((c) => c.id);
    assert.deepEqual(sent, ["chunk-1", "chunk-3", "chunk-5", "chunk-2"]);
  });

  it("drops vector hits whose Postgres rows are gone (orphaned Qdrant points)", async () => {
    hits = [{ id: "pt-1", score: 0.9 }, { id: "pt-orphan", score: 0.95 }];
    fake.queue([chunkRow(1)], [{ id: "doc-1", title: "Doc", url: null }]);
    scores = { "chunk-1": 0.5 };
    await answerQuery("q");
    const reranked = rerank.mock.calls[0].arguments[1].map((c) => c.id);
    assert.deepEqual(reranked, ["chunk-1"]);
  });

  it("returns citations for the chunks the answer cited, with title, link and snippet", async () => {
    hits = [{ id: "pt-1", score: 0.9 }, { id: "pt-2", score: 0.8 }];
    fake.queue([chunkRow(1, "doc-a"), chunkRow(2, "doc-b")], [
      { id: "doc-a", title: "Refund policy", url: "https://docs/a" },
      { id: "doc-b", title: "Billing", url: null },
    ]);
    scores = { "chunk-1": 0.9, "chunk-2": 0.6 };
    citedIds = ["chunk-2"];
    const res = await answerQuery("q");
    assert.deepEqual(res.citations, [{ chunkId: "chunk-2", title: "Billing", url: null, snippet: "Content of chunk 2" }]);
    assert.equal(res.confidence, 0.9);
    assert.deepEqual(loggedQueries().map((q) => q.refused), [false]);
  });

  it("titles a chunk whose document row is missing as Untitled instead of crashing", async () => {
    hits = [{ id: "pt-1", score: 0.9 }];
    fake.queue([chunkRow(1, "doc-missing")], []);
    scores = { "chunk-1": 0.9 };
    citedIds = ["chunk-1"];
    const res = await answerQuery("q");
    assert.equal(res.citations[0].title, "Untitled");
  });
});

// --------------------------------------------------------------- persist

const ingested = (content: string) => ({
  sourceId: "file-1",
  surface: "drive" as const,
  title: "Policy",
  url: "https://docs/1",
  content,
  metadata: { mimeType: "doc" },
});
const hashOf = async (s: string) => (await import("node:crypto")).createHash("sha256").update(s).digest("hex");

describe("persistChunk change detection (lib/ingest/persist.ts)", () => {
  it("skips re-embedding a document whose content has not changed", async () => {
    fake.queue([{ id: "doc-1", contentHash: await hashOf("same text") }], [{ id: "chunk-1" }]);
    assert.deepEqual(await persistChunk("conn", ingested("same text")), { skipped: true });
    assert.equal(embedText.mock.callCount(), 0);
    assert.equal(upsertPoint.mock.callCount(), 0);
  });

  it("self-heals a document row left without chunks by a failed earlier run", async () => {
    fake.queue([{ id: "doc-1", contentHash: await hashOf("same text") }], [], []);
    assert.deepEqual(await persistChunk("conn", ingested("same text")), { skipped: false });
    assert.equal(embedText.mock.callCount(), 1);
  });

  it("stores a new document, then one vector and one row per chunk", async () => {
    const text = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
    fake.queue([], [{ id: "new-doc" }]);
    await persistChunk("conn", ingested(text));

    const docInsert = fake.callsTo("insert", schema.documents)[0].values as { contentHash: string; sourceId: string };
    assert.equal(docInsert.contentHash, await hashOf(text));
    assert.equal(docInsert.sourceId, "file-1");

    const rows = fake.callsTo("insert", schema.chunks).map((c) => c.values as { documentId: string; qdrantPointId: string; metadata: Record<string, unknown> });
    assert.ok(rows.length > 1, "long content is split");
    assert.equal(upsertPoint.mock.callCount(), rows.length);
    assert.equal(embedText.mock.callCount(), rows.length);
    rows.forEach((r, i) => {
      assert.equal(r.documentId, "new-doc");
      assert.deepEqual(r.metadata, { mimeType: "doc", chunkIndex: i, chunkCount: rows.length });
      assert.equal(r.qdrantPointId, upsertPoint.mock.calls[i].arguments[0], "Postgres row and Qdrant point share an id");
    });
    assert.equal(upsertPoint.mock.calls[0].arguments[2].connectionId, "conn");
  });

  it("replaces a changed document's old vectors instead of orphaning them in Qdrant", async () => {
    fake.queue([{ id: "doc-1", contentHash: "old-hash" }], [{ qdrantPointId: "old-1" }, { qdrantPointId: "old-2" }]);
    await persistChunk("conn", ingested("new text"));
    assert.deepEqual(deletePoints.mock.calls[0].arguments[0], ["old-1", "old-2"]);
    assert.equal(fake.callsTo("delete", schema.chunks).length, 1);
    const update = fake.callsTo("update", schema.documents)[0].set as { contentHash: string };
    assert.equal(update.contentHash, await hashOf("new text"));
    assert.equal(fake.callsTo("insert", schema.documents).length, 0, "the existing row is reused");
  });

  it("counts persisted and skipped documents across a batch", async () => {
    fake.queue(
      [{ id: "d1", contentHash: await hashOf("a") }], [{ id: "c" }], // unchanged -> skipped
      [], [{ id: "d2" }], // new -> persisted
    );
    assert.deepEqual(await persistChunks("conn", [ingested("a"), ingested("b")]), { persisted: 1, skipped: 1 });
  });
});
