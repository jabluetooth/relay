// Strips markup for the common case — real emails/Calendar descriptions
// are rarely worth a real HTML parser for v1's purposes (embedding text,
// not preserving layout). Shared by lib/ingest/gmail.ts and
// lib/ingest/calendar.ts (Calendar's `description` field "can contain HTML"
// per Google's own docs, same as Gmail bodies).
export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}
