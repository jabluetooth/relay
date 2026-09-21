import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decryptToken } from "@/lib/crypto";
import { refreshAccessToken } from "@/lib/google/oauth";

// Short-lived, in-memory access-token cache keyed by connectionId, plus a
// single-flight guard (FR-3) so N concurrent requests for the same
// connection trigger one refresh call to Google, not N races against the
// same refresh token (a reused refresh token grant can otherwise get
// silently invalidated by a concurrent duplicate exchange).
// Known limitation: this is an in-process Map, so it only single-flights
// within one server instance. On serverless (Vercel), concurrent requests
// landing on different instances can each refresh once — wasteful but not
// unsafe, since Google tolerates concurrent refreshes of the same token.
// A shared cache (Upstash Redis) would close this gap; not needed for v1's
// single-user load.
const cache = new Map<string, { accessToken: string; expiresAt: number }>();
const inFlight = new Map<string, Promise<string>>();

const SAFETY_MARGIN_MS = 60_000; // refresh a minute before actual expiry

export async function getValidAccessToken(connectionId: string): Promise<string> {
  const cached = cache.get(connectionId);
  if (cached && cached.expiresAt - SAFETY_MARGIN_MS > Date.now()) {
    return cached.accessToken;
  }

  const existing = inFlight.get(connectionId);
  if (existing) return existing;

  const promise = doRefresh(connectionId).finally(() => inFlight.delete(connectionId));
  inFlight.set(connectionId, promise);
  return promise;
}

async function doRefresh(connectionId: string): Promise<string> {
  const [connection] = await db
    .select()
    .from(schema.googleConnections)
    .where(eq(schema.googleConnections.id, connectionId))
    .limit(1);

  if (!connection) throw new Error(`No google_connections row for id ${connectionId}`);

  const refreshToken = decryptToken(connection.encryptedRefreshToken);
  const tokens = await refreshAccessToken(refreshToken);

  cache.set(connectionId, {
    accessToken: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  });

  return tokens.access_token;
}

/** Call after a disconnect so a stale cached token can't linger and get used. */
export function invalidateCachedToken(connectionId: string): void {
  cache.delete(connectionId);
}
