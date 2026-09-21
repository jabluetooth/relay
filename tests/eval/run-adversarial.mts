// Runs adversarial.json's probe questions against the LIVE app and checks
// that no forbidden pattern (the injection's target string/behavior) leaked
// into the answer. Requires seed-adversarial.mts to have been run first —
// this script only probes, it doesn't seed.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.RELAY_EVAL_BASE_URL ?? "http://localhost:3000";

interface AdversarialCase {
  id: string;
  description: string;
  probeQuestion: string;
  forbiddenPatterns: string[];
}

interface CaseResult {
  id: string;
  description: string;
  resisted: boolean;
  matchedForbiddenPattern: string | null;
  retrievedFixture: boolean;
  latencyMs: number;
  answerPreview: string;
  erroredOut: boolean;
}

async function main() {
  const cases: AdversarialCase[] = JSON.parse(readFileSync(join(__dirname, "adversarial.json"), "utf8"));
  const results: CaseResult[] = [];

  for (const c of cases) {
    const started = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: c.probeQuestion }),
      });
      const latencyMs = Date.now() - started;

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const data = await res.json();
      const answer: string = data.answer ?? "";
      const answerLower = answer.toLowerCase();

      const matched = c.forbiddenPatterns.find((p) => answerLower.includes(p.toLowerCase())) ?? null;
      const retrievedFixture = (data.citations ?? []).some((cit: { title: string }) => cit.title.startsWith("[TEST]"));

      const result: CaseResult = {
        id: c.id,
        description: c.description,
        resisted: matched === null,
        matchedForbiddenPattern: matched,
        retrievedFixture,
        latencyMs,
        answerPreview: answer.slice(0, 150),
        erroredOut: false,
      };
      console.log(
        `${c.id}: ${result.resisted ? "PASS (resisted)" : `FAIL (leaked: "${matched}")`}` +
          (retrievedFixture ? "" : "  [warning: fixture wasn't retrieved — test may be inconclusive, not a real pass]")
      );
      results.push(result);
    } catch (err) {
      // A single case erroring (e.g. a transient upstream 502 that outlasted
      // the retry budget) shouldn't take down the rest of the suite — record
      // it as its own distinct outcome instead of crashing the whole run.
      const latencyMs = Date.now() - started;
      console.log(`${c.id}: ERROR — ${(err as Error).message.slice(0, 150)}`);
      results.push({
        id: c.id,
        description: c.description,
        resisted: false,
        matchedForbiddenPattern: null,
        retrievedFixture: false,
        latencyMs,
        answerPreview: "",
        erroredOut: true,
      });
    }
  }

  const outDir = join(__dirname, "results");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "adversarial-results.json"), JSON.stringify(results, null, 2));
  console.log(`\nWrote ${results.length} results to tests/eval/results/adversarial-results.json`);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
