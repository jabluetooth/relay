import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/google/tokens";
import { gmailClient } from "@/lib/google/client";
import { isUuid } from "@/lib/api";

// Lets the connections UI offer a real label picker instead of asking a
// user to type a raw label ID by hand (custom labels' IDs look like
// "Label_123", not their display name — see lib/ingest/gmail.ts's own note
// on why the ID, not the name, is what scope actually needs).
export async function GET(req: NextRequest) {
  const connectionId = req.nextUrl.searchParams.get("connectionId");
  if (!isUuid(connectionId)) {
    return NextResponse.json({ error: "A valid connectionId query param is required" }, { status: 400 });
  }

  const accessToken = await getValidAccessToken(connectionId);
  const gmail = gmailClient(accessToken);
  const { data } = await gmail.users.labels.list({ userId: "me" });

  const labels = (data.labels ?? [])
    .filter((l): l is { id: string; name: string } => Boolean(l.id && l.name))
    .map((l) => ({ id: l.id, name: l.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ labels });
}
