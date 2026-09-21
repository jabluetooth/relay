// Removes every seeded adversarial fixture (sourceId prefix "test-adversarial-")
// from both Postgres (documents -> cascades to chunks/citations) and Qdrant
// (points aren't cascaded automatically, so they're deleted explicitly first).

import { like, inArray } from "drizzle-orm";
import { db, schema } from "../../lib/db";
import { deletePoints } from "../../lib/qdrant";

async function main() {
  const docs = await db
    .select({ id: schema.documents.id, sourceId: schema.documents.sourceId })
    .from(schema.documents)
    .where(like(schema.documents.sourceId, "test-adversarial-%"));

  if (docs.length === 0) {
    console.log("No adversarial fixtures found — nothing to clean up.");
    process.exit(0);
  }

  const docIds = docs.map((d) => d.id);
  const rows = await db
    .select({ qdrantPointId: schema.chunks.qdrantPointId })
    .from(schema.chunks)
    .where(inArray(schema.chunks.documentId, docIds));

  await deletePoints(rows.map((r) => r.qdrantPointId));
  await db.delete(schema.documents).where(inArray(schema.documents.id, docIds));

  console.log(`Removed ${docs.length} adversarial fixture document(s) and ${rows.length} chunk(s)/point(s).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
