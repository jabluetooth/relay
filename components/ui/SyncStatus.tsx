import { CheckCircle2, Loader2, AlertCircle, CircleDashed } from "lucide-react";

interface SyncStatusProps {
  syncing: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  format?: (iso: string) => string;
  /** Full detail view (drawer) vs. a compact list row — controls whether a
   * long error message truncates with a hover title or wraps in full. */
  detail?: boolean;
}

// A second, non-color signal on every state (icon + text) so status doesn't
// rely on red/green alone (Law #49, color-blindness).
export default function SyncStatus({ syncing, lastSyncedAt, lastError, format, detail }: SyncStatusProps) {
  if (syncing) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-accent">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        syncing…
      </span>
    );
  }
  if (lastError) {
    return (
      <span
        className={"flex min-w-0 items-center gap-1.5 font-mono text-danger " + (detail ? "items-start" : "")}
        title={detail ? undefined : lastError}
      >
        <AlertCircle className="size-3.5 shrink-0 translate-y-px" aria-hidden="true" />
        <span className={detail ? "whitespace-pre-wrap" : "min-w-0 truncate"}>{lastError}</span>
      </span>
    );
  }
  if (lastSyncedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-muted">
        <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
        {format ? format(lastSyncedAt) : new Date(lastSyncedAt).toLocaleString()}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-muted">
      <CircleDashed className="size-3.5" aria-hidden="true" />
      never synced
    </span>
  );
}
