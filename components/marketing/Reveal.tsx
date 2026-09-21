"use client";

import { motion } from "framer-motion";

// One easing for everything on the site: fast out, long settle. Matches the
// design page's motion rules (never linear, entering > exiting).
export const EASE = [0.16, 1, 0.3, 1] as const;

const VIEWPORT = { once: true, margin: "-8% 0px" } as const;

interface LineRevealProps {
  lines: React.ReactNode[];
  as?: "h1" | "h2" | "h3" | "p";
  className?: string;
  delay?: number;
  /** true → play on scroll into view; false → play on mount (above the fold). */
  inView?: boolean;
}

// Headline reveal: every line sits in its own mask and rises from behind its
// baseline, so lines land one after another instead of the whole block
// fading up together (the "everything fades up" tell).
export function LineReveal({ lines, as: Tag = "h2", className = "", delay = 0, inView = true }: LineRevealProps) {
  return (
    <Tag className={className}>
      {lines.map((line, i) => (
        <span key={i} className="-mb-[0.1em] block overflow-hidden pb-[0.1em]">
          <motion.span
            className="block"
            initial={{ y: "108%" }}
            {...(inView ? { whileInView: { y: 0 }, viewport: VIEWPORT } : { animate: { y: 0 } })}
            transition={{ duration: 0.75, ease: EASE, delay: delay + i * 0.09 }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}

interface RiseProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  inView?: boolean;
}

export function Rise({ children, className, delay = 0, y = 14, inView = true }: RiseProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      {...(inView ? { whileInView: { opacity: 1, y: 0 }, viewport: VIEWPORT } : { animate: { opacity: 1, y: 0 } })}
      transition={{ duration: 0.6, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

// A hairline that draws itself left to right — section dividers that arrive
// with the content instead of just sitting there.
export function DrawLine({ className = "", delay = 0 }: { className?: string; delay?: number }) {
  return (
    <motion.div
      aria-hidden="true"
      className={"h-px origin-left bg-border " + className}
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={VIEWPORT}
      transition={{ duration: 1, ease: EASE, delay }}
    />
  );
}
