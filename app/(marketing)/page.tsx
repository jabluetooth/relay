import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import Tag from "@/components/marketing/Tag";
import { LineReveal, Rise, DrawLine } from "@/components/marketing/Reveal";
import TerminalDemo from "@/components/marketing/TerminalDemo";
import SourceList from "@/components/marketing/SourceList";
import ConfidenceGate from "@/components/marketing/ConfidenceGate";

const APP_ROWS = [
  {
    href: "/chat",
    name: "Chat",
    text: "Answers with numbered citations. Click one and the exact retrieved passage opens, with a link to the original.",
  },
  {
    href: "/connections",
    name: "Connections",
    text: "Connect a Google account, scope Gmail to a label, watch each source sync, and switch on auto-sync once.",
  },
  {
    href: "/observability",
    name: "Observability",
    text: "Query volume, refusal rate and latency over 7, 14 or 30 days, per-source freshness, and a searchable query log.",
  },
] as const;

const TRUST = [
  ["scopes", "*.readonly, nothing that writes"],
  ["tokens", "AES-256-GCM at rest"],
  ["oauth", "PKCE, hand-rolled, signed state"],
  ["index", "your Postgres, your Qdrant"],
] as const;

export default function HomePage() {
  return (
    <>
      {/* HERO — asymmetric 7/5 split, left-aligned, the demo offset lower */}
      <section className="px-[5vw] pb-[clamp(4rem,9vw,9rem)] pt-[clamp(2.5rem,6vw,6rem)]">
        <div className="grid items-start gap-[clamp(2.5rem,5vw,5rem)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div>
            <Rise inView={false}>
              <Tag>self-hosted · read-only</Tag>
            </Rise>
            <LineReveal
              as="h1"
              inView={false}
              delay={0.1}
              className="mt-6 text-[clamp(2.5rem,5.6vw,6.5rem)] font-semibold leading-[0.96] tracking-[-0.04em]"
              lines={[
                "Cited answers",
                "from your own",
                "Workspace.",
                <span key="c" className="text-muted">
                  Or none at all.
                </span>,
              ]}
            />
            <Rise inView={false} delay={0.55}>
              <p className="mt-8 max-w-[50ch] text-lg leading-relaxed text-muted">
                Relay reads your Drive, Gmail, Calendar and Sheets, then answers with a link to the exact passage. If it
                can&apos;t find support, it says so instead of guessing.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
                <Link
                  href="/get-started"
                  className="group inline-flex items-center gap-2 rounded bg-accent px-5 py-3 font-mono text-sm font-medium uppercase tracking-[0.06em] text-accent-foreground transition-transform hover:-translate-y-0.5 active:scale-[0.97]"
                >
                  Get started
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </Link>
                <Link
                  href="/how-it-works"
                  className="font-mono text-sm uppercase tracking-[0.06em] text-muted underline decoration-border decoration-1 underline-offset-8 transition-colors hover:text-foreground hover:decoration-accent"
                >
                  How it works
                </Link>
              </div>
            </Rise>
          </div>

          <Rise inView={false} delay={0.4} y={28} className="lg:mt-20">
            <TerminalDemo />
          </Rise>
        </div>
      </section>

      {/* SOURCES — sticky heading, expanding rows instead of a 3-card grid */}
      <section className="px-[5vw] pt-[clamp(4rem,10vw,10rem)]">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Tag>sources</Tag>
            <LineReveal
              className="mt-5 text-[clamp(2rem,4.4vw,4.25rem)] font-semibold leading-[1] tracking-[-0.035em]"
              lines={["Ask once.", "Relay checks", "four places."]}
            />
            <Rise delay={0.2}>
              <p className="mt-6 max-w-[34ch] leading-relaxed text-muted">
                Each source stays fresh its own way, and has its own rules about what gets indexed.
              </p>
            </Rise>
          </div>
          <SourceList />
        </div>
      </section>

      {/* THE GATE — the differentiator, given the biggest gap above it */}
      <section className="px-[5vw] pt-[clamp(7rem,16vw,16rem)]">
        <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
          <div>
            <Tag>the gate</Tag>
            <LineReveal
              className="mt-5 text-[clamp(2.25rem,5.6vw,5.5rem)] font-semibold leading-[0.98] tracking-[-0.04em]"
              lines={["It would rather say", "nothing than make", "something up."]}
            />
          </div>
          <Rise delay={0.15}>
            <p className="max-w-[44ch] leading-relaxed text-muted">
              Every answer starts with a relevance score for the best passage Relay found. Below the line it refuses.
              Above the line it answers and cites. The line sits at 0.02 because that is where real scores split.
            </p>
          </Rise>
        </div>
        <div className="mt-[clamp(2.5rem,5vw,5rem)]">
          <ConfidenceGate />
        </div>
      </section>

      {/* INSIDE THE APP — static editorial rows, each a real route */}
      <section className="px-[5vw] pt-[clamp(5rem,11vw,11rem)]">
        <div className="mb-8 flex items-end justify-between gap-6">
          <Tag>inside the app</Tag>
        </div>
        <ul className="border-t border-border">
          {APP_ROWS.map((row, i) => (
            <li key={row.href} className="border-b border-border">
              <Rise delay={i * 0.06}>
                <Link
                  href={row.href}
                  className="group grid items-baseline gap-x-6 gap-y-2 py-7 md:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1.1fr)_2rem]"
                >
                  <span className="font-mono text-xs text-muted">0{i + 1}</span>
                  <span className="text-[clamp(1.75rem,3.6vw,3.25rem)] font-semibold leading-none tracking-[-0.03em] transition-transform duration-300 group-hover:translate-x-2">
                    {row.name}
                  </span>
                  <span className="max-w-[52ch] leading-relaxed text-muted">{row.text}</span>
                  <ArrowUpRight
                    className="hidden size-5 place-self-center text-muted transition-all duration-300 group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-accent md:block"
                    aria-hidden="true"
                  />
                </Link>
              </Rise>
            </li>
          ))}
        </ul>
      </section>

      {/* TRUST — big statement left, mono facts right */}
      <section className="px-[5vw] pt-[clamp(6rem,14vw,14rem)]">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
          <LineReveal
            as="h2"
            className="text-[clamp(2.5rem,7vw,7rem)] font-semibold leading-[0.95] tracking-[-0.045em]"
            lines={["One instance.", "One owner.", "Read-only."]}
          />
          <div className="self-end">
            <dl className="font-mono text-sm">
              {TRUST.map(([k, v], i) => (
                <div key={k}>
                  <DrawLine delay={i * 0.08} />
                  <Rise delay={i * 0.08} y={8}>
                    <div className="flex gap-6 py-4">
                      <dt className="w-16 shrink-0 text-muted">{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  </Rise>
                </div>
              ))}
              <DrawLine delay={0.4} />
            </dl>
            <Rise delay={0.2}>
              <p className="mt-6 max-w-[46ch] text-sm leading-relaxed text-muted">
                Passages you ask about are sent to Hugging Face and Groq to embed, rerank and answer. The security page
                lists exactly what goes where.
              </p>
              <Link
                href="/security"
                className="group mt-5 inline-flex items-center gap-2 font-mono text-sm uppercase tracking-[0.06em] underline decoration-border underline-offset-8 transition-colors hover:decoration-accent"
              >
                Read the security model
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            </Rise>
          </div>
        </div>
      </section>
    </>
  );
}
