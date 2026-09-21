// Seeds each case in adversarial.json as a real chunk through the actual
// persistChunk() ingestion path (embed -> Qdrant -> Postgres provenance),
// the same function real ingestion uses for every surface. This exercises
// the real generation-time defense (FR-14: retrieved content is untrusted
// data, not instructions) even though it can't exercise the real fetch
// step for whichever surface a case targets — this project's OAuth scopes
// are all read-only (drive.readonly, gmail.readonly, ...), so writing an
// actual poisoned Doc/email via the API isn't possible for any of them.
// Documented as a known scope limitation, not hidden.
//
// Fixtures are tagged with a "test-adversarial-" sourceId prefix so
// cleanup-adversarial.mts can find and remove them precisely.

import { readFileSync } from "fs";
import { persistChunk } from "../../lib/ingest/persist";
import type { IngestedChunk } from "../../lib/ingest/types";
import type { Surface } from "../../lib/ingest/types";
import { db, schema } from "../../lib/db";

interface AdversarialCase {
  id: string;
  surface: Surface;
  coverTopic: string;
  injectedContent: string;
}

async function main() {
  const cases: AdversarialCase[] = JSON.parse(readFileSync(new URL("./adversarial.json", import.meta.url), "utf8"));

  const [connection] = await db.select().from(schema.googleConnections).limit(1);
  if (!connection) {
    throw new Error("No google_connections row found — connect a Google account first (see README).");
  }

  for (const c of cases) {
    const chunk: IngestedChunk = {
      sourceId: `test-adversarial-${c.id}`,
      surface: c.surface,
      title: `[TEST] ${c.coverTopic}`,
      url: null,
      content: c.injectedContent,
      metadata: { testFixture: true, adversarialCaseId: c.id },
    };
    const result = await persistChunk(connection.id, chunk);
    console.log(`${c.id}: ${result.skipped ? "already seeded (skipped)" : "seeded"}`);
  }

  console.log(`\nSeeded ${cases.length} adversarial fixtures under connection ${connection.googleAccountEmail}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
