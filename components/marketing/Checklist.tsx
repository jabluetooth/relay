"use client";

import { useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";

const KEY = "relay.get-started.checked";
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function write(value: string) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Storage blocked (private window, site data disabled): ticks just won't persist.
  }
  listeners.forEach((l) => l());
}

interface Item {
  id: string;
  label: string;
  hint?: string;
}

// Ticks persist across visits. Backed by useSyncExternalStore with an empty
// server snapshot, so the server-rendered list is identical to the first
// client render and hydration stays clean.
export default function Checklist({ items }: { items: Item[] }) {
  const stored = useSyncExternalStore(subscribe, read, () => "");
  const checked = new Set(stored.split(",").filter(Boolean));

  function toggle(id: string) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    write([...next].join(","));
  }

  return (
    <ul className="divide-y divide-border border-y border-border">
      {items.map((item) => {
        const on = checked.has(item.id);
        return (
          <li key={item.id}>
            <button
              onClick={() => toggle(item.id)}
              role="checkbox"
              aria-checked={on}
              className="group flex w-full items-start gap-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span
                className={
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm border transition-colors " +
                  (on ? "border-accent bg-accent text-accent-foreground" : "border-border group-hover:border-foreground/40")
                }
              >
                <motion.span initial={false} animate={{ scale: on ? 1 : 0, opacity: on ? 1 : 0 }} transition={{ duration: 0.15 }}>
                  <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
                </motion.span>
              </span>
              <span>
                <span className={"block transition-colors " + (on ? "text-muted line-through decoration-border" : "")}>{item.label}</span>
                {item.hint && <span className="mt-1 block max-w-[58ch] text-sm leading-relaxed text-muted">{item.hint}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
