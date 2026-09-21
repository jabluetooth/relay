"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { RotateCcw } from "lucide-react";
import { EASE } from "@/components/marketing/Reveal";

// Measures how far a block can travel along a track, so the demos animate
// `transform: translateX` (compositor-only) instead of `left`.
function useTrackDistance(blockPx: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [dist, setDist] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDist(Math.max(0, el.clientWidth - blockPx - 8)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [blockPx]);
  return [ref, dist] as const;
}

function Card({
  title,
  note,
  onReplay,
  children,
}: {
  title: string;
  note: string;
  onReplay?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{title}</span>
        {onReplay && (
          <button
            onClick={onReplay}
            aria-label={`Replay ${title}`}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RotateCcw className="size-3" aria-hidden="true" />
            replay
          </button>
        )}
      </div>
      <div className="flex-1 p-5">{children}</div>
      <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">{note}</p>
    </div>
  );
}

const BLOCK = 24;

export default function MotionLab() {
  const [race, setRace] = useState(0);
  const [stagger, setStagger] = useState(0);
  const [sprung, setSprung] = useState(false);
  const [raceRef, raceDist] = useTrackDistance(BLOCK);
  const [springRef, springDist] = useTrackDistance(96);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card
        title="easing · linear vs the site curve"
        note="Same distance, same 1.2 seconds. Linear starts and stops like a machine. cubic-bezier(0.16, 1, 0.3, 1) leaves fast and settles slowly, which is how things with weight move."
        onReplay={() => setRace((r) => r + 1)}
      >
        <svg viewBox="0 0 100 100" className="mb-5 h-28 w-full" role="img" aria-label="Plot of the site easing curve against a straight linear line" preserveAspectRatio="none">
          <line x1="0" y1="100" x2="100" y2="0" stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <motion.path
            key={race}
            d="M0 100 C16 0 30 0 100 0"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.2, ease: EASE }}
          />
        </svg>
        <div ref={raceRef} className="space-y-3">
          {[
            { label: "linear", ease: "linear" as const },
            { label: "site curve", ease: EASE },
          ].map((row) => (
            <div key={row.label} className="relative h-7 rounded-sm bg-border/50">
              <span className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                {row.label}
              </span>
              <motion.span
                key={`${race}-${row.label}`}
                className="absolute inset-y-1 left-1 rounded-sm bg-accent"
                style={{ width: BLOCK }}
                initial={{ x: 0 }}
                animate={{ x: raceDist }}
                transition={{ duration: 1.2, ease: row.ease }}
              />
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4">
        <Card
          title="stagger · 60ms per item"
          note="Lists arrive one after another so the eye can follow. Past about 80ms per item it starts to feel slow. Under 30ms it reads as a single block."
          onReplay={() => setStagger((s) => s + 1)}
        >
          <div className="space-y-2">
            {[88, 100, 64, 76, 42].map((w, i) => (
              <motion.div
                key={`${stagger}-${i}`}
                className="h-2.5 origin-left rounded-sm bg-foreground/25"
                style={{ width: `${w}%` }}
                initial={{ scaleX: 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: 1 }}
                transition={{ duration: 0.5, ease: EASE, delay: i * 0.06 }}
              />
            ))}
          </div>
        </Card>

        <Card
          title="spring · nav and drawers"
          note="Springs for things you move yourself: the nav underline (stiffness 500, damping 40) and the drawer (380, 38). Critically damped, so nothing wobbles."
        >
          <div ref={springRef}>
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">click the track</p>
            <button
              onClick={() => setSprung((s) => !s)}
              aria-pressed={sprung}
              aria-label="Move the block with a spring"
              className="relative block h-9 w-full rounded-sm border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <motion.span
                className="absolute inset-y-1 left-1 rounded-sm bg-accent"
                style={{ width: 96 }}
                animate={{ x: sprung ? springDist : 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
