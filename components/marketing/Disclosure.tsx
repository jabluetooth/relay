"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

interface Item {
  q: string;
  a: React.ReactNode;
}

// Single-open accordion. The panel animates with grid-template-rows
// (0fr to 1fr), which transitions to and from `auto` height, unlike
// animating `height` itself.
export default function Disclosure({ items }: { items: Item[] }) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <ul className="divide-y divide-border border-y border-border">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <li key={item.q}>
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              aria-controls={`faq-${i}`}
              className="flex w-full items-center justify-between gap-6 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="font-medium">{item.q}</span>
              <Plus className={"size-4 shrink-0 text-muted transition-transform duration-300 " + (isOpen ? "rotate-45 text-accent" : "")} aria-hidden="true" />
            </button>
            <div
              id={`faq-${i}`}
              role="region"
              className={"grid transition-[grid-template-rows] duration-300 ease-out " + (isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
            >
              <div className="overflow-hidden">
                <div className="max-w-[62ch] pb-5 leading-relaxed text-muted">{item.a}</div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
