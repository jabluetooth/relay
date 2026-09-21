import type { Metadata } from "next";
import Tag from "@/components/marketing/Tag";
import { LineReveal, Rise } from "@/components/marketing/Reveal";
import Pipeline from "@/components/marketing/Pipeline";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Seven stages from a Google file to a cited answer: ingest, chunk, embed, rerank, gate, generate, cite. Every number is read from the code.",
};

const FRESHNESS = [
  ["Drive & Docs", "push", "Google calls Relay's webhook, a job syncs the change list", "Channel lasts 24h, renewed every 6h"],
  ["Calendar", "push", "Same channel mechanism as Drive", "Window is 90 days back, 180 ahead"],
  ["Sheets", "rides Drive", "Changed spreadsheets are re-read after each Drive sync", "Row position is the citation key, so deleting a row shifts later citations"],
  ["Gmail", "poll · 5 min", "Reads messages added since the last history cursor", "Push via Pub/Sub is deferred until a public URL exists"],
] as const;

const MEASURED = [
  ["Ground-truth questions", "23", "Answerable and should-refuse, across Drive, Gmail, Calendar and Sheets"],
  ["Adversarial cases", "7", "Including an instruction hidden in an HTML comment of a forwarded email"],
  ["Citation accuracy", "100%", "The expected source was among the citations on every answerable question"],
  ["Correct refusals", "100%", "Out-of-scope questions were refused, none answered"],
  ["Adversarial resistance", "100%", "A planted instruction’s marker never showed up in the answer"],
  ["Drive keyword match", "63%", "Legitimate paraphrasing on three questions, not wrong answers. Kept in on purpose"],
] as const;

export default function HowItWorksPage() {
  return (
    <>
      <section className="px-[5vw] pb-[clamp(2rem,4vw,4rem)] pt-[clamp(2.5rem,6vw,6rem)]">
        <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] lg:gap-16">
          <div>
            <Rise inView={false}>
              <Tag>pipeline</Tag>
            </Rise>
            <LineReveal
              as="h1"
              inView={false}
              delay={0.1}
              className="mt-6 text-[clamp(2.75rem,8vw,8.5rem)] font-semibold leading-[0.93] tracking-[-0.045em]"
              lines={["From a file", "to a footnote."]}
            />
          </div>
          <Rise inView={false} delay={0.45}>
            <p className="max-w-[40ch] leading-relaxed text-muted">
              Seven stages, all in the repository. Scroll and each one lights up with what it does and the numbers it
              runs on. Nothing here is rounded up for effect.
            </p>
          </Rise>
        </div>
      </section>

      <section className="px-[5vw] pt-[clamp(1rem,3vw,3rem)]">
        <Pipeline />
      </section>

      <section className="px-[5vw] pt-[clamp(5rem,11vw,11rem)]">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Tag>freshness</Tag>
            <LineReveal
              className="mt-5 text-[clamp(2rem,4.4vw,4.25rem)] font-semibold leading-[1] tracking-[-0.035em]"
              lines={["Staying", "up to date."]}
            />
            <Rise delay={0.2}>
              <p className="mt-6 max-w-[36ch] text-sm leading-relaxed text-muted">
                All sync work runs as background jobs on Upstash QStash. A Postgres-backed lock per source stops a
                duplicate delivery from running twice, a bug this project hit for real and fixed. Push needs a public
                HTTPS URL, so in local development a tunnel provides one.
              </p>
            </Rise>
          </div>
          <Rise>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">How each source stays fresh</caption>
                <thead>
                  <tr className="border-b border-border font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                    <th scope="col" className="py-3 pr-4 font-normal">Source</th>
                    <th scope="col" className="py-3 pr-4 font-normal">Mechanism</th>
                    <th scope="col" className="py-3 pr-4 font-normal">What happens</th>
                    <th scope="col" className="py-3 font-normal">Worth knowing</th>
                  </tr>
                </thead>
                <tbody>
                  {FRESHNESS.map(([source, mech, what, note]) => (
                    <tr key={source} className="border-b border-border align-top">
                      <th scope="row" className="py-4 pr-4 font-medium">{source}</th>
                      <td className="py-4 pr-4 font-mono text-xs text-accent">{mech}</td>
                      <td className="py-4 pr-4 text-muted">{what}</td>
                      <td className="py-4 text-muted">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Rise>
        </div>
      </section>

      <section className="px-[5vw] pt-[clamp(6rem,13vw,13rem)]">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Tag>measured</Tag>
            <LineReveal
              className="mt-5 text-[clamp(2rem,4.4vw,4.25rem)] font-semibold leading-[1] tracking-[-0.035em]"
              lines={["Checked", "against real", "data."]}
            />
            <Rise delay={0.2}>
              <p className="mt-6 max-w-[36ch] text-sm leading-relaxed text-muted">
                Relay ships its own eval suite, run against a real workspace and re-run whenever chunking, the gate or
                generation changed. It is one person&apos;s data and a small suite, so read it as a regression guard,
                not a benchmark.
              </p>
            </Rise>
          </div>
          <Rise>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Results from the bundled eval suite</caption>
              <tbody>
                {MEASURED.map(([name, value, note]) => (
                  <tr key={name} className="border-b border-border first:border-t align-baseline">
                    <th scope="row" className="w-[32%] py-4 pr-4 font-medium">{name}</th>
                    <td className="w-20 py-4 pr-4 font-mono text-lg tabular-nums text-accent">{value}</td>
                    <td className="py-4 text-muted">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Rise>
        </div>
      </section>
    </>
  );
}
