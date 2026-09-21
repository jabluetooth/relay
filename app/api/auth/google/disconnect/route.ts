import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { decryptToken } from "@/lib/crypto";
import { revokeToken } from "@/lib/google/oauth";
import { invalidateCachedToken } from "@/lib/google/tokens";

const bodySchema = z.object({ connectionId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { connectionId } = parsed.data;

  const [connection] = await db
    .select()
    .from(schema.googleConnections)
    .where(eq(schema.googleConnections.id, connectionId))
    .limit(1);

  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  // Best-effort revoke — a connection that's already invalid on Google's
  // side shouldn't block the user from clearing it out locally.
  try {
    await revokeToken(decryptToken(connection.encryptedRefreshToken));
  } catch (err) {
    console.error("Google token revoke failed, proceeding with local delete anyway:", err);
  }

  invalidateCachedToken(connectionId);
  // Cascades to surface_sync, webhook_channels, documents, chunks (FK ON DELETE CASCADE).
  await db.delete(schema.googleConnections).where(eq(schema.googleConnections.id, connectionId));

  return NextResponse.json({ ok: true });
}
