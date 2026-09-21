"use client";

import { motion } from "framer-motion";
import { EASE } from "@/components/marketing/Reveal";

const MIN = 0.0002;
// Headroom past 1.0 so the last axis tick isn't clipped by the container.
const MAX = 1.6;
const THRESHOLD = 0.02;

// Log scale: the interesting part (0.0004 vs 0.05) spans two orders of
// magnitude, which a linear axis would squash into the left edge.
const pos = (v: number) => ((Math.log10(v) - Math.log10(MIN)) / (Math.log10(MAX) - Math.log10(MIN))) * 100;

// Real reranker scores seen while building and testing Relay — not a
// benchmark and not the whole set, just enough to show where the line sits.
const POINTS = [
  { v: 0.00037, refused: true },
  { v: 0.002, refused: true },
  { v: 0.0025, refused: true },
  { v: 0.01, refused: true },
  { v: 0.025, refused: false },
  { v: 0.048, refused: false },
  { v: 0.091, refused: false },
  { v: 0.271, refused: false },
  { v: 0.607, refused: false },
] as const;

const TICKS = [0.001, 0.01, 0.1, 1];

export default function ConfidenceGate() {
  return (
    <figure>
      <div className="relative h-56 select-none">
        {/* zones */}
        <div className="absolute inset-y-0 left-0 bg-danger/[0.05]" style={{ width: `${pos(THRESHOLD)}%` }} />
        <div className="absolute inset-y-0 right-0 bg-success/[0.05]" style={{ width: `${100 - pos(THRESHOLD)}%` }} />
        <span className="absolute left-3 top-3 font-mono text-[11px] uppercase tracking-[0.12em] text-danger">
          refuses
        </span>
        <span className="absolute right-3 top-3 font-mono text-[11px] uppercase tracking-[0.12em] text-success">
          answers + cites
        </span>

        {/* the gate */}
        <motion.div
          aria-hidden="true"
          className="absolute inset-y-0 w-px origin-top bg-foreground"
          style={{ left: `${pos(THRESHOLD)}%` }}
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true, margin: "-15% 0px" }}
          transition={{ duration: 0.8, ease: EASE }}
        />
        <span
          className="absolute bottom-3 -translate-x-1/2 whitespace-nowrap bg-background px-1.5 font-mono text-[11px] text-foreground"
          style={{ left: `${pos(THRESHOLD)}%` }}
        >
          gate 0.02
        </span>

        {/* axis */}
        <div className="absolute inset-x-0 top-[62%] h-px bg-border" />
        {TICKS.map((t) => (
          <span
            key={t}
            className="absolute top-[62%] -translate-x-1/2 pt-2 font-mono text-[11px] text-muted"
            style={{ left: `${pos(t)}%` }}
          >
            {t}
          </span>
        ))}

        {/* scores: hollow = refused, filled = answered (shape, not just colour) */}
        {POINTS.map((p, i) => (
          <motion.div
            key={p.v}
            role="img"
            aria-label={`Score ${p.v}, ${p.refused ? "refused" : "answered"}`}
            tabIndex={0}
            className="group absolute top-[62%] -ml-[7px] -mt-[7px] focus-visible:outline-none"
            style={{ left: `${pos(p.v)}%` }}
            initial={{ opacity: 0, y: -70 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-15% 0px" }}
            transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.5 + i * 0.07 }}
          >
            <span
              className={
                "block size-3.5 rounded-full border-2 transition-transform group-hover:scale-125 group-focus-visible:scale-125 group-focus-visible:ring-2 group-focus-visible:ring-accent " +
                (p.refused ? "border-danger bg-background" : "border-success bg-success")
              }
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded border border-border bg-surface px-2 py-1 font-mono text-[11px] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              {p.v}
            </span>
          </motion.div>
        ))}
      </div>
      <figcaption className="mt-4 max-w-[62ch] font-mono text-xs leading-relaxed text-muted">
        Log scale. A subset of reranker scores seen while building and testing Relay, hollow for refused, filled for
        answered. Illustrative, not a benchmark.
      </figcaption>
    </figure>
  );
}
