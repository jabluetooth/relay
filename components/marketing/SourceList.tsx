"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { FileText, Mail, Calendar, Table, Plus } from "lucide-react";
import { EASE } from "@/components/marketing/Reveal";

const SOURCES = [
  {
    id: "drive",
    name: "Drive & Docs",
    icon: FileText,
    fresh: "push · channel renewed every 6h",
    detail:
      "Docs, plain text and PDFs. Text is split into pieces of about 1,000 characters with 150 of overlap, breaking at paragraphs first, then sentences, then words. PDFs are read with pdf.js.",
    specs: [
      ["scope", "drive.readonly"],
      ["chunks", "~1000 / 150 overlap"],
    ],
  },
  {
    id: "gmail",
    name: "Gmail",
    icon: Mail,
    fresh: "polls every 5 minutes",
    detail:
      "Nothing is indexed until you choose a label, a date range, or both. Subject, sender and body are read; HTML-only messages are stripped to text. Push notifications are deferred until there is a public URL to receive them.",
    specs: [
      ["scope", "gmail.readonly"],
      ["opt-in", "label and/or dates"],
    ],
  },
  {
    id: "calendar",
    name: "Calendar",
    icon: Calendar,
    fresh: "push · channel renewed every 6h",
    detail:
      "Events over a window of 90 days back and 180 ahead. Recurring meetings are expanded, so each occurrence is its own citable event that links to the real Calendar entry.",
    specs: [
      ["scope", "calendar.readonly"],
      ["window", "-90d / +180d"],
    ],
  },
  {
    id: "sheets",
    name: "Sheets",
    icon: Table,
    fresh: "rides Drive's push channel",
    detail:
      "One chunk per row, with the header cells naming each value, so a row reads as facts (Status: Active) instead of a flattened blob. Citations link to that row's range.",
    specs: [
      ["scope", "spreadsheets.readonly"],
      ["chunks", "1 row = 1 chunk"],
    ],
  },
] as const;

export default function SourceList() {
  const [open, setOpen] = useState<string>("drive");

  return (
    <ul className="border-t border-border">
      {SOURCES.map((s, i) => {
        const isOpen = open === s.id;
        const Icon = s.icon;
        return (
          <motion.li
            key={s.id}
            className="border-b border-border"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-8% 0px" }}
            transition={{ duration: 0.6, ease: EASE, delay: i * 0.07 }}
          >
            <button
              onClick={() => setOpen(isOpen ? "" : s.id)}
              aria-expanded={isOpen}
              aria-controls={`source-${s.id}`}
              className="group grid w-full grid-cols-[3rem_1fr_2rem] items-baseline gap-x-4 py-6 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:grid-cols-[5rem_minmax(0,1.3fr)_minmax(0,1fr)_2rem] md:py-8"
            >
              <span className="font-mono text-xs text-muted">0{i + 1}</span>
              <span
                className={
                  "text-[clamp(1.75rem,4.6vw,4rem)] font-semibold leading-none tracking-[-0.03em] transition-[transform,color] duration-300 group-hover:translate-x-2 " +
                  (isOpen ? "text-foreground" : "text-foreground/60 group-hover:text-foreground")
                }
              >
                {s.name}
              </span>
              <span className="hidden font-mono text-xs text-muted md:block">{s.fresh}</span>
              <Plus
                className={"size-5 place-self-center text-muted transition-transform duration-300 " + (isOpen ? "rotate-45 text-accent" : "")}
                aria-hidden="true"
              />
            </button>

            <div
              id={`source-${s.id}`}
              role="region"
              aria-label={s.name}
              className={
                "grid transition-[grid-template-rows] duration-300 ease-out " + (isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")
              }
            >
              <div className="overflow-hidden">
                <div className="grid gap-6 pb-8 md:grid-cols-[5rem_minmax(0,1.3fr)_minmax(0,1fr)_2rem] md:gap-x-4">
                  <Icon className="hidden size-5 text-accent md:block" aria-hidden="true" />
                  <p className="max-w-[60ch] leading-relaxed text-muted">{s.detail}</p>
                  <dl className="space-y-1.5 font-mono text-xs">
                    <div className="flex gap-3 md:hidden">
                      <dt className="text-muted">sync</dt>
                      <dd>{s.fresh}</dd>
                    </div>
                    {s.specs.map(([k, v]) => (
                      <div key={k} className="flex gap-3">
                        <dt className="w-14 shrink-0 text-muted">{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}
