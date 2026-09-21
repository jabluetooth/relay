"use client";

import { useState } from "react";
import { ArrowUp, FileText, Info, Trash2 } from "lucide-react";
import Toggle from "@/components/ui/Toggle";
import Tooltip from "@/components/ui/Tooltip";
import SyncStatus from "@/components/ui/SyncStatus";
import Modal from "@/components/ui/Modal";
import Drawer from "@/components/ui/Drawer";
import MetricCard from "@/components/ui/MetricCard";

// Fixed dates and values: this is a specimen, so it must render identically
// on the server and the client, and it is labelled as sample data.
const SAMPLE = [3, 5, 4, 8, 6, 9, 12, 7, 10, 14, 11, 13, 16, 15].map((value, i) => ({
  date: `2026-01-${String(i + 1).padStart(2, "0")}`,
  value,
}));

function Specimen({
  name,
  use,
  avoid,
  className = "",
  children,
}: {
  name: string;
  use: string;
  avoid: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={"flex flex-col rounded border border-border bg-surface " + className}>
      <div className="border-b border-border px-5 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{name}</div>
      <div className="flex flex-1 flex-wrap items-center gap-3 p-5">{children}</div>
      <dl className="space-y-1 border-t border-border px-5 py-3 text-xs leading-relaxed">
        <div className="flex gap-2">
          <dt className="w-10 shrink-0 font-mono text-success">use</dt>
          <dd className="text-muted">{use}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-10 shrink-0 font-mono text-danger">avoid</dt>
          <dd className="text-muted">{avoid}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function ComponentGallery() {
  const [on, setOn] = useState(true);
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-6">
        <Specimen
          className="md:col-span-4"
          name="buttons"
          use="One primary per view. Name the action: Sync Gmail now, not Submit."
          avoid="Two accent buttons side by side. A destructive action styled as primary."
        >
          <button className="inline-flex items-center gap-1.5 rounded bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition-transform hover:-translate-y-px active:scale-95">
            <FileText className="size-4" aria-hidden="true" />
            Sync Drive now
          </button>
          <button className="rounded border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-foreground/5">
            Cancel
          </button>
          <button className="rounded px-3.5 py-2 text-sm text-muted transition-colors hover:text-foreground">Learn more</button>
          <button className="inline-flex items-center gap-1.5 rounded px-3 py-2 text-sm text-danger transition-colors hover:bg-danger/10">
            <Trash2 className="size-4" aria-hidden="true" />
            Disconnect
          </button>
        </Specimen>

        <Specimen
          className="md:col-span-2"
          name="toggle"
          use="Immediate state changes, like auto-sync. It states its own value in text."
          avoid="A pill switch with only colour and position to say on or off."
        >
          <Toggle checked={on} onChange={setOn} label="Auto-sync (demo)" />
          <span className="text-sm text-muted">{on ? "keeps sources fresh" : "manual sync only"}</span>
        </Specimen>

        <Specimen
          className="md:col-span-3"
          name="sync status"
          use="Every state gets an icon and a word as well as a colour."
          avoid="A bare red or green dot that means nothing to a colour-blind reader."
        >
          <div className="grid w-full gap-3 text-sm sm:grid-cols-2">
            <SyncStatus syncing={false} lastSyncedAt="2026-01-14T09:30:00Z" lastError={null} format={() => "synced 4m ago"} />
            <SyncStatus syncing lastSyncedAt={null} lastError={null} />
            <SyncStatus syncing={false} lastSyncedAt={null} lastError="Quota exceeded, retry in a minute" />
            <SyncStatus syncing={false} lastSyncedAt={null} lastError={null} />
          </div>
        </Specimen>

        <Specimen
          className="md:col-span-3"
          name="tooltip and chip"
          use="Tooltips for secondary detail only. Chips for things you can open."
          avoid="Putting the one thing people must read inside a tooltip."
        >
          <span className="text-sm">Auto-sync</span>
          <Tooltip content="Keeps every connected source fresh without a manual sync each time.">
            <Info className="size-4 cursor-default text-muted" aria-label="What is auto-sync?" />
          </Tooltip>
          <span className="rounded border border-border px-2.5 py-1 font-mono text-xs text-muted">Runs — Sheet1 (row 12)</span>
        </Specimen>

        <Specimen
          className="md:col-span-2"
          name="modal and drawer"
          use="Modal to confirm or warn. Drawer for one item's detail or a small workflow."
          avoid="A modal that hides information people need to compare."
        >
          <button onClick={() => setModal(true)} className="rounded border border-border px-3 py-2 text-sm hover:bg-foreground/5">
            Open modal
          </button>
          <button onClick={() => setDrawer(true)} className="rounded border border-border px-3 py-2 text-sm hover:bg-foreground/5">
            Open drawer
          </button>
        </Specimen>

        <Specimen
          className="md:col-span-4"
          name="prompt input"
          use="A visible border and a prompt glyph, so it reads as a place to type."
          avoid="A borderless field that relies on placeholder text alone."
        >
          <div className="flex w-full items-center gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded border border-border bg-background px-4 py-3 focus-within:border-accent">
              <span className="font-mono text-sm text-accent" aria-hidden="true">
                &gt;
              </span>
              <input
                aria-label="Demo prompt"
                placeholder="Ask about your Docs, Gmail, Calendar or Sheets…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </div>
            <span className="inline-flex size-10 items-center justify-center rounded bg-accent text-accent-foreground" aria-hidden="true">
              <ArrowUp className="size-4" />
            </span>
          </div>
        </Specimen>

        <div className="md:col-span-6">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">metric card · sample data</div>
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              id="specimen"
              label="Query volume"
              headline="167"
              data={SAMPLE}
              trendPct={18}
              increaseIsGood
              formatValue={(v) => `${Math.round(v)} queries`}
              footer={[
                { label: "24h", value: "15" },
                { label: "7d", value: "83" },
              ]}
            />
            <div className="md:col-span-2 flex items-center rounded border border-dashed border-border p-6 text-sm leading-relaxed text-muted">
              The arrow shows direction. The colour says whether that direction is good for this metric: more queries is
              fine, more refusals or more latency is not, so the same upward arrow is green on one card and red on
              another. A prior period with no data shows &ldquo;new&rdquo; instead of an invented percentage.
            </div>
          </div>
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Disconnect account?">
        <p className="text-sm text-muted">
          This stops syncing <span className="font-mono text-foreground">you@example.com</span> and revokes Relay&apos;s
          access. Content already indexed stays searchable.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setModal(false)} className="rounded border border-border px-3 py-1.5 text-xs font-medium hover:bg-foreground/5">
            Cancel
          </button>
          <button onClick={() => setModal(false)} className="rounded bg-danger px-3 py-1.5 text-xs font-medium text-white">
            Disconnect
          </button>
        </div>
      </Modal>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="gmail" icon={<FileText className="size-4 text-muted" aria-hidden="true" />}>
        <div className="space-y-4 text-sm">
          <div className="rounded border border-border px-3 py-2.5">
            <SyncStatus detail syncing={false} lastSyncedAt={null} lastError="Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'" />
          </div>
          <p className="text-muted">Long detail belongs here, where it can wrap in full instead of being truncated in a row.</p>
        </div>
      </Drawer>
    </>
  );
}
