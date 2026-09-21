import type { Surface, IngestAdapter } from "@/lib/ingest/types";
import { driveAdapter } from "@/lib/ingest/drive";
import { gmailAdapter } from "@/lib/ingest/gmail";
import { calendarAdapter } from "@/lib/ingest/calendar";
import { sheetsAdapter } from "@/lib/ingest/sheets";

export const adapters: Record<Surface, IngestAdapter> = {
  drive: driveAdapter,
  gmail: gmailAdapter,
  calendar: calendarAdapter,
  sheets: sheetsAdapter,
};

export type { Surface, IngestAdapter, IngestedChunk } from "@/lib/ingest/types";
