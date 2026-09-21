"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Search, X, CheckCircle2, XCircle } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";

export interface RecentQuery {
  id: string;
  query: string;
  latencyMs: number | null;
  refused: boolean;
  confidence: number | null;
  createdAt: string;
}

function fmtMs(ms: number | null): string {
  return ms === null ? "—" : `${Math.round(ms)}ms`;
}

// Debounced so typing doesn't fire a query per keystroke — 300ms matches
// the tooltip delay elsewhere (Law #90's reasoning applies just as well to
// search-as-you-type).
const DEBOUNCE_MS = 300;

// A real searchable/filterable log view instead of a static top-20 list —
// every filter change re-queries query_logs directly
// (app/api/observability/queries/route.ts), so search reaches the full
// history, not just whatever rows happened to already be on the page.
export default function RecentQueriesPanel({ onSelect }: { onSelect: (q: RecentQuery) => void }) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [queries, setQueries] = useState<RecentQuery[] | null>(null);

  const hasFilters = q.trim() !== "" || from !== "" || to !== "";

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      try {
        const json = await fetchJson<{ queries?: RecentQuery[] }>(`/api/observability/queries?${params.toString()}`);
        if (!cancelled) setQueries(json.queries ?? []);
      } catch {
        // Backend unreachable — keep whatever is already shown; the page
        // above surfaces the outage with a retry.
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, from, to]);

  function clearFilters() {
    setQ("");
    setFrom("");
    setTo("");
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded border border-border bg-background px-3 py-2">
          <Search className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search queries…"
            aria-label="Search queries"
            className="w-full min-w-0 bg-transparent font-mono text-xs outline-none"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <span className="hidden sm:inline">from</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From date"
            className="rounded border border-border bg-background px-2 py-2 font-mono text-xs"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <span className="hidden sm:inline">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To date"
            className="rounded border border-border bg-background px-2 py-2 font-mono text-xs"
          />
        </label>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-2 font-mono text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent"
          >
            <X className="size-3.5" aria-hidden="true" />
            clear
          </button>
        )}
      </div>

      {queries === null ? (
        <div className="space-y-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded border border-border bg-surface" />
          ))}
        </div>
      ) : queries.length === 0 ? (
        <p className="rounded border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          {hasFilters ? "No queries match these filters." : "No queries logged yet."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {queries.map((query, i) => (
            <motion.li
              key={query.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03, duration: 0.18 }}
            >
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => onSelect(query)}
                className="w-full rounded border border-border bg-surface px-3 py-2.5 text-left text-xs transition-colors hover:border-accent/40 hover:bg-foreground/[0.03]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{query.query}</span>
                  <span className="shrink-0 font-mono tabular-nums text-muted">{fmtMs(query.latencyMs)}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 font-mono text-muted">
                  {query.refused ? (
                    <span className="inline-flex items-center gap-1 text-danger">
                      <XCircle className="size-3" aria-hidden="true" />
                      refused
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-success">
                      <CheckCircle2 className="size-3" aria-hidden="true" />
                      answered
                    </span>
                  )}
                  {query.confidence !== null && <span className="tabular-nums">· confidence {query.confidence.toFixed(3)}</span>}
                  <span>· {new Date(query.createdAt).toLocaleString()}</span>
                </div>
              </motion.button>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}
