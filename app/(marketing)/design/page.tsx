import type { Metadata } from "next";
import Link from "next/link";
import { Check, X } from "lucide-react";
import Tag from "@/components/marketing/Tag";
import { LineReveal, Rise } from "@/components/marketing/Reveal";
import SectionNav from "@/components/marketing/SectionNav";
import ComponentGallery from "@/components/marketing/design/ComponentGallery";
import MotionLab from "@/components/marketing/design/MotionLab";

export const metadata: Metadata = {
  title: "Design",
  description:
    "Relay's UI and UX guidelines: principles, colour tokens with measured contrast, type, shape, live components, motion rules, accessibility (with the known gaps) and voice.",
};

const NAV = [
  { id: "principles", label: "Principles" },
  { id: "color", label: "Colour" },
  { id: "type", label: "Type" },
  { id: "shape", label: "Shape & space" },
  { id: "components", label: "Components" },
  { id: "motion", label: "Motion" },
  { id: "a11y", label: "Accessibility" },
  { id: "voice", label: "Voice" },
];

const PRINCIPLES = [
  ["Data is typography.", "Numbers, ids, timestamps and error text are set in mono. Prose and headings stay in sans. The two faces do different jobs, so a reader can tell data from explanation at a glance.", "/observability"],
  ["Two signals for every state.", "Healthy, syncing, failed and never-synced each have an icon and a word as well as a colour. Nothing depends on telling red from green.", "/connections"],
  ["One accent, kept for the next action.", "Terracotta marks what to press or where you are: the primary button, the active tab, the caret. It is never decoration, so it stays rare enough to mean something.", "/chat"],
  ["Detail on demand.", "Tooltips, drawers and modals hold what most people don't need most of the time. The page stays quiet, and the long error is one click away instead of truncated in a row.", "/connections"],
  ["Motion explains.", "Things move to show where they came from or where they went. A drawer slides from the edge it lives on. Nothing bounces to fill silence.", "/chat"],
] as const;

const TOKENS = [
  { name: "background", role: "Page ground", dark: "#141210", light: "#faf7f2" },
  { name: "surface", role: "Cards, windows, header. One step lighter than the ground", dark: "#1c1916", light: "#ffffff" },
  { name: "foreground", role: "Body text and strong UI", dark: "#f2ede7", light: "#1c1712" },
  { name: "muted", role: "Secondary text, labels, icons", dark: "#948b81", light: "#7a6f63" },
  { name: "accent", role: "The next action, and where you are", dark: "#d97757", light: "#c2410c" },
  { name: "accent-foreground", role: "Text on accent fills", dark: "#141210", light: "#faf7f2" },
  { name: "success", role: "Healthy, answered", dark: "#4ade80", light: "#15803d" },
  { name: "danger", role: "Error, refused, destructive", dark: "#f87171", light: "#b91c1c" },
] as const;

const PAIRS = [
  ["foreground on background", "foreground", "background"],
  ["muted on background", "muted", "background"],
  ["muted on surface", "muted", "surface"],
  ["accent on background", "accent", "background"],
  ["accent-foreground on accent", "accent-foreground", "accent"],
  ["success on background", "success", "background"],
  ["danger on background", "danger", "background"],
] as const;

// WCAG 2.x relative luminance and contrast ratio, computed here from the
// token values above rather than typed in, so the table can't drift from
// the palette or claim a pass it doesn't have.
function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function tokenHex(name: string, theme: "dark" | "light"): string {
  return TOKENS.find((t) => t.name === name)![theme];
}

function grade(r: number): { label: string; className: string } {
  if (r >= 4.5) return { label: "AA", className: "text-success" };
  if (r >= 3) return { label: "large text only", className: "text-accent" };
  return { label: "fails", className: "text-danger" };
}

const TYPE_ROLES = [
  { role: "Display", spec: "clamp 2.5–8.5rem · 600 · −0.04em · sans", sample: "Cited answers", className: "text-5xl font-semibold tracking-[-0.04em]" },
  { role: "Heading", spec: "1.9–3.5rem · 600 · −0.035em · sans", sample: "Staying up to date", className: "text-3xl font-semibold tracking-[-0.035em]" },
  { role: "Body", spec: "16px · 400 · 1.625 leading · 62–66ch · sans", sample: "Relay reads your Drive, Gmail, Calendar and Sheets, then answers with a link to the exact passage.", className: "max-w-[62ch] leading-relaxed text-muted" },
  { role: "UI label", spec: "12–14px · 500 · sans", sample: "Sync Gmail now", className: "text-sm font-medium" },
  { role: "Data", spec: "12–14px · 400–600 · mono · tabular figures", sample: "6,267ms  0.412  9/21/2026, 8:50 AM", className: "font-mono text-sm tabular-nums" },
  { role: "Meta label", spec: "11–12px · uppercase · +0.08–0.12em · mono", sample: "Per-surface sync lag", className: "font-mono text-xs uppercase tracking-[0.12em] text-muted" },
] as const;

const DURATIONS = [
  ["Tooltip in", "120ms", "opacity + 4px", "Fast: it answers a hover"],
  ["Hover lift", "150–200ms", "translateY(−1px)", "A hint of pressability, not a jump"],
  ["Message enter", "180ms", "opacity + 6px", "Ease-out, so the reply arrives and stays"],
  ["Drawer", "spring 380/38", "translateX from the edge", "Slides from where it lives"],
  ["Nav indicator", "spring 500/40", "layout, shared element", "Follows you between tabs"],
  ["Section reveal", "600–750ms", "opacity + 14px, or a masked line", "Only on the public site"],
  ["List stagger", "30–60ms/item", "same as the item", "Long enough to follow, short enough to finish"],
] as const;

const A11Y_OK = [
  "Focus is always visible: the browser outline by default, an accent ring or border on custom controls",
  "Icon-only buttons carry an aria-label",
  "Switch, checkbox and dialog roles, with Esc closing overlays",
  "Nav uses aria-current for the active page",
  "Status is never colour alone: icon plus word",
  "prefers-reduced-motion respected in JavaScript and CSS",
  "On the public site: landmarks, a skip link, and captioned tables with row and column headers",
  "Text contrast measured above, both themes",
];

const A11Y_GAPS = [
  "Modal and Drawer close on Esc and backdrop click but do not trap focus or return it to the trigger",
  "Some dense controls are under 44px: the send button is 40px, citation chips about 28px",
  "Charts have hover tooltips but no text alternative such as a data table",
  "Native date inputs keep the browser's own styling and picker",
  "11px mono labels pass contrast but are small",
];

const VOICE = [
  { dont: "Error 500", do: "Gmail is rate-limited. Wait a minute and sync again." },
  { dont: "Submit", do: "Sync Gmail now" },
  { dont: "Unlock seamless insights", do: "Ask a question, get a cited answer" },
  { dont: "Oops! Something went wrong", do: "Nothing in your sources supports an answer, so Relay won't guess." },
] as const;

function Section({ id, index, title, intro, children }: { id: string; index: number; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-border pb-[clamp(4rem,8vw,8rem)] pt-8">
      <p className="font-mono text-xs text-muted">0{index}</p>
      <LineReveal
        className="mt-3 text-[clamp(1.9rem,3.8vw,3.5rem)] font-semibold leading-[1] tracking-[-0.035em]"
        lines={[title]}
      />
      {intro && <p className="mt-5 max-w-[62ch] leading-relaxed text-muted">{intro}</p>}
      <div className="mt-8 space-y-6">{children}</div>
    </section>
  );
}

export default function DesignPage() {
  return (
    <>
      <section className="px-[5vw] pb-[clamp(3rem,6vw,6rem)] pt-[clamp(2.5rem,6vw,6rem)]">
        <Rise inView={false}>
          <Tag>design guidelines</Tag>
        </Rise>
        <LineReveal
          as="h1"
          inView={false}
          delay={0.1}
          className="mt-6 text-[clamp(2.75rem,8vw,8.5rem)] font-semibold leading-[0.93] tracking-[-0.045em]"
          lines={["The rules behind", "every screen."]}
        />
        <Rise inView={false} delay={0.45}>
          <p className="mt-8 max-w-[56ch] text-lg leading-relaxed text-muted">
            Relay looks like a terminal on purpose. This is the system that keeps it consistent: what each token is for,
            how it moves, what it does for accessibility and where it still falls short. Everything below is rendered
            with the real components and tokens.
          </p>
        </Rise>
      </section>

      <div className="grid gap-10 px-[5vw] lg:grid-cols-[minmax(0,3fr)_minmax(0,9fr)] lg:gap-16">
        <aside className="hidden lg:block">
          <div className="sticky top-28">
            <SectionNav items={NAV} label="design" />
          </div>
        </aside>

        <div>
          <Section id="principles" index={1} title="Principles">
            <ol className="divide-y divide-border border-y border-border">
              {PRINCIPLES.map(([title, body, href], i) => (
                <li key={title} className="grid gap-x-8 gap-y-2 py-6 md:grid-cols-[3rem_minmax(0,1fr)_minmax(0,1.3fr)]">
                  <span className="font-mono text-xs text-muted">0{i + 1}</span>
                  <h3 className="text-xl font-semibold leading-tight tracking-[-0.02em]">{title}</h3>
                  <p className="leading-relaxed text-muted">
                    {body}{" "}
                    <Link href={href} className="font-mono text-xs uppercase tracking-[0.08em] text-accent underline decoration-border underline-offset-4 hover:decoration-accent">
                      see it
                    </Link>
                  </p>
                </li>
              ))}
            </ol>
          </Section>

          <Section
            id="color"
            index={2}
            title="Colour"
            intro="Warm neutrals and a single terracotta accent, dark first. Dark is the designed identity. Light is a functional fallback for a light system preference. Elevation is a lighter surface plus a hairline border, never a shadow or a blur."
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">Colour tokens in both themes</caption>
                <thead>
                  <tr className="border-b border-border font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                    <th scope="col" className="w-20 py-3 pr-4 font-normal">Live</th>
                    <th scope="col" className="py-3 pr-4 font-normal">Token</th>
                    <th scope="col" className="py-3 pr-4 font-normal">Role</th>
                    <th scope="col" className="py-3 pr-4 font-normal">Dark</th>
                    <th scope="col" className="py-3 font-normal">Light</th>
                  </tr>
                </thead>
                <tbody>
                  {TOKENS.map((t) => (
                    <tr key={t.name} className="border-b border-border align-middle">
                      <td className="py-3 pr-4">
                        <span className="block h-9 w-16 rounded border border-border" style={{ background: `var(--${t.name})` }} />
                      </td>
                      <th scope="row" className="py-3 pr-4 font-mono text-xs font-normal">{t.name}</th>
                      <td className="py-3 pr-4 text-muted">{t.role}</td>
                      <td className="py-3 pr-4 font-mono text-xs">{t.dark}</td>
                      <td className="py-3 font-mono text-xs">{t.light}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="max-w-[62ch] text-sm leading-relaxed text-muted">
              <span className="font-mono text-foreground">border</span> is the foreground colour at 10% opacity in both
              themes, so hairlines follow the theme instead of being a fixed grey.
            </p>

            <div className="overflow-x-auto pt-4">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <caption className="mb-3 text-left font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                  Contrast, computed from the values above (WCAG 2.x)
                </caption>
                <thead>
                  <tr className="border-b border-border font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                    <th scope="col" className="py-3 pr-4 font-normal">Pair</th>
                    <th scope="col" className="py-3 pr-4 font-normal">Dark</th>
                    <th scope="col" className="py-3 font-normal">Light</th>
                  </tr>
                </thead>
                <tbody>
                  {PAIRS.map(([label, fg, bg]) => {
                    const cells = (["dark", "light"] as const).map((theme) => {
                      const r = ratio(tokenHex(fg, theme), tokenHex(bg, theme));
                      return { r, g: grade(r) };
                    });
                    return (
                      <tr key={label} className="border-b border-border">
                        <th scope="row" className="py-3 pr-4 font-normal">{label}</th>
                        {cells.map((c, i) => (
                          <td key={i} className="py-3 pr-4 font-mono text-xs">
                            {c.r.toFixed(2)}:1 <span className={c.g.className}>{c.g.label}</span>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            id="type"
            index={3}
            title="Type"
            intro="Two families and no more. Geist Sans for prose, headings and UI labels. JetBrains Mono for data and meta labels. Display sizes get tight tracking. Uppercase labels get loose tracking."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded border border-border bg-surface p-6">
                <p className="text-7xl font-semibold leading-none tracking-[-0.04em]">Aa</p>
                <p className="mt-4 font-mono text-xs text-muted">Geist Sans · 400 500 600</p>
              </div>
              <div className="rounded border border-border bg-surface p-6">
                <p className="font-mono text-7xl leading-none tracking-[-0.04em]">Aa</p>
                <p className="mt-4 font-mono text-xs text-muted">JetBrains Mono · 400 500 600</p>
              </div>
            </div>
            <ul className="divide-y divide-border border-y border-border">
              {TYPE_ROLES.map((r) => (
                <li key={r.role} className="grid gap-x-8 gap-y-2 py-5 md:grid-cols-[8rem_minmax(0,1fr)]">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-[0.1em]">{r.role}</p>
                    <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted">{r.spec}</p>
                  </div>
                  <p className={r.className}>{r.sample}</p>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            id="shape"
            index={4}
            title="Shape & space"
            intro="Everything has a 4px radius, with 2px for very small parts like checkboxes. Circles are reserved for status dots. Spacing runs on a 4px grid: tight inside an app screen, generous on the public site, with vertical gaps that vary by how related two sections are instead of repeating one number."
          >
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["4px", "rounded", "Cards, buttons, inputs, windows"],
                ["2px", "rounded-sm", "Checkboxes, chart parts, tiny controls"],
                ["full", "rounded-full", "Status dots and window dots only"],
              ].map(([size, cls, use]) => (
                <div key={cls} className="rounded border border-border bg-surface p-5">
                  <div className={`h-16 border border-foreground/40 bg-foreground/10 ${cls}`} />
                  <p className="mt-4 font-mono text-xs">{size} · {cls}</p>
                  <p className="mt-1 text-sm text-muted">{use}</p>
                </div>
              ))}
            </div>
            <div className="rounded border border-border p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">elevation without shadows</p>
              <div className="mt-4 rounded border border-border bg-background p-4">
                <p className="font-mono text-xs text-muted">background</p>
                <div className="mt-3 rounded border border-border bg-surface p-4">
                  <p className="font-mono text-xs text-muted">surface</p>
                  <div className="mt-3 rounded border border-border bg-foreground/[0.05] p-4">
                    <p className="font-mono text-xs text-muted">hover / selected · foreground at 5%</p>
                  </div>
                </div>
              </div>
            </div>
          </Section>

          <Section
            id="components"
            index={5}
            title="Components"
            intro="These are the real components from the app, not screenshots. Toggle, hover and open them."
          >
            <ComponentGallery />
          </Section>

          <Section
            id="motion"
            index={6}
            title="Motion"
            intro="Animate transform and opacity only, since those run on the compositor and never trigger layout. Enter slower than you exit. Never linear, except a blinking caret and a spinner. Everything obeys prefers-reduced-motion."
          >
            <MotionLab />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] text-left text-sm">
                <caption className="sr-only">Motion durations and what they animate</caption>
                <thead>
                  <tr className="border-b border-border font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                    <th scope="col" className="py-3 pr-4 font-normal">What</th>
                    <th scope="col" className="py-3 pr-4 font-normal">Timing</th>
                    <th scope="col" className="py-3 pr-4 font-normal">Animates</th>
                    <th scope="col" className="py-3 font-normal">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {DURATIONS.map(([what, timing, animates, why]) => (
                    <tr key={what} className="border-b border-border align-top">
                      <th scope="row" className="py-3 pr-4 font-medium">{what}</th>
                      <td className="py-3 pr-4 font-mono text-xs text-accent">{timing}</td>
                      <td className="py-3 pr-4 font-mono text-xs">{animates}</td>
                      <td className="py-3 text-muted">{why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            id="a11y"
            index={7}
            title="Accessibility"
            intro="What is in place, and, listed just as plainly, what isn't yet."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded border border-border bg-surface p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-success">in place</p>
                <ul className="mt-4 space-y-2.5 text-sm">
                  {A11Y_OK.map((t) => (
                    <li key={t} className="flex gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded border border-danger/40 bg-danger/[0.04] p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-danger">known gaps</p>
                <ul className="mt-4 space-y-2.5 text-sm">
                  {A11Y_GAPS.map((t) => (
                    <li key={t} className="flex gap-2.5">
                      <X className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>

          <section id="voice" className="scroll-mt-28 border-t border-border pt-8">
            <p className="font-mono text-xs text-muted">08</p>
            <LineReveal
              className="mt-3 text-[clamp(1.9rem,3.8vw,3.5rem)] font-semibold leading-[1] tracking-[-0.035em]"
              lines={["Voice"]}
            />
            <p className="mt-5 max-w-[62ch] leading-relaxed text-muted">
              Say what happened and what to do next. Name the action on the button. Sentence case for prose, lowercase
              mono for data labels. Skip the words that could be on any product page.
            </p>
            <div className="mt-8 divide-y divide-border border-y border-border">
              {VOICE.map((v) => (
                <div key={v.do} className="grid gap-3 py-5 md:grid-cols-2 md:gap-8">
                  <p className="flex gap-2.5 text-muted line-through decoration-danger/60">
                    <X className="mt-1 size-4 shrink-0 text-danger no-underline" aria-hidden="true" />
                    {v.dont}
                  </p>
                  <p className="flex gap-2.5">
                    <Check className="mt-1 size-4 shrink-0 text-success" aria-hidden="true" />
                    {v.do}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
