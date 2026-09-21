export type Surface = "drive" | "gmail" | "calendar" | "sheets";

export interface IngestedChunk {
  sourceId: string; // Google's own id: fileId / messageId / eventId / spreadsheetId
  surface: Surface;
  title: string;
  url: string | null;
  content: string;
  /** Whatever a surface needs to render a precise citation (doc heading, sheet range, ...). */
  metadata: Record<string, unknown>;
}

export interface IngestAdapter {
  surface: Surface;
  /**
   * Full pull of everything in scope — run once when a surface is first
   * connected. `config` is per-surface (e.g. Gmail's label/date scope,
   * FR-6) — surfaces that don't need one simply ignore the argument.
   */
  backfill(accessToken: string, config?: Record<string, unknown>): AsyncGenerator<IngestedChunk>;
  /** Incremental pull since the given cursor; returns the new cursor to persist. */
  syncChanges(
    accessToken: string,
    cursor: string | null,
    config?: Record<string, unknown>
  ): Promise<{ chunks: IngestedChunk[]; nextCursor: string | null }>;
}
