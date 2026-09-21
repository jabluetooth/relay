"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface Item {
  id: string;
  label: string;
}

// Sticky in-page index: the entry for whichever section is crossing the
// upper-middle of the viewport is highlighted, so a long reference page
// always shows where you are.
export default function SectionNav({ items, label }: { items: Item[]; label: string }) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => el !== null);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-25% 0px -65% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);

  return (
    <nav aria-label={label}>
      <ul className="space-y-1">
        {items.map((item, i) => {
          const isActive = active === item.id;
          return (
            <li key={item.id} className="relative">
              {isActive && (
                <motion.span
                  layoutId={`section-nav-${label}`}
                  className="absolute inset-y-1 left-0 w-0.5 bg-accent"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <a
                href={`#${item.id}`}
                aria-current={isActive ? "location" : undefined}
                className={
                  "flex gap-3 py-1.5 pl-4 font-mono text-xs uppercase tracking-[0.08em] transition-colors " +
                  (isActive ? "text-foreground" : "text-muted hover:text-foreground")
                }
              >
                <span className="text-muted/70">0{i + 1}</span>
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
