import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { verifyState, encryptToken } from "@/lib/crypto";
import { exchangeCodeForTokens, fetchAccountEmail } from "@/lib/google/oauth";
import { getOrCreateOwnerUser } from "@/lib/db/owner";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/connections?error=${encodeURIComponent(error)}`, req.url));
  }
  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  const codeVerifier = req.cookies.get("relay_pkce_verifier")?.value;
  if (!codeVerifier) {
    return NextResponse.json({ error: "Missing PKCE verifier cookie — retry the connect flow" }, { status: 400 });
  }

  let surfaces: string[];
  try {
    surfaces = verifyState(state).surfaces;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // Anything that goes wrong from here (Google rejecting the code, the
  // database being down) ends on the Connections page with a generic message.
  // The detail goes to the server log only; it can contain Google's raw
  // error text and must not be reflected to the browser.
  try {
    return await completeConnection(req, code, codeVerifier, surfaces);
  } catch (err) {
    console.error("Google connect failed:", err);
    const res = NextResponse.redirect(new URL("/connections?error=connect_failed", req.url));
    res.cookies.delete("relay_pkce_verifier");
    return res;
  }
}

async function completeConnection(req: NextRequest, code: string, codeVerifier: string, surfaces: string[]) {
  const tokens = await exchangeCodeForTokens(code, codeVerifier);
  const email = await fetchAccountEmail(tokens.access_token);
  const user = await getOrCreateOwnerUser();

  const grantedScopes = tokens.scope.split(" ").filter(Boolean);

  const [existing] = await db
    .select()
    .from(schema.googleConnections)
    .where(and(eq(schema.googleConnections.userId, user.id), eq(schema.googleConnections.googleAccountEmail, email)))
    .limit(1);

  if (existing) {
    const mergedScopes = [...new Set([...existing.scopes, ...grantedScopes])];
    await db
      .update(schema.googleConnections)
      .set({
        scopes: mergedScopes,
        // A refresh token is only returned on first consent or with
        // prompt=consent (which we always send) — safe to overwrite.
        ...(tokens.refresh_token ? { encryptedRefreshToken: encryptToken(tokens.refresh_token) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.googleConnections.id, existing.id));
  } else {
    if (!tokens.refresh_token) {
      return NextResponse.json(
        { error: "Google did not return a refresh token — this shouldn't happen with prompt=consent" },
        { status: 500 }
      );
    }
    await db.insert(schema.googleConnections).values({
      userId: user.id,
      googleAccountEmail: email,
      encryptedRefreshToken: encryptToken(tokens.refresh_token),
      scopes: grantedScopes,
    });
  }

  const res = NextResponse.redirect(new URL(`/connections?connected=${surfaces.join(",")}`, req.url));
  res.cookies.delete("relay_pkce_verifier");
  return res;
}
