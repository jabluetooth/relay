"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useScroll, useSpring } from "framer-motion";
import { EASE } from "@/components/marketing/Reveal";

interface Stage {
  id: "ingest" | "chunk" | "embed" | "rerank" | "gate" | "generate" | "cite";
  title: string;
  body: string;
  specs: [string, string][];
}

// Every number below is read from the code (lib/ingest, lib/rag, lib/qdrant),
// not from marketing copy.
const STAGES: Stage[] = [
  {
    id: "ingest",
    title: "Ingest",
    body: "Adapters pull text from Drive and Docs, Gmail, Calendar and Sheets through Google's read-only APIs. Drive PDFs are read with pdf.js. Gmail reads only the label or dates you configure.",
    specs: [
      ["sources", "drive · gmail · calendar · sheets"],
      ["access", "read-only scopes"],
      ["gmail", "opt-in scope required"],
    ],
  },
  {
    id: "chunk",
    title: "Chunk",
    body: "Prose is cut into pieces of about 1,000 characters with 150 characters of overlap, breaking at a paragraph if it can, then a sentence, then a word. A spreadsheet row is one chunk, with its header cells naming every value.",
    specs: [
      ["size", "~1000 chars"],
      ["overlap", "150 chars"],
      ["sheets", "1 row = 1 chunk"],
    ],
  },
  {
    id: "embed",
    title: "Embed and store",
    body: "Each chunk becomes a vector with BAAI/bge-small-en-v1.5 and is written to Qdrant. Where it came from (source, title, deep link) lives in Postgres. A content hash means unchanged text is never embedded twice.",
    specs: [
      ["model", "BAAI/bge-small-en-v1.5"],
      ["vector", "384 dims · cosine"],
      ["stores", "Qdrant + Postgres"],
    ],
  },
  {
    id: "rerank",
    title: "Retrieve and rerank",
    body: "Vector search casts a wide net and returns 12 candidates. A cross-encoder then reads the question and each candidate together and re-scores them. That is slower than vector search and far more precise, so it only sees the shortlist.",
    specs: [
      ["retrieve", "12 candidates"],
      ["rerank", "BAAI/bge-reranker-v2-m3"],
      ["keep", "top 4"],
    ],
  },
  {
    id: "gate",
    title: "Gate",
    body: "The best reranked score is the confidence. Under 0.02, Relay refuses. In the eval set, unrelated questions scored below 0.003 while answerable ones started near 0.05, so the line sits in a real gap.",
    specs: [
      ["threshold", "0.02"],
      ["below", "refuse"],
      ["above", "answer"],
    ],
  },
  {
    id: "generate",
    title: "Generate",
    body: "Groq runs openai/gpt-oss-120b over the top passages. Retrieved text goes in as untrusted data, never as instructions, and the model is told to copy identifiers exactly. A last step corrects typographic Unicode the model likes to substitute.",
    specs: [
      ["model", "openai/gpt-oss-120b"],
      ["host", "Groq"],
      ["input", "top 4 passages"],
    ],
  },
  {
    id: "cite",
    title: "Cite",
    body: "The answer carries numbered markers that map back to chunks. Each citation opens the retrieved passage in the app and links to the original: a Drive file, a Gmail message, a Calendar event, or the exact Sheets row.",
    specs: [
      ["markers", "[1] [2] …"],
      ["opens", "the passage"],
      ["links", "the original"],
    ],
  },
];

function VizBox({ children }: { children: React.ReactNode }) {
  return <div className="relative flex min-h-44 flex-col justify-center overflow-hidden rounded border border-border bg-surface p-4">{children}</div>;
}

function IngestViz({ active }: { active: boolean }) {
  return (
    <VizBox>
      <div className="flex h-full items-center justify-between gap-3">
        <div className="space-y-2">
          {["drive", "gmail", "calendar", "sheets"].map((n, i) => (
            <motion.div
              key={n}
              animate={{ x: active ? 0 : -14, opacity: active ? 1 : 0.3 }}
              transition={{ duration: 0.5, ease: EASE, delay: i * 0.08 }}
              className="w-fit rounded border border-border px-2 py-1 font-mono text-xs"
            >
              {n}
            </motion.div>
          ))}
        </div>
        <motion.div
          className="h-px flex-1 origin-left bg-accent"
          animate={{ scaleX: active ? 1 : 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.35 }}
        />
        <motion.div
          animate={{ opacity: active ? 1 : 0.3 }}
          transition={{ delay: 0.6 }}
          className="rounded border border-accent px-2.5 py-2 font-mono text-xs text-accent"
        >
          text +
          <br />
          source link
        </motion.div>
      </div>
    </VizBox>
  );
}

function ChunkViz({ active }: { active: boolean }) {
  // chunk spans (% of the document); each overlaps the next
  const chunks = [
    { left: 0, width: 40 },
    { left: 33, width: 40 },
    { left: 66, width: 34 },
  ];
  return (
    <VizBox>
      <div className="flex h-full flex-col justify-center gap-2.5">
        <div className="relative h-3 rounded-sm bg-border">
          {[33, 66].map((l) => (
            <motion.span
              key={l}
              className="absolute inset-y-0 bg-accent/60"
              style={{ left: `${l}%`, width: "7%" }}
              animate={{ opacity: active ? 1 : 0 }}
              transition={{ delay: 0.9 }}
            />
          ))}
        </div>
        {chunks.map((c, i) => (
          <div key={i} className="relative h-3">
            <motion.div
              className="absolute inset-y-0 origin-left rounded-sm border border-foreground/40 bg-foreground/10"
              style={{ left: `${c.left}%`, width: `${c.width}%` }}
              animate={{ scaleX: active ? 1 : 0 }}
              transition={{ duration: 0.5, ease: EASE, delay: 0.15 + i * 0.15 }}
            />
          </div>
        ))}
        <p className="font-mono text-[11px] text-muted">
          <span className="text-accent">▮</span> 150-char overlap between neighbours
        </p>
      </div>
    </VizBox>
  );
}

function EmbedViz({ active }: { active: boolean }) {
  return (
    <VizBox>
      <div className="grid h-full grid-cols-8 content-center gap-2.5">
        {Array.from({ length: 32 }).map((_, i) => (
          <motion.span
            key={i}
            className={"size-2 rounded-full " + (i === 13 ? "bg-accent" : "bg-muted/70")}
            animate={{ scale: active ? 1 : 0.2, opacity: active ? 1 : 0.2 }}
            transition={{ duration: 0.35, ease: EASE, delay: (i % 8) * 0.03 + Math.floor(i / 8) * 0.06 }}
          />
        ))}
      </div>
      <span className="absolute bottom-3 right-4 font-mono text-[11px] text-muted">384 dims · cosine</span>
    </VizBox>
  );
}

function RerankViz({ active }: { active: boolean }) {
  const [sorted, setSorted] = useState(false);
  // State only changes inside the timeout callback, after the effect body has run.
  useEffect(() => {
    const t = setTimeout(() => setSorted(active), active ? 900 : 0);
    return () => clearTimeout(t);
  }, [active]);

  // [label, vector rank, rerank rank]
  const rows: [string, number, number][] = [
    ["chunk 41", 0, 3],
    ["chunk 07", 1, 0],
    ["chunk 23", 2, 4],
    ["chunk 12", 3, 1],
    ["chunk 30", 4, 2],
    ["chunk 18", 5, 5],
  ];
  const ordered = [...rows].sort((a, b) => (sorted ? a[2] - b[2] : a[1] - b[1]));

  return (
    <VizBox>
      <ul className="space-y-1.5">
        {ordered.map(([label, , rr]) => (
          <motion.li
            key={label}
            layout
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            animate={{ opacity: sorted && rr >= 4 ? 0.3 : 1 }}
            className="flex items-center justify-between rounded border border-border px-2.5 py-1 font-mono text-[11px]"
          >
            <span>{label}</span>
            <span className={sorted && rr < 4 ? "text-accent" : "text-muted"}>{sorted ? (rr < 4 ? "keep" : "drop") : "…"}</span>
          </motion.li>
        ))}
      </ul>
    </VizBox>
  );
}

function GateViz({ active }: { active: boolean }) {
  return (
    <VizBox>
      <div className="relative h-32">
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        <div className="absolute inset-y-6 left-[42%] w-px bg-foreground" />
        <span className="absolute left-[42%] top-1 -translate-x-1/2 font-mono text-[11px]">0.02</span>
        <motion.span
          className="absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full border-2 border-danger bg-background"
          style={{ left: "12%" }}
          animate={{ scale: active ? 1 : 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 16, delay: 0.3 }}
        />
        <motion.span
          className="absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full border-2 border-success bg-success"
          style={{ left: "80%" }}
          animate={{ scale: active ? 1 : 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 16, delay: 0.5 }}
        />
        <span className="absolute bottom-1 left-[6%] font-mono text-[11px] text-danger">refuse</span>
        <span className="absolute bottom-1 right-[4%] font-mono text-[11px] text-success">answer</span>
      </div>
    </VizBox>
  );
}

function GenerateViz({ active }: { active: boolean }) {
  const widths = [92, 100, 74, 48];
  return (
    <VizBox>
      <div className="flex h-full flex-col justify-center gap-3">
        {widths.map((w, i) => (
          <motion.div
            key={i}
            className="h-2 origin-left rounded-sm bg-foreground/25"
            style={{ width: `${w}%` }}
            animate={{ scaleX: active ? 1 : 0 }}
            transition={{ duration: 0.55, ease: EASE, delay: 0.15 + i * 0.22 }}
          />
        ))}
        <motion.span
          className="h-3 w-1.5 bg-accent"
          animate={{ opacity: active ? [1, 1, 0, 0] : 0 }}
          transition={{ duration: 0.9, repeat: Infinity, times: [0, 0.5, 0.5, 1], ease: "linear" }}
        />
      </div>
    </VizBox>
  );
}

function CiteViz({ active }: { active: boolean }) {
  const rows = [
    ["…run_0412 failed [1]", "Runs — Sheet1 (row 12)"],
    ["…and run_0417 [2]", "Runs — Sheet1 (row 17)"],
  ];
  return (
    <VizBox>
      <div className="flex h-full flex-col justify-center gap-4">
        {rows.map(([text, src], i) => (
          <div key={src} className="flex items-center gap-3">
            <motion.span
              className="font-mono text-xs"
              animate={{ opacity: active ? 1 : 0.3 }}
              transition={{ delay: 0.2 + i * 0.3 }}
            >
              {text}
            </motion.span>
            <motion.span
              className="h-px flex-1 origin-left bg-accent"
              animate={{ scaleX: active ? 1 : 0 }}
              transition={{ duration: 0.5, ease: EASE, delay: 0.4 + i * 0.3 }}
            />
            <motion.span
              className="rounded border border-border px-2 py-1 font-mono text-[11px] text-muted"
              animate={{ opacity: active ? 1 : 0, x: active ? 0 : 10 }}
              transition={{ duration: 0.4, delay: 0.7 + i * 0.3 }}
            >
              {src}
            </motion.span>
          </div>
        ))}
      </div>
    </VizBox>
  );
}

function Viz({ id, active }: { id: Stage["id"]; active: boolean }) {
  switch (id) {
    case "ingest":
      return <IngestViz active={active} />;
    case "chunk":
      return <ChunkViz active={active} />;
    case "embed":
      return <EmbedViz active={active} />;
    case "rerank":
      return <RerankViz active={active} />;
    case "gate":
      return <GateViz active={active} />;
    case "generate":
      return <GenerateViz active={active} />;
    case "cite":
      return <CiteViz active={active} />;
  }
}

function StageRow({ stage, index }: { stage: Stage; index: number }) {
  const ref = useRef<HTMLLIElement>(null);
  // "Active" = the row is crossing the middle band of the viewport.
  const active = useInView(ref, { margin: "-42% 0px -42% 0px" });

  return (
    <li
      ref={ref}
      className="relative grid gap-x-10 gap-y-6 py-[clamp(3rem,7vw,6rem)] pl-12 md:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] md:pl-24"
    >
      <span
        aria-hidden="true"
        className={
          "absolute left-[calc(0.725rem+0.5px)] top-[clamp(3.6rem,7.6vw,6.6rem)] size-3 rounded-full border-2 transition-colors duration-300 md:left-[calc(2.125rem+0.5px)] " +
          (active ? "border-accent bg-accent" : "border-border bg-background")
        }
      />
      <div>
        <p className={"font-mono text-xs transition-colors duration-300 " + (active ? "text-accent" : "text-muted")}>
          0{index + 1}
        </p>
        <h3
          className={
            "mt-3 text-[clamp(1.9rem,4vw,3.5rem)] font-semibold leading-none tracking-[-0.035em] transition-colors duration-300 " +
            (active ? "text-foreground" : "text-foreground/50")
          }
        >
          {stage.title}
        </h3>
        <p className="mt-5 max-w-[56ch] leading-relaxed text-muted">{stage.body}</p>
        <dl className="mt-6 space-y-1.5 font-mono text-xs">
          {stage.specs.map(([k, v]) => (
            <div key={k} className="flex gap-4">
              <dt className="w-20 shrink-0 text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="md:pt-9" aria-hidden="true">
        <Viz id={stage.id} active={active} />
      </div>
    </li>
  );
}

export default function Pipeline() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 60%", "end 60%"] });
  const fill = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 });

  return (
    <div ref={ref} className="relative">
      <div aria-hidden="true" className="absolute bottom-0 left-[1.1rem] top-0 w-px bg-border md:left-[2.5rem]">
        <motion.div className="h-full w-px origin-top bg-accent" style={{ scaleY: fill }} />
      </div>
      <ol>
        {STAGES.map((s, i) => (
          <StageRow key={s.id} stage={s} index={i} />
        ))}
      </ol>
    </div>
  );
}
