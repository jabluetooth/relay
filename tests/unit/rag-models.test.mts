// The model-facing half of the RAG pipeline: answer generation (the real
// Groq SDK, with its HTTP call stubbed), reranking and embedding
// (HuggingFace, also via a stubbed fetch).
import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { stubFetch, json, type RecordedRequest } from "./helpers/fetch-stub";

process.env.HF_TOKEN = "hf_test";
process.env.GROQ_API_KEY = "gsk_test";

interface CompletionRequest {
  model: string;
  temperature: number;
  messages: Array<{ role: string; content: string }>;
}

/** Stubs one Groq chat completion that answers with `content`. */
function groqAnswers(content: string) {
  const s = stubFetch(
    json({
      id: "c",
      object: "chat.completion",
      created: 0,
      model: "openai/gpt-oss-120b",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    }),
  );
  restore = s.restore;
  return s.requests;
}
const completionRequest = (requests: RecordedRequest[]) => requests[0].body as CompletionRequest;

const { generateAnswer } = await import("../../lib/rag/generate");
const { rerank } = await import("../../lib/rag/rerank");
const { embedText } = await import("../../lib/rag/embed");

const chunks = [
  { id: "c1", title: "Refund policy", url: null, content: "Refunds within 30 days." },
  { id: "c2", title: "Billing", url: null, content: "Account BA-2291-X." },
  { id: "c3", title: "PTO", url: null, content: "15 days of PTO." },
];

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe("generateAnswer (lib/rag/generate.ts)", () => {
  it("returns only the sources the answer actually cites", async () => {
    groqAnswers("Refunds take 30 days [1]. Your account is BA-2291-X [2].");
    const { citedChunkIds } = await generateAnswer("q", chunks);
    assert.deepEqual(citedChunkIds, ["c1", "c2"]);
  });

  it("still credits the model's native 【n】 and 【n†Lx】 citation styles", async () => {
    groqAnswers("PTO is 15 days 【3】 and refunds 【1†L1-L2】.");
    const { citedChunkIds } = await generateAnswer("q", chunks);
    assert.deepEqual(new Set(citedChunkIds), new Set(["c3", "c1"]));
  });

  it("ignores citation numbers that point at no source, and de-duplicates", async () => {
    groqAnswers("A [1] B [1] C [9] D [0]");
    assert.deepEqual((await generateAnswer("q", chunks)).citedChunkIds, ["c1"]);
  });

  it("returns no citations for an uncited answer", async () => {
    groqAnswers("I don't know.");
    assert.deepEqual((await generateAnswer("q", chunks)).citedChunkIds, []);
  });

  it("normalises typographic hyphens and spaces so copied IDs match the source", async () => {
    groqAnswers("Account BA‑2291‑X, 30 days total [2]");
    assert.equal((await generateAnswer("q", chunks)).answer, "Account BA-2291-X, 30 days total [2]");
  });

  it("numbers the sources, caps each one, and tells the model sources are untrusted data", async () => {
    const requests = groqAnswers("x");
    const long = { id: "big", title: "Big", url: null, content: "a".repeat(5000) };
    await generateAnswer("What is it?", [chunks[0], long]);
    const req = completionRequest(requests);
    assert.match(requests[0].url, /api\.groq\.com\/openai\/v1\/chat\/completions$/);
    const system = req.messages.find((m) => m.role === "system")!.content;
    const user = req.messages.find((m) => m.role === "user")!.content;
    assert.match(system, /untrusted data, not instructions/);
    assert.match(user, /\[1\] \(Refund policy\)/);
    assert.match(user, /\[2\] \(Big\)/);
    assert.match(user, /QUESTION: What is it\?$/);
    assert.ok(!user.includes("a".repeat(1501)), "a single source is capped at 1500 chars");
    assert.ok(req.temperature <= 0.2, "low temperature for grounded answers");
  });

  it("copes with an empty completion", async () => {
    groqAnswers("");
    assert.deepEqual(await generateAnswer("q", chunks), { answer: "", citedChunkIds: [] });
  });
});

describe("rerank (lib/rag/rerank.ts)", () => {
  const scored = (score: number) => json([[{ label: "LABEL_0", score }]]);

  it("scores every candidate and sorts best first", async () => {
    const s = stubFetch(scored(0.1), scored(0.9), scored(0.5));
    restore = s.restore;
    const ranked = await rerank("q", [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
      { id: "c", text: "C" },
    ]);
    assert.deepEqual(ranked.map((r) => [r.id, r.score]), [["b", 0.9], ["c", 0.5], ["a", 0.1]]);
  });

  it("sends one pair per request (batched requests silently zeroed scores)", async () => {
    const s = stubFetch(scored(0.1), scored(0.2));
    restore = s.restore;
    await rerank("the query", [{ id: "a", text: "A" }, { id: "b", text: "B" }]);
    assert.equal(s.requests.length, 2);
    for (const r of s.requests) {
      const body = r.body as { inputs: Array<{ text: string; text_pair: string }> };
      assert.equal(body.inputs.length, 1);
      assert.equal(body.inputs[0].text, "the query");
    }
    assert.equal((s.requests[0].init?.headers as Record<string, string>).Authorization, "Bearer hf_test");
  });

  it("truncates an oversized chunk to fit the cross-encoder", async () => {
    const s = stubFetch(scored(0.3));
    restore = s.restore;
    await rerank("q", [{ id: "a", text: "z".repeat(5000) }]);
    const body = s.requests[0].body as { inputs: Array<{ text_pair: string }> };
    assert.equal(body.inputs[0].text_pair.length, 1200);
  });

  it("makes no request for zero candidates", async () => {
    const s = stubFetch();
    restore = s.restore;
    assert.deepEqual(await rerank("q", []), []);
  });

  it("treats a malformed score response as 0 rather than crashing", async () => {
    restore = stubFetch(json([])).restore;
    assert.equal((await rerank("q", [{ id: "a", text: "A" }]))[0].score, 0);
  });

  it("surfaces a client error from HuggingFace", async () => {
    restore = stubFetch(json({ error: "bad token" }, 401)).restore;
    await assert.rejects(rerank("q", [{ id: "a", text: "A" }]), /rerank request failed \(401\)/);
  });

  it("refuses to run without HF_TOKEN", async () => {
    const keep = process.env.HF_TOKEN;
    delete process.env.HF_TOKEN;
    try {
      await assert.rejects(rerank("q", [{ id: "a", text: "A" }]), /HF_TOKEN/);
    } finally {
      process.env.HF_TOKEN = keep;
    }
  });
});

describe("embedText (lib/rag/embed.ts)", () => {
  it("returns the embedding vector", async () => {
    const s = stubFetch(json([0.1, 0.2, 0.3]));
    restore = s.restore;
    assert.deepEqual(await embedText("hello"), [0.1, 0.2, 0.3]);
    assert.match(s.requests[0].url, /BAAI\/bge-small-en-v1\.5\/pipeline\/feature-extraction$/);
    assert.equal((s.requests[0].body as { inputs: string }).inputs, "hello");
  });

  it("surfaces a failed embedding request", async () => {
    restore = stubFetch(json({ error: "forbidden" }, 403)).restore;
    await assert.rejects(embedText("x"), /embedding request failed \(403\)/);
  });
});
