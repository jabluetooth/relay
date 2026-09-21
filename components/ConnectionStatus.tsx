"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, Mail, Calendar as CalendarIcon, Table } from "lucide-react";
import SyncStatus from "@/components/ui/SyncStatus";
import { fetchJson } from "@/lib/fetch-json";

const SURFACES = [
  { id: "drive", label: "Drive & Docs", icon: FileText },
  { id: "gmail", label: "Gmail", icon: Mail },
  { id: "calendar", label: "Calendar", icon: CalendarIcon },
  { id: "sheets", label: "Sheets", icon: Table },
] as const;

interface SurfaceStatus {
  surface: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  syncing: boolean;
}

interface Connection {
  id: string;
  surfaces: SurfaceStatus[];
}

type Overall = "online" | "syncing" | "issues" | "offline";

const OVERALL_META: Record<Overall, { dot: string; label: string }> = {
  online: { dot: "bg-success", label: "online" },
  syncing: { dot: "bg-accent animate-pulse", label: "syncing" },
  issues: { dot: "bg-danger", label: "issues" },
  offline: { dot: "bg-muted", label: "offline" },
};

// v1 is single-tenant (PRD §2.2) — same assumption the gmail poll job and
// every other cross-surface job already make, so reading connections[0]
// rather than aggregating across accounts isn't a new simplification.
function overallStatus(connections: Connection[]): Overall {
  if (connections.length === 0) return "offline";
  const surfaces = connections.flatMap((c) => c.surfaces);
  if (surfaces.some((s) => s.syncing)) return "syncing";
  if (surfaces.some((s) => s.lastError)) return "issues";
  return "online";
}

// A real health readout, not a decorative "always green" badge — the dot
// and label reflect the same surface_sync data the Connections/Observability
// pages read, and hovering reveals exactly which surface is behind it
// (Law #90: a deliberate delay before showing, so it doesn't flash on every
// incidental mouse pass).
export default function ConnectionStatus() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJson<{ connections?: Connection[] }>("/api/connections");
        if (!cancelled) setConnections(data.connections ?? []);
      } catch {
        // Leave the last known state; a failed poll shouldn't crash the header.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function scheduleShow() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(true), 300);
  }

  function cancelShow() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovered(false);
  }

  const status = overallStatus(connections);
  const meta = OVERALL_META[status];
  const primary = connections[0];

  return (
    <div className="relative" onMouseEnter={scheduleShow} onMouseLeave={cancelShow}>
      <div className="inline-flex cursor-default items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-muted">
        <span className={"size-1.5 rounded-full " + meta.dot} aria-hidden="true" />
        {meta.label}
      </div>

      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full z-40 mt-2 w-80 rounded border border-border bg-surface p-4"
          >
            {!primary ? (
              <div className="text-xs text-muted">
                No Google account connected.{" "}
                <Link href="/connections" className="text-accent underline underline-offset-2">
                  Connect one
                </Link>
                .
              </div>
            ) : (
              <ul className="space-y-3">
                {SURFACES.map(({ id, label, icon: Icon }) => {
                  const s = primary.surfaces.find((row) => row.surface === id);
                  // An error needs room to actually be read, not squeezed
                  // into the same line as the label — it gets its own
                  // wrapped line below instead of a single truncated row.
                  if (s?.lastError) {
                    return (
                      <li key={id} className="space-y-1 text-xs">
                        <span className="inline-flex items-center gap-1.5 text-foreground/80">
                          <Icon className="size-3.5 text-muted" aria-hidden="true" />
                          {label}
                        </span>
                        <SyncStatus detail syncing={false} lastSyncedAt={null} lastError={s.lastError} />
                      </li>
                    );
                  }
                  return (
                    <li key={id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 text-foreground/80">
                        <Icon className="size-3.5 text-muted" aria-hidden="true" />
                        {label}
                      </span>
                      <SyncStatus
                        syncing={s?.syncing ?? false}
                        lastSyncedAt={s?.lastSyncedAt ?? null}
                        lastError={null}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
