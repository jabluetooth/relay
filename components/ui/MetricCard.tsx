"use client";

import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";

interface DayPoint {
  date: string;
  value: number | null;
}

interface FooterStat {
  label: string;
  value: string;
}

interface MetricCardProps {
  id: string;
  label: string;
  headline: string;
  data: DayPoint[];
  trendPct: number | null;
  /** Does an increase mean things are getting better? Volume: yes.
   * Refusal rate / latency: no — used to color the trend, independent of
   * which direction the arrow itself points. */
  increaseIsGood: boolean;
  footer: FooterStat[];
  formatValue: (v: number) => string;
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function CustomTooltip({
  active,
  payload,
  formatValue,
}: {
  active?: boolean;
  payload?: Array<{ payload: { date: string; value: number | null } }>;
  formatValue: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded border border-border bg-surface px-2.5 py-2 font-mono text-xs">
      <p className="font-medium text-foreground">{point.value === null ? "no data" : formatValue(point.value)}</p>
      <p className="text-muted">{fmtDate(point.date)}</p>
    </div>
  );
}

// The "headline + trend + sparkline" KPI card pattern (real week-over-week
// data, not a decorative chart) — one card per metric that actually has a
// history worth trending, instead of a flat number with no context.
export default function MetricCard({ id, label, headline, data, trendPct, increaseIsGood, footer, formatValue }: MetricCardProps) {
  const chartData = data.map((d) => ({ date: d.date, value: d.value, plot: d.value ?? 0 }));
  const trendKnown = trendPct !== null;
  const isUp = (trendPct ?? 0) >= 0;
  const isGood = isUp === increaseIsGood;

  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{label}</h3>
        {trendKnown ? (
          <span
            className={"inline-flex items-center gap-1 font-mono text-xs " + (isGood ? "text-success" : "text-danger")}
          >
            {isUp ? <TrendingUp className="size-3" aria-hidden="true" /> : <TrendingDown className="size-3" aria-hidden="true" />}
            {Math.abs(trendPct as number).toFixed(0)}%
          </span>
        ) : (
          <span className="font-mono text-xs text-muted">new</span>
        )}
      </div>

      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{headline}</p>

      <div className="mt-3 h-16">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`metric-grad-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: "var(--accent)", stopOpacity: 0.35 }} />
                <stop offset="100%" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <Tooltip
              content={<CustomTooltip formatValue={formatValue} />}
              cursor={{ stroke: "var(--border)" }}
              wrapperStyle={{ outline: "none" }}
            />
            <Area
              type="monotone"
              dataKey="plot"
              stroke="var(--accent)"
              strokeWidth={1.5}
              fill={`url(#metric-grad-${id})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border pt-3 font-mono text-xs">
        {footer.map((f) => (
          <span key={f.label}>
            <span className="font-medium">{f.value}</span> <span className="text-muted">{f.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
