import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// v1 is explicitly single-tenant (PRD §2.2) — there's no login system for
// the app itself, only Google account connections. This bootstraps the one
// "owner" user row everything else (connections, chat sessions) hangs off,
// keyed by an env var rather than a signup flow that doesn't exist yet.
export async function getOrCreateOwnerUser() {
  const email = process.env.RELAY_OWNER_EMAIL;
  if (!email) throw new Error("RELAY_OWNER_EMAIL is not set — see .env.example");

  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing) return existing;

  const [created] = await db.insert(schema.users).values({ email }).returning();
  return created;
}
