import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getOrCreateOwnerUser } from "@/lib/db/owner";

export async function GET() {
  const user = await getOrCreateOwnerUser();

  const connections = await db
    .select()
    .from(schema.googleConnections)
    .where(eq(schema.googleConnections.userId, user.id));

  const withSync = await Promise.all(
    connections.map(async (c) => {
      const syncRows = await db
        .select()
        .from(schema.surfaceSync)
        .where(eq(schema.surfaceSync.connectionId, c.id));

      return {
        id: c.id,
        googleAccountEmail: c.googleAccountEmail,
        scopes: c.scopes,
        connectedAt: c.createdAt,
        autoSyncEnabled: c.autoSyncEnabled,
        surfaces: syncRows.map((s) => ({
          surface: s.surface,
          lastSyncedAt: s.lastSyncedAt,
          lastError: s.lastError,
          syncing: s.syncStartedAt !== null,
        })),
      };
    })
  );

  return NextResponse.json({ connections: withSync });
}
