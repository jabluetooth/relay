import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import Tag from "@/components/marketing/Tag";
import { Rise } from "@/components/marketing/Reveal";
import { REPO_URL } from "@/lib/site";

const SITE = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Security" },
  { href: "/get-started", label: "Get started" },
  { href: "/design", label: "Design" },
] as const;

const APP = [
  { href: "/chat", label: "Chat" },
  { href: "/connections", label: "Connections" },
  { href: "/observability", label: "Observability" },
] as const;

// The footer is the closing statement, not a 4-column link graveyard: one
// big call to action, two plain link rows, and an oversized wordmark
// cropped by the page edge.
export default function SiteFooter() {
  return (
    <footer className="relative mt-[clamp(6rem,14vw,14rem)] overflow-hidden border-t border-border">
      <div className="px-[5vw] pt-[clamp(3rem,7vw,7rem)]">
        <Rise>
          <Tag>next</Tag>
          <Link href="/get-started" className="group mt-5 flex items-end gap-[0.15em] text-[clamp(2.5rem,9vw,9rem)] font-semibold leading-[0.95] tracking-[-0.04em]">
            Run your own
            <ArrowUpRight
              className="mb-[0.12em] size-[0.7em] shrink-0 text-accent transition-transform duration-300 group-hover:-translate-y-2 group-hover:translate-x-2"
              aria-hidden="true"
            />
          </Link>
        </Rise>

        <div className="mt-[clamp(3rem,6vw,6rem)] grid gap-8 font-mono text-xs uppercase tracking-[0.1em] sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-3">
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {SITE.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-muted transition-colors hover:text-foreground">
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-muted transition-colors hover:text-foreground">
                  GitHub ↗
                </a>
              </li>
            </ul>
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {APP.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-muted/70 transition-colors hover:text-foreground">
                    app / {l.label.toLowerCase()}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <p className="max-w-md text-[11px] normal-case leading-relaxed tracking-normal text-muted">
            Relay is an independent, self-hosted project. Google Workspace, Drive, Gmail, Calendar and Sheets are
            trademarks of Google LLC. Not affiliated with or endorsed by Google.
          </p>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none mt-[clamp(2rem,4vw,4rem)] select-none whitespace-nowrap px-[2vw] font-mono text-[24vw] leading-[0.78] tracking-[-0.06em] text-foreground/[0.045]"
        style={{ transform: "translateY(16%)" }}
      >
        relay_
      </div>
    </footer>
  );
}
