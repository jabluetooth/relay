"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom";
}

// The "less text, more interaction" pattern: a short visible label plus a
// hover-revealed explanation, instead of a permanently-visible sentence
// competing for attention. A deliberate 300ms delay (Law #90) keeps it from
// flashing on every incidental mouse pass; focus/blur too, so it's reachable
// by keyboard, not just a mouse.
export default function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(true), 300);
  }

  function hide() {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  }

  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      <AnimatePresence>
        {visible && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, y: side === "top" ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: side === "top" ? 4 : -4 }}
            transition={{ duration: 0.12 }}
            className={
              "pointer-events-none absolute left-1/2 z-40 w-56 -translate-x-1/2 rounded border border-border bg-surface px-2.5 py-2 text-left text-xs leading-relaxed text-muted " +
              (side === "top" ? "bottom-full mb-2" : "top-full mt-2")
            }
          >
            {content}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
