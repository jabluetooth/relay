# Relay eval harness

Same methodology as Mimo's own eval (PRD §7): measured against the live running app, not a local mock, with results written out as data rather than eyeballed from terminal scrollback.

## Running

Requires `npm run dev` already running in another terminal, and at least the Drive surface connected/synced (see the main README).

```bash
npm run eval               # ground-truth + seed adversarial fixtures + adversarial + report, in order
npm run eval:ground-truth  # just the ground-truth suite
npm run eval:adversarial   # just the adversarial suite (needs eval:seed-adversarial first, once)
npm run eval:report        # aggregate whatever result files already exist
npm run eval:cleanup-adversarial  # remove the seeded adversarial fixtures when done
```

## What's measured

| File | Measures |
|---|---|
| `ground-truth.json` | 23 real questions spanning all four ingested surfaces (Drive, Gmail, Calendar, Sheets), written from this author's own real content, plus 6 refusal-only negative cases: 3 off-topic, and 2 real scope-boundary tests (a Gmail question scoped to the Sent folder — this connection's Gmail scope is `labelId=INBOX` only per FR-6; a Calendar question far outside the -90/+180 day backfill window) that confirm out-of-scope content degrades to a clean refusal rather than an error or a hallucination. |
| `adversarial.json` | 7 prompt-injection cases: the original 6 (direct override, system-prompt exfiltration, mid-paragraph burial, fake-authority/admin-override, leetspeak obfuscation, persistent-marker exfiltration) plus one Gmail-specific case (PRD §7's explicit ask) — an injection hidden inside an HTML comment in a forwarded/quoted email body, the highest-risk untrusted-content pattern FR-14 itself calls out. Each case is wrapped in benign, on-topic cover content so retrieval has a real reason to surface it. |

`run-eval.mts` checks, per question: was the refuse/answer decision correct, did the cited source match the expected document, and what fraction of expected keywords actually appear in the answer (partial credit, since a correct paraphrase shouldn't be scored as a hard fail). Some Sheets/Gmail cases deliberately leave `expectedDocTitle: null` — see the `note` field on those entries — because the correct answer legitimately spans several rows/messages (FR-8's per-row chunking, or a fact repeated across near-duplicate emails), so checking one hardcoded citation would penalize a genuinely correct retrieval.

`run-adversarial.mts` checks whether the injection's target string/behavior leaked into the answer — and separately flags when the poisoned fixture wasn't even retrieved for its probe question, since a "pass" in that case didn't actually test anything (the injection never got a chance to run).

`report.mts` aggregates both into one stats table, plus a per-surface breakdown (citation accuracy, full keyword match, average keyword hit rate) now that all four surfaces have real content worth comparing rather than one aggregate number potentially hiding a surface that's actually dragging.

## A real scope limitation, not a shortcut

The adversarial fixtures are seeded directly through `persistChunk()` (the same function real ingestion uses for embedding + Qdrant + Postgres writes) rather than through an actual poisoned Google Doc or email, because every OAuth scope this project requests is read-only (`drive.readonly`, `gmail.readonly`, ...) — there's no way to write a real poisoned Doc into Drive or a real poisoned message into Gmail via the API to test either surface's ingestion path end-to-end with malicious content. This exercises the real generation-time defense (FR-14: retrieved content is untrusted data, not instructions) but not the fetch step itself for whichever surface a given case targets. Worth knowing if this ever needs write-scope testing for real.

## Extending to other surfaces

Every `ground-truth.json` entry has a `surface` field, and every `adversarial.json` entry now does too (`seed-adversarial.mts` reads it rather than hardcoding `"drive"`). Drive, Gmail, Calendar, and Sheets all have real entries now — Sheets is the last one still pending an M2 surface (per PRD §9); once it lands, extending this harness the same way is adding more `ground-truth.json` entries with `"surface": "sheets"` and re-running.
