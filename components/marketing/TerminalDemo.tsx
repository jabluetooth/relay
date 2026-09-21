"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ShieldAlert } from "lucide-react";
import { EASE } from "@/components/marketing/Reveal";
import { useReducedMotionSafe } from "@/components/marketing/useReducedMotion";

interface Scenario {
  id: string;
  tab: string;
  q: string;
  answer: string[];
  cites: string[];
  refused?: boolean;
  confidence: number;
}

// Sample data on purpose: this is a public page, so it never shows content
// from a real workspace. The behaviour it plays (cite, or refuse) is real.
const SCENARIOS: Scenario[] = [
  {
    id: "calendar",
    tab: "calendar",
    q: "What's on my calendar this week?",
    answer: [
      "Three things need you this week.",
      "Design review, Tuesday 10:00 [1]",
      "1:1 with Sam, Wednesday 14:30 [2]",
      "Quarterly planning, Friday 09:00 [3]",
    ],
    cites: ["Calendar — Design review", "Calendar — 1:1 with Sam", "Calendar — Quarterly planning"],
    confidence: 0.412,
  },
  {
    id: "gmail",
    tab: "gmail",
    q: "Did the vendor confirm the invoice date?",
    answer: ["Yes. Northwind confirmed payment for 14 October in their reply on Monday [1]."],
    cites: ["Gmail — Re: Invoice 2210"],
    confidence: 0.267,
  },
  {
    id: "sheets",
    tab: "sheets",
    q: "Which pipeline runs failed last week?",
    answer: ["Two runs failed. run_0412 (pricing) and run_0417 (onboarding) both ended with status failed [1][2]."],
    cites: ["Runs — Sheet1 (row 12)", "Runs — Sheet1 (row 17)"],
    confidence: 0.198,
  },
  {
    id: "refusal",
    tab: "no match",
    q: "What's my landlord's phone number?",
    answer: ["Nothing in your connected sources supports an answer, so I won't guess."],
    cites: [],
    refused: true,
    confidence: 0.0004,
  },
];

type Phase = "typing" | "thinking" | "answering" | "done";

function AnswerLine({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[\d\])/g).map((part, i) =>
        /^\[\d\]$/.test(part) ? (
          <sup key={i} className="ml-0.5 font-mono text-[10px] text-accent">
            {part}
          </sup>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export default function TerminalDemo() {
  const reduced = useReducedMotionSafe();
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");
  const [lines, setLines] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  const scenario = SCENARIOS[index];

  useEffect(() => {
    if (reduced) return;
    const s = SCENARIOS[index];
    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    (async () => {
      setPhase("typing");
      setTyped(0);
      setLines(0);
      for (let i = 1; i <= s.q.length; i++) {
        if (cancelled) return;
        setTyped(i);
        await sleep(26);
      }
      await sleep(260);
      if (cancelled) return;
      setPhase("thinking");
      await sleep(900);
      if (cancelled) return;
      setPhase("answering");
      for (let i = 1; i <= s.answer.length; i++) {
        if (cancelled) return;
        setLines(i);
        await sleep(300);
      }
      if (cancelled) return;
      setPhase("done");
      await sleep(4200);
      // Hovering or focusing the demo holds it on the finished answer.
      while (pausedRef.current && !cancelled) await sleep(250);
      if (!cancelled) setIndex((i) => (i + 1) % SCENARIOS.length);
    })();

    return () => {
      cancelled = true;
    };
  }, [index, reduced]);

  // Reduced motion: no typing, no autoplay — the full transcript is simply
  // shown, and the tabs are the only thing that changes it.
  const shownTyped = reduced ? scenario.q.length : typed;
  const shownPhase: Phase = reduced ? "done" : phase;
  const shownLines = reduced ? scenario.answer.length : lines;

  function hold(value: boolean) {
    pausedRef.current = value;
    setPaused(value);
  }

  return (
    <div
      onMouseEnter={() => hold(true)}
      onMouseLeave={() => hold(false)}
      onFocus={() => hold(true)}
      onBlur={() => hold(false)}
      className="rounded border border-border bg-surface"
    >
      <p className="sr-only">
        Product demo on sample data. Relay answers a question and cites each source, or refuses when nothing supports
        an answer.
      </p>

      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="size-2 rounded-full bg-danger/50" />
            <span className="size-2 rounded-full bg-accent/50" />
            <span className="size-2 rounded-full bg-success/50" />
          </div>
          <span className="font-mono text-xs text-muted">relay — chat</span>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
          {paused && !reduced ? "paused" : "sample data"}
        </span>
      </div>

      <div aria-hidden="true" className="min-h-[21rem] space-y-4 p-5 text-sm">
        <p className="flex gap-2.5 font-mono">
          <span className="text-accent">&gt;</span>
          <span>
            {scenario.q.slice(0, shownTyped)}
            {shownPhase === "typing" && (
              <motion.span
                className="ml-px inline-block h-[1em] w-[0.55em] translate-y-[0.15em] bg-accent"
                animate={{ opacity: [1, 1, 0, 0] }}
                transition={{ duration: 0.9, repeat: Infinity, times: [0, 0.5, 0.5, 1], ease: "linear" }}
              />
            )}
          </span>
        </p>

        {shownPhase === "thinking" && (
          <div className="inline-flex items-center gap-1 rounded border border-border px-4 py-3">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="size-1.5 bg-muted"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
              />
            ))}
          </div>
        )}

        {(shownPhase === "answering" || shownPhase === "done") && (
          <div className="space-y-3">
            <div className="max-w-[92%] space-y-1.5 rounded border border-border px-4 py-3 leading-relaxed">
              {scenario.answer.slice(0, shownLines).map((line, i) => (
                <motion.p
                  key={`${scenario.id}-${i}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                >
                  <AnswerLine text={line} />
                </motion.p>
              ))}
            </div>

            {shownPhase === "done" && (
              <div className="space-y-2.5">
                {scenario.cites.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {scenario.cites.map((c, i) => (
                      <motion.li
                        key={c}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: reduced ? 0 : i * 0.07, duration: 0.25 }}
                        className="rounded border border-border px-2.5 py-1 font-mono text-xs text-muted"
                      >
                        {c}
                      </motion.li>
                    ))}
                  </ul>
                )}
                <p className="flex items-center gap-1.5 font-mono text-xs text-muted">
                  {scenario.refused && <ShieldAlert className="size-3.5 text-danger" aria-hidden="true" />}
                  {scenario.refused ? "refused" : "answered"} · confidence {scenario.confidence}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div role="group" aria-label="Demo scenario" className="flex items-center gap-1 border-t border-border p-2">
        {SCENARIOS.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setIndex(i)}
            aria-pressed={i === index}
            className={
              "relative rounded px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
              (i === index ? "text-foreground" : "text-muted hover:text-foreground")
            }
          >
            {i === index && (
              <motion.span
                layoutId="demo-tab"
                className="absolute inset-x-2 -bottom-px h-0.5 bg-accent"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            {s.tab}
          </button>
        ))}
      </div>
    </div>
  );
}
