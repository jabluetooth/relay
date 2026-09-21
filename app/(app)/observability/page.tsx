"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { FileText, Mail, Calendar as CalendarIcon, Table, CheckCircle2, XCircle } from "lucide-react";
import SyncStatus from "@/components/ui/SyncStatus";
import Drawer from "@/components/ui/Drawer";
import Modal from "@/components/ui/Modal";
import MetricCard from "@/components/ui/MetricCard";
import { fetchJson, SERVER_DOWN_HINT } from "@/lib/fetch-json";
import RecentQueriesPanel, { type RecentQuery } from "@/components/RecentQueriesPanel";

interface DayPoint {
  date: string;
  count: number;
  refusalRate: number | null;
  avgLatencyMs: number | null;
}

interface SurfaceStat {
  surface: string;
  lastSyncedAt: string | null;
  lagMinutes: number | null;
  lastError: string | null;
  syncing: boolean;
  autoSyncEnabled: boolean;
}

interface ObservabilityData {
  queryVolume: { total: number; last24h: number; last7d: number };
  refusalRate: { overall: number | null; last24h: number | null };
  latency: { avgMs: number | null; p50Ms: number | null; p95Ms: number | null; avgAnsweredMs: number | null; avgRefusedMs: number | null };
  surfaces: SurfaceStat[];
  daily: DayPoint[];
  trendDays: number;
  trends: { volumePct: number | null; refusalRatePct: number | null; latencyPct: number | null };
}

const RANGE_OPTIONS = [7, 14, 30] as const;

const SURFACE_ICON: Record<string, typeof FileText> = {
  drive: FileText,
  gmail: Mail,
  calendar: CalendarIcon,
  sheets: Table,
};

function fmtMs(ms: number | null): string {
  return ms === null ? "—" : `${Math.round(ms)}ms`;
}

function fmtPct(n: number | null): string {
  return n === null ? "—" : `${(n * 100).toFixed(0)}%`;
}

const fadeUp = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } };

function fmtLag(minutes: number | null): string {
  if (minutes === null) return "never synced";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export default function ObservabilityPage() {
  const [data, setData] = useState<ObservabilityData | null>(null);
  const [days, setDays] = useState<(typeof RANGE_OPTIONS)[number]>(14);

  // Selected-item state is kept separate from the drawer/modal's open
  // state and never cleared on close — only replaced when something new is
  // selected — so the closing exit animation slides/fades out real content
  // instead of the panel going blank the instant it starts closing.
  const [surfaceDrawerOpen, setSurfaceDrawerOpen] = useState(false);
  const [selectedSurface, setSelectedSurface] = useState<SurfaceStat | null>(null);
  const [queryModalOpen, setQueryModalOpen] = useState(false);
  const [selectedQuery, setSelectedQuery] = useState<RecentQuery | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchJson<ObservabilityData>(`/api/observability?days=${days}`)
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Request failed.");
      });
    return () => {
      cancelled = true;
    };
  }, [days, attempt]);

  function retry() {
    setError(null);
    setAttempt((n) => n + 1);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Observability</h1>
        <p className="mt-1 text-sm text-muted">Query health and per-surface sync freshness, at a glance.</p>
      </header>

      {error && !data ? (
        <div role="alert" className="rounded border border-danger/40 bg-surface p-5">
          <p className="font-mono text-xs uppercase tracking-wide text-danger">Couldn&apos;t load metrics</p>
          <p className="mt-2 text-sm text-muted">{SERVER_DOWN_HINT}</p>
          <p className="mt-1 font-mono text-xs text-muted">{error}</p>
          <button
            onClick={retry}
            className="mt-4 rounded border border-border px-3 py-1.5 font-mono text-xs transition-colors hover:border-accent hover:text-accent"
          >
            Retry
          </button>
        </div>
      ) : !data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded border border-border bg-surface" />
          ))}
        </div>
      ) : (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
          className="space-y-8"
        >
          <motion.section variants={fadeUp} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Trends</h2>
              <div className="flex items-center gap-0.5 rounded border border-border bg-background p-0.5">
                {RANGE_OPTIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    aria-current={days === d ? "true" : undefined}
                    className={
                      "rounded px-2.5 py-1 font-mono text-xs transition-colors " +
                      (days === d ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground")
                    }
                  >
                    {d}D
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MetricCard
                id="volume"
                label="Query volume"
                headline={Intl.NumberFormat(undefined, { notation: "compact" }).format(data.queryVolume.total)}
                data={data.daily.map((d) => ({ date: d.date, value: d.count }))}
                trendPct={data.trends.volumePct}
                increaseIsGood
                formatValue={(v) => `${Math.round(v)} queries`}
                footer={[
                  { label: "24h", value: String(data.queryVolume.last24h) },
                  { label: "7d", value: String(data.queryVolume.last7d) },
                  { label: "total", value: String(data.queryVolume.total) },
                ]}
              />
              <MetricCard
                id="refusal"
                label="Refusal rate"
                headline={fmtPct(data.refusalRate.overall)}
                data={data.daily.map((d) => ({ date: d.date, value: d.refusalRate !== null ? d.refusalRate * 100 : null }))}
                trendPct={data.trends.refusalRatePct}
                increaseIsGood={false}
                formatValue={(v) => `${v.toFixed(0)}%`}
                footer={[
                  { label: "24h", value: fmtPct(data.refusalRate.last24h) },
                  { label: "overall", value: fmtPct(data.refusalRate.overall) },
                ]}
              />
              <MetricCard
                id="latency"
                label="Latency"
                headline={fmtMs(data.latency.avgMs)}
                data={data.daily.map((d) => ({ date: d.date, value: d.avgLatencyMs }))}
                trendPct={data.trends.latencyPct}
                increaseIsGood={false}
                formatValue={(v) => `${Math.round(v)}ms`}
                footer={[
                  { label: "p50", value: fmtMs(data.latency.p50Ms) },
                  { label: "p95", value: fmtMs(data.latency.p95Ms) },
                  { label: "avg", value: fmtMs(data.latency.avgMs) },
                ]}
              />
            </div>
          </motion.section>

          <motion.section variants={fadeUp} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">Per-surface sync lag</h2>
            {data.surfaces.length === 0 ? (
              <p className="rounded border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
                No surfaces synced yet.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {data.surfaces.map((s, i) => {
                  const Icon = SURFACE_ICON[s.surface] ?? FileText;
                  return (
                    <motion.li
                      key={s.surface}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.18 }}
                    >
                      <motion.button
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.99 }}
                        onClick={() => {
                          setSelectedSurface(s);
                          setSurfaceDrawerOpen(true);
                        }}
                        className="flex w-full items-center justify-between gap-3 rounded border border-border bg-surface px-3 py-2.5 text-left text-sm transition-colors hover:border-accent/40 hover:bg-foreground/[0.03]"
                      >
                        <span className="inline-flex items-center gap-2 font-mono font-medium">
                          <Icon className="size-4 text-muted" aria-hidden="true" />
                          {s.surface}
                          {s.autoSyncEnabled ? (
                            <span className="inline-flex items-center gap-1 rounded bg-success/10 px-2 py-0.5 text-xs font-normal text-success">
                              <CheckCircle2 className="size-3" aria-hidden="true" />
                              auto
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-muted/10 px-2 py-0.5 text-xs font-normal text-muted">
                              <XCircle className="size-3" aria-hidden="true" />
                              manual
                            </span>
                          )}
                        </span>
                        <SyncStatus
                          syncing={s.syncing}
                          lastSyncedAt={s.lastSyncedAt}
                          lastError={s.lastError}
                          format={() => fmtLag(s.lagMinutes)}
                        />
                      </motion.button>
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </motion.section>

          <motion.section variants={fadeUp} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">Recent queries</h2>
            <RecentQueriesPanel
              onSelect={(q) => {
                setSelectedQuery(q);
                setQueryModalOpen(true);
              }}
            />
          </motion.section>
        </motion.div>
      )}

      {selectedSurface && (
        <Drawer
          open={surfaceDrawerOpen}
          onClose={() => setSurfaceDrawerOpen(false)}
          title={selectedSurface.surface}
          icon={(() => {
            const Icon = SURFACE_ICON[selectedSurface.surface] ?? FileText;
            return <Icon className="size-4 text-muted" aria-hidden="true" />;
          })()}
        >
          <div className="space-y-4 text-sm">
            <div className="rounded border border-border px-3 py-2.5">
              <SyncStatus
                detail
                syncing={selectedSurface.syncing}
                lastSyncedAt={selectedSurface.lastSyncedAt}
                lastError={selectedSurface.lastError}
              />
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between border-b border-border pb-2">
                <dt className="text-muted">Freshness</dt>
                <dd className="font-mono tabular-nums">{fmtLag(selectedSurface.lagMinutes)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Auto-sync</dt>
                <dd className="font-mono">{selectedSurface.autoSyncEnabled ? "on" : "off"}</dd>
              </div>
            </dl>
            <Link
              href="/connections"
              className="inline-block text-sm text-accent underline underline-offset-2"
            >
              Manage in Connections
            </Link>
          </div>
        </Drawer>
      )}

      <Modal open={queryModalOpen} onClose={() => setQueryModalOpen(false)} title="Query detail">
        {selectedQuery && (
          <div className="space-y-3 text-sm">
            <p className="whitespace-pre-wrap rounded border border-border bg-background px-3 py-2.5">
              {selectedQuery.query}
            </p>
            <dl className="space-y-2">
              <div className="flex justify-between border-b border-border pb-2">
                <dt className="text-muted">Result</dt>
                <dd>
                  {selectedQuery.refused ? (
                    <span className="inline-flex items-center gap-1 text-danger">
                      <XCircle className="size-3.5" aria-hidden="true" />
                      Refused
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-success">
                      <CheckCircle2 className="size-3.5" aria-hidden="true" />
                      Answered
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between border-b border-border pb-2">
                <dt className="text-muted">Confidence</dt>
                <dd className="font-mono tabular-nums">
                  {selectedQuery.confidence !== null ? selectedQuery.confidence.toFixed(3) : "—"}
                </dd>
              </div>
              <div className="flex justify-between border-b border-border pb-2">
                <dt className="text-muted">Latency</dt>
                <dd className="font-mono tabular-nums">{fmtMs(selectedQuery.latencyMs)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Asked</dt>
                <dd className="font-mono">{new Date(selectedQuery.createdAt).toLocaleString()}</dd>
              </div>
            </dl>
          </div>
        )}
      </Modal>
    </div>
  );
}
