// Runs ground-truth.json against the LIVE running app (http://localhost:3000
// by default), the same "against the live system, not a mock" approach
// Mimo's own eval used. Requires `npm run dev` already running in another
// terminal — this script doesn't start the server itself.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.RELAY_EVAL_BASE_URL ?? "http://localhost:3000";

interface GroundTruthCase {
  id: string;
  surface: string | null;
  question: string;
  expectedDocTitle: string | null;
  expectedKeywords: string[];
  shouldRefuse: boolean;
  note?: string;
}

interface CaseResult {
  id: string;
  surface: string | null;
  question: string;
  shouldRefuse: boolean;
  actualRefused: boolean;
  refusalCorrect: boolean;
  citationCorrect: boolean | null; // null when shouldRefuse (not applicable)
  keywordHitRate: number | null;
  latencyMs: number;
  answerPreview: string;
  erroredOut: boolean;
}

async function runCase(c: GroundTruthCase): Promise<CaseResult> {
  const started = Date.now();
  const res = await fetch(`${BASE_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: c.question }),
  });
  const latencyMs = Date.now() - started;

  if (!res.ok) {
    // A single transient upstream failure (see lib/http-retry.ts — most
    // calls now retry, but the budget can still be exhausted) shouldn't be
    // silently miscounted as "falsely refused"; record it as its own outcome.
    const body = (await res.text()).slice(0, 200);
    console.log(`${c.id}: ERROR — HTTP ${res.status}: ${body}`);
    return {
      id: c.id,
      surface: c.surface,
      question: c.question,
      shouldRefuse: c.shouldRefuse,
      actualRefused: false,
      refusalCorrect: false,
      citationCorrect: null,
      keywordHitRate: null,
      latencyMs,
      answerPreview: "",
      erroredOut: true,
    };
  }

  const data = await res.json();

  const refusalCorrect = data.refused === c.shouldRefuse;

  let citationCorrect: boolean | null = null;
  let keywordHitRate: number | null = null;
  if (!c.shouldRefuse) {
    citationCorrect = c.expectedDocTitle
      ? (data.citations ?? []).some((cit: { title: string }) => cit.title === c.expectedDocTitle)
      : true;
    const answerLower = (data.answer ?? "").toLowerCase();
    const hits = c.expectedKeywords.filter((k) => answerLower.includes(k.toLowerCase())).length;
    keywordHitRate = c.expectedKeywords.length === 0 ? 1 : hits / c.expectedKeywords.length;
  }

  return {
    id: c.id,
    surface: c.surface,
    question: c.question,
    shouldRefuse: c.shouldRefuse,
    actualRefused: Boolean(data.refused),
    refusalCorrect,
    citationCorrect,
    keywordHitRate,
    latencyMs,
    answerPreview: (data.answer ?? "").slice(0, 150),
    erroredOut: false,
  };
}

async function main() {
  const cases: GroundTruthCase[] = JSON.parse(readFileSync(join(__dirname, "ground-truth.json"), "utf8"));
  const results: CaseResult[] = [];

  for (const c of cases) {
    const r = await runCase(c);
    if (!r.erroredOut) {
      const status = r.shouldRefuse
        ? r.refusalCorrect
          ? "PASS (correctly refused)"
          : "FAIL (should have refused)"
        : !r.refusalCorrect
          ? "FAIL (falsely refused)"
          : r.citationCorrect && (r.keywordHitRate ?? 0) === 1
            ? "PASS"
            : `PARTIAL (citation=${r.citationCorrect}, keywords=${((r.keywordHitRate ?? 0) * 100).toFixed(0)}%)`;
      console.log(`${r.id}: ${status} [${r.latencyMs}ms]`);
    } // erroredOut cases already logged their own ERROR line inside runCase()
    results.push(r);
  }

  const outDir = join(__dirname, "results");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "ground-truth-results.json"), JSON.stringify(results, null, 2));
  console.log(`\nWrote ${results.length} results to tests/eval/results/ground-truth-results.json`);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
