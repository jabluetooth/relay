import { QdrantClient, type Schemas } from "@qdrant/js-client-rest";

const COLLECTION = "relay_chunks";
const VECTOR_SIZE = 384; // BAAI/bge-small-en-v1.5, same model as Mimo

let client: QdrantClient | null = null;

export function qdrant(): QdrantClient {
  if (!client) {
    const url = process.env.QDRANT_URL;
    if (!url) throw new Error("QDRANT_URL is not set — see .env.example");
    // apiKey is undefined (not an empty string) when QDRANT_API_KEY is unset,
    // which the client correctly treats as "no auth header" rather than
    // sending a blank one that would fail against an authenticated instance.
    client = new QdrantClient({ url, apiKey: process.env.QDRANT_API_KEY || undefined });
  }
  return client;
}

/** Idempotent — creates the collection if absent. Memoized so concurrent
 * callers in the same process share one in-flight check/create instead of
 * racing to create it multiple times. */
let ensured: Promise<void> | null = null;
export function ensureCollection(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const c = qdrant();
      const { collections } = await c.getCollections();
      if (collections.some((col) => col.name === COLLECTION)) return;
      await c.createCollection(COLLECTION, {
        vectors: { size: VECTOR_SIZE, distance: "Cosine" },
      });
    })().catch((err) => {
      ensured = null; // don't cache a failure — let the next call retry
      throw err;
    });
  }
  return ensured;
}

export interface QdrantPayload {
  documentId: string;
  connectionId: string;
  surface: string;
  content: string;
  [key: string]: unknown;
}

export async function upsertPoint(pointId: string, vector: number[], payload: QdrantPayload): Promise<void> {
  await ensureCollection();
  await qdrant().upsert(COLLECTION, {
    points: [{ id: pointId, vector, payload }],
  });
}

/** Nearest-neighbor search. `.search()` is deprecated in this client version; `.query()` is the replacement. */
export async function searchPoints(vector: number[], limit: number): Promise<Schemas["ScoredPoint"][]> {
  await ensureCollection();
  const { points } = await qdrant().query(COLLECTION, { query: vector, limit, with_payload: true });
  return points;
}

export async function deletePoints(pointIds: string[]): Promise<void> {
  if (pointIds.length === 0) return;
  await qdrant().delete(COLLECTION, { points: pointIds });
}

export { COLLECTION };
