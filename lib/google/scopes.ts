import type { Surface } from "@/lib/ingest/types";

// Least-privilege, read-only scopes per surface (FR-2). A user can connect
// one surface at a time — Google's incremental-auth model adds scopes to
// the same grant rather than requiring a fresh consent screen each time.
export const SURFACE_SCOPES: Record<Surface, string> = {
  drive: "https://www.googleapis.com/auth/drive.readonly",
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  calendar: "https://www.googleapis.com/auth/calendar.readonly",
  sheets: "https://www.googleapis.com/auth/spreadsheets.readonly",
};

// Always requested — needed to identify which Google account connected and
// to key googleConnections.googleAccountEmail.
export const IDENTITY_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

export function scopesFor(surfaces: Surface[]): string[] {
  return [...IDENTITY_SCOPES, ...surfaces.map((s) => SURFACE_SCOPES[s])];
}
