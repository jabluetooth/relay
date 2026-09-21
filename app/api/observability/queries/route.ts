import { NextResponse } from "next/server";
import { and, desc, gte, ilike, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { escapeLike } from "@/lib/api";

// Backs the Recent Queries search/date-filter UI (separate from the main
// GET /api/observability payload) — a real ILIKE + date-range query against
// query_logs, not a client-side filter over whatever 20 rows happened to
// already be fetched. Re-run on every filter change instead of once on
// page load.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const from = url.searchParams.get("from"); // YYYY-MM-DD, inclusive, local to the browser's own date input
  const to = url.searchParams.get("to");
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), MAX_LIMIT) : DEFAULT_LIMIT;

  const conditions = [];
  if (q) conditions.push(ilike(schema.queryLogs.query, `%${escapeLike(q)}%`));
  if (from) conditions.push(gte(schema.queryLogs.createdAt, new Date(`${from}T00:00:00.000Z`)));
  if (to) conditions.push(lte(schema.queryLogs.createdAt, new Date(`${to}T23:59:59.999Z`)));

  const queries = await db
    .select({
      id: schema.queryLogs.id,
      query: schema.queryLogs.query,
      latencyMs: schema.queryLogs.latencyMs,
      refused: schema.queryLogs.refused,
      confidence: schema.queryLogs.confidence,
      createdAt: schema.queryLogs.createdAt,
    })
    .from(schema.queryLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.queryLogs.createdAt))
    .limit(limit);

  return NextResponse.json({ queries });
}
