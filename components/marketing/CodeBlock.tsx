"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CodeBlockProps {
  /** One command per line. Lines are copied exactly as written. */
  code: string;
  label?: string;
  /** Show a non-selectable `$` before each line (copy excludes it). */
  prompt?: boolean;
}

export default function CodeBlock({ code, label, prompt = false }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (permissions / insecure context) — nothing to recover.
    }
  }

  return (
    <div className="relative rounded border border-border bg-background">
      {label && (
        <div className="border-b border-border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
          {label}
        </div>
      )}
      <pre className="overflow-x-auto py-3 pl-4 pr-14 font-mono text-[13px] leading-relaxed">
        <code>
          {code.split("\n").map((line, i) => (
            <span key={i} className="block">
              {prompt && (
                <span className="select-none text-accent" aria-hidden="true">
                  ${" "}
                </span>
              )}
              {line}
            </span>
          ))}
        </code>
      </pre>
      <button
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy to clipboard"}
        className={
          "absolute right-2 inline-flex items-center justify-center rounded border border-border bg-surface text-muted transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
          (label ? "top-[3px] size-7" : "top-2 size-8")
        }
      >
        {copied ? <Check className="size-3.5 text-success" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      </button>
    </div>
  );
}
