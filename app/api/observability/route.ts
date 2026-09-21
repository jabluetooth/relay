import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// FR-20: query volume, refusal rate, per-surface sync lag, and latency —
// the same observability differentiator already shipped in Mimo and
// Insight, applied here. Bounded to the most recent 2000 query_logs rows
// rather than a real paginated aggregate query (e.g. Postgres's own
// PERCENTILE_CONT) — this is a single-user app, not pagination-scale yet,
// and computing percentiles in JS over a small array is simpler to reason
// about than a SQL window function for the volume this will ever see.
const MAX_LOGS = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;
// 14 days is the default, not 30 — this is a single-user dev/testing app
// (real volume is dozens of queries a day at most), so a shorter default
// window keeps the daily trend chart from being mostly empty days. 7/30
// are offered as a real range control, not just 14.
const ALLOWED_TREND_DAYS = [7, 14, 30] as const;
const DEFAULT_TREND_DAYS = 14;

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function avg(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, n) => sum + n, 0) / values.length;
}

function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export async function GET(req: Request) {
  const requestedDays = Number(new URL(req.url).searchParams.get("days"));
  const trendDays = (ALLOWED_TREND_DAYS as readonly number[]).includes(requestedDays)
    ? requestedDays
    : DEFAULT_TREND_DAYS;

  const logs = await db
    .select({
      id: schema.queryLogs.id,
      query: schema.queryLogs.query,
      latencyMs: schema.queryLogs.latencyMs,
      refused: schema.queryLogs.refused,
      confidence: schema.queryLogs.confidence,
      createdAt: schema.queryLogs.createdAt,
    })
    .from(schema.queryLogs)
    .orderBy(desc(schema.queryLogs.createdAt))
    .limit(MAX_LOGS);

  const now = Date.now();
  const last24h = logs.filter((l) => now - l.createdAt.getTime() < DAY_MS);
  const last7d = logs.filter((l) => now - l.createdAt.getTime() < 7 * DAY_MS);

  const refusedCount = logs.filter((l) => l.refused).length;
  const refusedCount24h = last24h.filter((l) => l.refused).length;

  const allLatencies = logs.map((l) => l.latencyMs ?? 0).sort((a, b) => a - b);
  const answeredLatencies = logs.filter((l) => !l.refused).map((l) => l.latencyMs ?? 0);
  const refusedLatencies = logs.filter((l) => l.refused).map((l) => l.latencyMs ?? 0);

  // Real daily buckets for the trend charts — built from the same `logs`
  // array already fetched above, not a separate query. Days with zero
  // queries stay in the series as real zeros rather than being dropped, so
  // the chart's x-axis is an honest continuous timeline. Bucketed over
  // 2×trendDays so the trend badge can compare a full `trendDays`-long
  // "current" period against an equally long "previous" period, while the
  // chart itself only plots the more recent `trendDays` half.
  const bucketWindow = trendDays * 2;
  const dayBuckets: Array<{ date: string; count: number; refused: number; latencySum: number; latencyCount: number }> =
    [];
  const bucketByDate = new Map<string, (typeof dayBuckets)[number]>();
  for (let i = bucketWindow - 1; i >= 0; i--) {
    const date = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    const bucket = { date, count: 0, refused: 0, latencySum: 0, latencyCount: 0 };
    dayBuckets.push(bucket);
    bucketByDate.set(date, bucket);
  }
  for (const log of logs) {
    const bucket = bucketByDate.get(log.createdAt.toISOString().slice(0, 10));
    if (!bucket) continue; // older than the bucket window
    bucket.count++;
    if (log.refused) bucket.refused++;
    if (log.latencyMs !== null) {
      bucket.latencySum += log.latencyMs;
      bucket.latencyCount++;
    }
  }
  const allDaily = dayBuckets.map((b) => ({
    date: b.date,
    count: b.count,
    refusalRate: b.count > 0 ? b.refused / b.count : null,
    avgLatencyMs: b.latencyCount > 0 ? b.latencySum / b.latencyCount : null,
  }));

  // The chart only ever plots the current (most recent) period — the older
  // half exists purely to give the trend badge something real to compare
  // against.
  const daily = allDaily.slice(trendDays);
  const previousPeriod = allDaily.slice(0, trendDays);

  // Trend = this period's total/average vs. the prior period's — real
  // period-over-period comparison, not a fabricated sparkline. `pct` is a
  // plain percent change; the dashboard decides per-metric whether "up" is
  // good or bad (more queries is neutral, more refusals or latency is not).
  const currentCount = daily.reduce((sum, d) => sum + d.count, 0);
  const previousCount = previousPeriod.reduce((sum, d) => sum + d.count, 0);
  const currentRefusalRate = avg(daily.filter((d) => d.refusalRate !== null).map((d) => d.refusalRate as number));
  const previousRefusalRate = avg(
    previousPeriod.filter((d) => d.refusalRate !== null).map((d) => d.refusalRate as number)
  );
  const currentLatency = avg(daily.filter((d) => d.avgLatencyMs !== null).map((d) => d.avgLatencyMs as number));
  const previousLatency = avg(
    previousPeriod.filter((d) => d.avgLatencyMs !== null).map((d) => d.avgLatencyMs as number)
  );

  const surfaceSyncRows = await db.select().from(schema.surfaceSync);
  const connections = await db.select().from(schema.googleConnections);
  const connById = new Map(connections.map((c) => [c.id, c]));

  const surfaces = surfaceSyncRows.map((s) => ({
    surface: s.surface,
    lastSyncedAt: s.lastSyncedAt,
    lagMinutes: s.lastSyncedAt ? Math.round((now - s.lastSyncedAt.getTime()) / 60_000) : null,
    lastError: s.lastError,
    syncing: s.syncStartedAt !== null,
    autoSyncEnabled: connById.get(s.connectionId)?.autoSyncEnabled ?? false,
  }));

  return NextResponse.json({
    queryVolume: { total: logs.length, last24h: last24h.length, last7d: last7d.length },
    refusalRate: {
      overall: logs.length ? refusedCount / logs.length : null,
      last24h: last24h.length ? refusedCount24h / last24h.length : null,
    },
    latency: {
      avgMs: avg(allLatencies),
      p50Ms: percentile(allLatencies, 0.5),
      p95Ms: percentile(allLatencies, 0.95),
      avgAnsweredMs: avg(answeredLatencies),
      avgRefusedMs: avg(refusedLatencies),
    },
    surfaces,
    daily,
    trendDays,
    trends: {
      volumePct: pctChange(currentCount, previousCount),
      refusalRatePct: pctChange(currentRefusalRate, previousRefusalRate),
      latencyPct: pctChange(currentLatency, previousLatency),
    },
  });
}
