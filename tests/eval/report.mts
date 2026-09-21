// Aggregates run-eval.mts and run-adversarial.mts output into a stats
// summary, same "Results" table shape as Mimo's README — run both first.

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(__dirname, "results");

function pct(n: number, total: number): string {
  return total === 0 ? "n/a" : `${((n / total) * 100).toFixed(0)}%`;
}

function loadResults<T>(filename: string): T[] {
  const path = join(resultsDir, filename);
  if (!existsSync(path)) {
    console.error(`Missing ${filename} — run the corresponding script first.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

interface GroundTruthResult {
  surface: string | null;
  shouldRefuse: boolean;
  actualRefused: boolean;
  refusalCorrect: boolean;
  citationCorrect: boolean | null;
  keywordHitRate: number | null;
  latencyMs: number;
  erroredOut: boolean;
}

interface AdversarialResult {
  resisted: boolean;
  retrievedFixture: boolean;
  latencyMs: number;
  erroredOut: boolean;
}

function main() {
  const gtAll = loadResults<GroundTruthResult>("ground-truth-results.json");
  const advAll = loadResults<AdversarialResult>("adversarial-results.json");

  const gtErrors = gtAll.filter((r) => r.erroredOut).length;
  const advErrors = advAll.filter((r) => r.erroredOut).length;
  // Errored cases (transient upstream failures that outlasted the retry
  // budget — see lib/http-retry.ts) are excluded from the pass/fail stats
  // below rather than silently counted as failures of the thing actually
  // being measured; they're reported as their own line instead.
  const gt = gtAll.filter((r) => !r.erroredOut);
  const adv = advAll.filter((r) => !r.erroredOut);

  const positives = gt.filter((r) => !r.shouldRefuse);
  const negatives = gt.filter((r) => r.shouldRefuse);

  const citationCorrectCount = positives.filter((r) => r.citationCorrect).length;
  const fullKeywordMatchCount = positives.filter((r) => (r.keywordHitRate ?? 0) === 1).length;
  const avgKeywordHitRate =
    positives.reduce((sum, r) => sum + (r.keywordHitRate ?? 0), 0) / (positives.length || 1);

  const falseRefusals = positives.filter((r) => !r.refusalCorrect).length;
  const correctRefusals = negatives.filter((r) => r.refusalCorrect).length;

  const advValid = adv.filter((r) => r.retrievedFixture);
  const advResisted = advValid.filter((r) => r.resisted).length;
  const advInconclusive = adv.length - advValid.length;

  const allLatencies = [...gt.map((r) => r.latencyMs), ...adv.map((r) => r.latencyMs)].sort((a, b) => a - b);
  const p50 = allLatencies[Math.floor(allLatencies.length * 0.5)];
  const p95 = allLatencies[Math.floor(allLatencies.length * 0.95)];

  // Per-surface breakdown — flagged as the natural next step in this
  // harness's own README once more than one surface had real content;
  // Drive/Gmail/Calendar/Sheets now all do, and each surface's content
  // shape is different enough (prose vs. Calendar's short structured
  // fields vs. Sheets' per-row facts) that a single aggregate number could
  // hide one surface dragging while another compensates.
  const surfaces = [...new Set(positives.map((r) => r.surface).filter((s): s is string => s !== null))].sort();
  const bySurfaceRows = surfaces.map((surface) => {
    const rows = positives.filter((r) => r.surface === surface);
    const citeOk = rows.filter((r) => r.citationCorrect).length;
    const fullKw = rows.filter((r) => (r.keywordHitRate ?? 0) === 1).length;
    const avgKw = rows.reduce((sum, r) => sum + (r.keywordHitRate ?? 0), 0) / (rows.length || 1);
    return `| ${surface} | ${rows.length} | ${pct(citeOk, rows.length)} (${citeOk}/${rows.length}) | ${pct(fullKw, rows.length)} (${fullKw}/${rows.length}) | ${(avgKw * 100).toFixed(0)}% |`;
  });

  console.log(`
## Relay Eval Report — ${new Date().toISOString().slice(0, 10)}

Measured against the live running app (not a mock), same methodology as Mimo's own eval.

| Metric | Result |
|---|---|
| Retrieval + citation accuracy (expected source cited) | **${pct(citationCorrectCount, positives.length)}** (${citationCorrectCount}/${positives.length}) |
| Full expected-keyword match rate | **${pct(fullKeywordMatchCount, positives.length)}** (${fullKeywordMatchCount}/${positives.length}) |
| Average keyword hit rate (partial credit) | **${(avgKeywordHitRate * 100).toFixed(0)}%** |
| False refusals (should answer, refused instead) | **${falseRefusals}** / ${positives.length} |
| Correct refusals (should refuse, did) | **${pct(correctRefusals, negatives.length)}** (${correctRefusals}/${negatives.length}) |
| Prompt-injection resistance | **${pct(advResisted, advValid.length)}** (${advResisted}/${advValid.length}, ${advInconclusive} inconclusive — fixture not retrieved) |
| Latency (p50 / p95) | **${p50}ms** / **${p95}ms** |
| Transient errors (excluded above, not counted as failures) | ${gtErrors + advErrors} (${gtErrors} ground-truth, ${advErrors} adversarial) |

### By surface

| Surface | Cases | Citation accuracy | Full keyword match | Avg keyword hit rate |
|---|---|---|---|---|
${bySurfaceRows.join("\n")}

${falseRefusals > 0 ? `⚠ ${falseRefusals} false refusal(s) — check ground-truth-results.json for which case IDs.` : ""}
${negatives.length - correctRefusals > 0 ? `⚠ ${negatives.length - correctRefusals} case(s) that should have refused but answered instead — this is the more serious failure mode (hallucination risk), check ground-truth-results.json.` : ""}
${advResisted < advValid.length ? `⚠ ${advValid.length - advResisted} adversarial case(s) leaked their injection target — check adversarial-results.json for matchedForbiddenPattern.` : ""}
${advInconclusive > 0 ? `⚠ ${advInconclusive} adversarial case(s) inconclusive: the poisoned fixture wasn't retrieved for its probe question, so resistance was never actually tested. Consider rewording the probe or cover topic to be more retrievable.` : ""}
`);
}

main();
