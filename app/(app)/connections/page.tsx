"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { FileText, Mail, Calendar as CalendarIcon, Table, Trash2, AlertCircle, Info } from "lucide-react";
import Toggle from "@/components/ui/Toggle";
import SyncStatus from "@/components/ui/SyncStatus";
import Drawer from "@/components/ui/Drawer";
import Modal from "@/components/ui/Modal";
import Tooltip from "@/components/ui/Tooltip";
import { fetchJson } from "@/lib/fetch-json";

const SURFACES = [
  { id: "drive", label: "Drive & Docs", icon: FileText, available: true },
  { id: "gmail", label: "Gmail", icon: Mail, available: true },
  { id: "calendar", label: "Calendar", icon: CalendarIcon, available: true },
  { id: "sheets", label: "Sheets", icon: Table, available: true },
] as const;

type Surface = (typeof SURFACES)[number];

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

// Backfill/sync run as background jobs that can take minutes (a real
// ~200-message Gmail backfill took about 5) — the POST that kicks one off
// returns almost instantly (a 202, just "queued"), so polling this often is
// what actually shows progress instead of a misleading instant "done".
const POLL_MS = 3000;

interface SurfaceStatus {
  surface: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  syncing: boolean;
}

interface Connection {
  id: string;
  googleAccountEmail: string;
  scopes: string[];
  connectedAt: string;
  autoSyncEnabled: boolean;
  surfaces: SurfaceStatus[];
}

interface GmailLabel {
  id: string;
  name: string;
}

interface GmailScopeForm {
  labelId: string;
  after: string;
  before: string;
}

const EMPTY_GMAIL_FORM: GmailScopeForm = { labelId: "", after: "", before: "" };

function surfaceStatus(c: Connection, surface: string): SurfaceStatus | undefined {
  return c.surfaces.find((s) => s.surface === surface);
}

// A second, non-color signal for the tile grid too (Law #49) — dot color is
// backed by an icon-shape difference a screen reader / colorblind user can
// still tell apart via the label text underneath.
function tileDotClass(status: SurfaceStatus | undefined): string {
  if (!status) return "bg-foreground/20";
  if (status.syncing) return "bg-accent animate-pulse";
  if (status.lastError) return "bg-danger";
  if (status.lastSyncedAt) return "bg-success";
  return "bg-foreground/20";
}

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [gmailLabels, setGmailLabels] = useState<Record<string, GmailLabel[]>>({});
  const [gmailForms, setGmailForms] = useState<Record<string, GmailScopeForm>>({});
  const [gmailError, setGmailError] = useState<Record<string, string>>({});
  const [manageTarget, setManageTarget] = useState<{ connectionId: string; surfaceId: Surface["id"] } | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<Connection | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    try {
      const data = await fetchJson<{ connections?: Connection[] }>("/api/connections");
      setConnections(data.connections ?? []);
    } catch {
      // Transient outage — keep the last list; the poll will try again.
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJson<{ connections?: Connection[] }>("/api/connections");
        if (!cancelled) setConnections(data.connections ?? []);
      } catch {
        // Backend down on first load — the empty state stays; polling recovers.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Polls while anything is actively syncing, stops once everything's
  // settled — no point hammering the endpoint when nothing's changing.
  useEffect(() => {
    const anySyncing = connections.some((c) => c.surfaces.some((s) => s.syncing));
    if (anySyncing && !pollTimer.current) {
      pollTimer.current = setInterval(load, POLL_MS);
    } else if (!anySyncing && pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [connections]);

  // The drawer only ever stores an id pair, not a data snapshot — it looks
  // up the live connection/surface on every render, so it naturally stays
  // in sync with the polling loop above instead of freezing at click time.
  const manageConnection = manageTarget ? connections.find((c) => c.id === manageTarget.connectionId) : undefined;
  const manageSurface = manageTarget ? SURFACES.find((s) => s.id === manageTarget.surfaceId) : undefined;

  // Retain the last-known content while the drawer is closing so its exit
  // animation slides out real content instead of going blank mid-transition
  // (manageTarget clears immediately on close, before the animation finishes).
  // Adjusting state during render like this — rather than in an effect — is
  // React's documented pattern for "derive from a change, once, without an
  // extra render": https://react.dev/learn/you-might-not-need-an-effect
  const [lastManage, setLastManage] = useState<{ connection: Connection; surface: Surface } | null>(null);
  if (manageConnection && manageSurface && lastManage?.connection !== manageConnection) {
    setLastManage({ connection: manageConnection, surface: manageSurface });
  }

  function isSyncing(c: Connection, surface: string): boolean {
    return c.surfaces.some((s) => s.surface === surface && s.syncing);
  }

  async function toggleAutoSync(connectionId: string, enabled: boolean) {
    setBusy(connectionId);
    await fetch(`/api/connections/${connectionId}/auto-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    // Turning it on enqueues an initial backfill server-side — load() here
    // picks up the resulting `syncing: true` and the poll loop above takes
    // it from there, same as a manual "Sync now" click.
    await load();
    setBusy(null);
  }

  async function disconnect(connectionId: string) {
    setBusy(connectionId);
    setDisconnectTarget(null);
    await fetch("/api/auth/google/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId }),
    });
    await load();
    setBusy(null);
  }

  async function backfill(connectionId: string, surface: string, config?: Record<string, unknown>) {
    setBusy(connectionId);
    setGmailError((prev) => ({ ...prev, [connectionId]: "" }));
    const res = await fetch("/api/ingest/backfill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config ? { connectionId, surface, config } : { connectionId, surface }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setGmailError((prev) => ({ ...prev, [connectionId]: data.error ?? `Request failed (${res.status})` }));
    }
    // The request only confirms the job was queued, not that it finished —
    // `load()` here (and the poll loop above, once `syncing` flips true)
    // is what actually reflects real progress.
    await load();
    setBusy(null);
  }

  async function loadGmailLabels(connectionId: string) {
    if (gmailLabels[connectionId]) return; // already loaded
    const res = await fetch(`/api/ingest/gmail/labels?connectionId=${connectionId}`);
    if (!res.ok) return;
    const data = await res.json();
    setGmailLabels((prev) => ({ ...prev, [connectionId]: data.labels ?? [] }));
  }

  function gmailForm(connectionId: string): GmailScopeForm {
    return gmailForms[connectionId] ?? EMPTY_GMAIL_FORM;
  }

  function updateGmailForm(connectionId: string, patch: Partial<GmailScopeForm>) {
    setGmailForms((prev) => ({ ...prev, [connectionId]: { ...gmailForm(connectionId), ...patch } }));
  }

  function syncGmail(connectionId: string) {
    const form = gmailForm(connectionId);
    const config: Record<string, string> = {};
    if (form.labelId) config.labelId = form.labelId;
    if (form.after) config.after = form.after.replaceAll("-", "/"); // <input type=date> gives YYYY-MM-DD; Gmail search wants YYYY/MM/DD
    if (form.before) config.before = form.before.replaceAll("-", "/");
    if (Object.keys(config).length === 0) {
      setGmailError((prev) => ({ ...prev, [connectionId]: "Pick a label and/or a date range first — see FR-6, real inbox content isn't indexed by default." }));
      return;
    }
    backfill(connectionId, "gmail", config);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Connections</h1>
        <p className="mt-1 text-sm text-muted">Manage which Google accounts and surfaces Relay can read from.</p>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">Connect a surface</h2>
        <div className="flex flex-wrap gap-2">
          {SURFACES.map((s) => (
            <motion.a
              key={s.id}
              whileHover={s.available ? { y: -1 } : undefined}
              whileTap={s.available ? { scale: 0.97 } : undefined}
              href={s.available ? `/api/auth/google/start?surfaces=${s.id}` : undefined}
              aria-disabled={!s.available}
              className={
                "inline-flex items-center gap-2 rounded border px-3 py-2 text-sm transition-colors " +
                (s.available
                  ? "border-border bg-surface hover:border-accent/40 hover:text-accent"
                  : "cursor-not-allowed border-border text-muted/50")
              }
              title={s.available ? undefined : "M2 scope — not yet implemented"}
            >
              <s.icon className="size-4" aria-hidden="true" />
              {s.label}
              {!s.available && " (soon)"}
            </motion.a>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Connected accounts</h2>

        {connections.length === 0 && (
          <div className="rounded border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
            Nothing connected yet — pick a surface above to get started.
          </div>
        )}

        {connections.map((c, ci) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: ci * 0.05, duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="rounded border border-border bg-surface p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-medium">{c.googleAccountEmail}</p>
                <p className="text-xs text-muted">
                  {c.scopes.length} scopes · connected {new Date(c.connectedAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => setDisconnectTarget(c)}
                disabled={busy === c.id}
                aria-label={`Disconnect ${c.googleAccountEmail}`}
                className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Disconnect
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2.5 rounded border border-border px-3 py-2.5">
              <Toggle
                checked={c.autoSyncEnabled}
                disabled={busy === c.id}
                onChange={(enabled) => toggleAutoSync(c.id, enabled)}
                label={`Auto-sync for ${c.googleAccountEmail}`}
              />
              <span className="text-xs font-medium">Auto-sync</span>
              <Tooltip content="Keeps every connected surface fresh automatically instead of needing a manual sync each time.">
                <Info className="size-3.5 cursor-default text-muted" aria-hidden="true" />
              </Tooltip>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SURFACES.map((surface) => {
                const status = surfaceStatus(c, surface.id);
                return (
                  <motion.button
                    key={surface.id}
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setManageTarget({ connectionId: c.id, surfaceId: surface.id })}
                    className="flex flex-col items-start gap-2 rounded border border-border px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-foreground/[0.03]"
                  >
                    <span className="flex w-full items-center justify-between">
                      <surface.icon className="size-4 text-muted" aria-hidden="true" />
                      <span className={"size-1.5 " + tileDotClass(status)} aria-hidden="true" />
                    </span>
                    <span className="text-xs font-medium">{surface.label}</span>
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        ))}
      </section>

      {/* Per-surface detail lives in a drawer instead of always inline — a
          connections list with 4+ surfaces × forms permanently expanded
          becomes unreadable fast. */}
      {lastManage && (
        <SurfaceDrawer
          open={manageTarget !== null}
          connection={manageConnection ?? lastManage.connection}
          surface={manageSurface ?? lastManage.surface}
          onClose={() => setManageTarget(null)}
          busy={busy === lastManage.connection.id}
          isSyncing={isSyncing}
          onBackfill={backfill}
          onSyncGmail={syncGmail}
          gmailForm={gmailForm(lastManage.connection.id)}
          onUpdateGmailForm={(patch) => updateGmailForm(lastManage.connection.id, patch)}
          gmailLabels={gmailLabels[lastManage.connection.id] ?? []}
          onFocusGmailLabels={() => loadGmailLabels(lastManage.connection.id)}
          gmailError={gmailError[lastManage.connection.id]}
        />
      )}

      <Modal open={disconnectTarget !== null} onClose={() => setDisconnectTarget(null)} title="Disconnect account?">
        <p className="text-sm text-muted">
          This stops syncing{" "}
          <span className="font-mono font-medium text-foreground">{disconnectTarget?.googleAccountEmail}</span> and
          revokes Relay&apos;s access. Content already ingested stays searchable until you disconnect and re-sync.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => setDisconnectTarget(null)}
            className="rounded border border-border px-3 py-1.5 text-xs font-medium hover:bg-foreground/5"
          >
            Cancel
          </button>
          <button
            onClick={() => disconnectTarget && disconnect(disconnectTarget.id)}
            className="rounded bg-danger px-3 py-1.5 text-xs font-medium text-white transition-transform active:scale-95"
          >
            Disconnect
          </button>
        </div>
      </Modal>
    </div>
  );
}

interface SurfaceDrawerProps {
  open: boolean;
  connection: Connection;
  surface: Surface;
  onClose: () => void;
  busy: boolean;
  isSyncing: (c: Connection, surface: string) => boolean;
  onBackfill: (connectionId: string, surface: string, config?: Record<string, unknown>) => void;
  onSyncGmail: (connectionId: string) => void;
  gmailForm: GmailScopeForm;
  onUpdateGmailForm: (patch: Partial<GmailScopeForm>) => void;
  gmailLabels: GmailLabel[];
  onFocusGmailLabels: () => void;
  gmailError: string | undefined;
}

function SurfaceDrawer({
  open,
  connection,
  surface,
  onClose,
  busy,
  isSyncing,
  onBackfill,
  onSyncGmail,
  gmailForm,
  onUpdateGmailForm,
  gmailLabels,
  onFocusGmailLabels,
  gmailError,
}: SurfaceDrawerProps) {
  const status = surfaceStatus(connection, surface.id);
  const hasGmailScope = connection.scopes.includes(GMAIL_SCOPE);
  const hasCalendarScope = connection.scopes.includes(CALENDAR_SCOPE);
  const hasSheetsScope = connection.scopes.includes(SHEETS_SCOPE);
  const syncing = isSyncing(connection, surface.id);

  const scopeGrantedFor: Record<string, boolean> = {
    drive: true,
    gmail: hasGmailScope,
    calendar: hasCalendarScope,
    sheets: hasSheetsScope,
  };
  const hasScope = scopeGrantedFor[surface.id];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={surface.label}
      icon={<surface.icon className="size-4 text-muted" aria-hidden="true" />}
    >
      <div className="space-y-4">
        <div className="rounded border border-border px-3 py-2.5 text-sm">
          <SyncStatus
            detail
            syncing={status?.syncing ?? false}
            lastSyncedAt={status?.lastSyncedAt ?? null}
            lastError={status?.lastError ?? null}
            format={(iso) => `Synced ${new Date(iso).toLocaleString()}`}
          />
        </div>

        {!hasScope ? (
          <a
            href={`/api/auth/google/start?surfaces=${surface.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-accent underline underline-offset-2"
          >
            Grant {surface.label} access to this account
          </a>
        ) : surface.id === "gmail" ? (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Real inbox content isn&apos;t indexed by default (FR-6) — pick a label and/or date range.
            </p>
            <select
              value={gmailForm.labelId}
              onFocus={onFocusGmailLabels}
              onChange={(e) => onUpdateGmailForm({ labelId: e.target.value })}
              className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-sm"
            >
              <option value="">(no label filter)</option>
              {gmailLabels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <label className="flex-1 text-xs text-muted">
                After
                <input
                  type="date"
                  value={gmailForm.after}
                  onChange={(e) => onUpdateGmailForm({ after: e.target.value })}
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-sm"
                />
              </label>
              <label className="flex-1 text-xs text-muted">
                Before
                <input
                  type="date"
                  value={gmailForm.before}
                  onChange={(e) => onUpdateGmailForm({ before: e.target.value })}
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-sm"
                />
              </label>
            </div>
            <button
              onClick={() => onSyncGmail(connection.id)}
              disabled={busy || syncing}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-accent px-3 py-2 text-sm font-medium text-accent-foreground transition-transform active:scale-95 disabled:opacity-40"
            >
              <Mail className="size-4" aria-hidden="true" />
              {syncing ? "Syncing Gmail…" : "Sync Gmail now"}
            </button>
            {gmailError && (
              <p className="flex items-center gap-1.5 text-xs text-danger">
                <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                {gmailError}
              </p>
            )}
          </div>
        ) : (
          <button
            onClick={() => onBackfill(connection.id, surface.id)}
            disabled={busy || syncing}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-accent px-3 py-2 text-sm font-medium text-accent-foreground transition-transform active:scale-95 disabled:opacity-40"
          >
            <surface.icon className="size-4" aria-hidden="true" />
            {syncing ? `Syncing ${surface.label}…` : `Sync ${surface.label} now`}
          </button>
        )}
      </div>
    </Drawer>
  );
}
