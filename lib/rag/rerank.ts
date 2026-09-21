import { fetchWithRetry } from "@/lib/http-retry";

// HuggingFace cross-encoder reranking: vector retrieval casts a wide net,
// the reranker narrows it to what's actually relevant before generation
// sees anything.
//
// NOTE: cross-encoder/ms-marco-MiniLM-L-6-v2 (Mimo's original reranker) is
// no longer hosted on HuggingFace's new Inference Providers system
// ("Model not supported by provider hf-inference", confirmed empirically) —
// api-inference.huggingface.co, which that model and Mimo's own pipeline
// were built against, was fully decommissioned in late 2025. Switched to
// BAAI/bge-reranker-v2-m3, which HuggingFace's own current docs list as a
// supported hf-inference model. Its score distribution was checked
// empirically before picking a threshold: 0.9996 for a genuinely relevant
// pair vs 0.000016 for an irrelevant one — cleanly separated, so the same
// 0.45 cutoff Mimo used is a reasonable starting point here too, though it
// still wants a real eval pass per PRD §7 rather than resting on one manual check.

const MODEL = "BAAI/bge-reranker-v2-m3";
const ENDPOINT = `https://router.huggingface.co/hf-inference/models/${MODEL}`;

export interface RerankCandidate {
  id: string;
  text: string;
}

export interface RankedCandidate extends RerankCandidate {
  score: number;
}

// Cross-encoders have a fixed max sequence length (typically 512 tokens).
// A large enough chunk crashed this reranker with a tensor-size mismatch
// before ingestion did real fixed-size chunking (lib/ingest/chunk.ts) —
// chunks are now sized well under this cap, so it's a safety net against a
// pathological single chunk, not the primary truncation mechanism.
const MAX_CHARS_PER_TEXT = 1200;

// Empirically, a single batched request (all candidate pairs in one HTTP
// call) silently degraded every score after the first to 0 on this
// provider (confirmed: the same pair scored 0.112 sent alone vs 0 inside a
// 7-item batch, with no error returned — a silent correctness bug, not a
// documented limit). Requesting one pair per call avoids it; the latency
// cost is bounded since only a handful of retrieval candidates are ever
// reranked per query (see RETRIEVE_CANDIDATES in lib/rag/pipeline.ts).
async function scoreOne(token: string, query: string, text: string): Promise<number> {
  // Confirmed in practice: HF's infra occasionally returns a transient 502
  // ("Could not connect to the workload on the requested port") with zero
  // retries previously in place, crashing the whole query on what's usually
  // a cold-start blip, not a real failure.
  const res = await fetchWithRetry(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: [{ text: query, text_pair: text.slice(0, MAX_CHARS_PER_TEXT) }],
      options: { wait_for_model: true },
    }),
  });

  if (!res.ok) {
    throw new Error(`HuggingFace rerank request failed (${res.status}): ${await res.text()}`);
  }

  // Response shape: one array entry per input pair (always length 1 here),
  // holding a single classification label/score — e.g. [[{"label":"LABEL_0","score":0.97}]].
  const raw = (await res.json()) as Array<Array<{ label: string; score: number }>>;
  return raw[0]?.[0]?.score ?? 0;
}

export async function rerank(query: string, candidates: RerankCandidate[]): Promise<RankedCandidate[]> {
  if (candidates.length === 0) return [];

  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("HF_TOKEN is not set — see .env.example");

  const scores = await Promise.all(candidates.map((c) => scoreOne(token, query, c.text)));
  return candidates
    .map((c, i) => ({ ...c, score: scores[i] }))
    .sort((a, b) => b.score - a.score);
}
