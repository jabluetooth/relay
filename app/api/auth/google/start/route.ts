import { NextRequest, NextResponse } from "next/server";
import { generateCodeVerifier, generateCodeChallenge, signState } from "@/lib/crypto";
import { buildAuthorizationUrl } from "@/lib/google/oauth";
import { scopesFor } from "@/lib/google/scopes";
import type { Surface } from "@/lib/ingest/types";

const VALID_SURFACES: Surface[] = ["drive", "gmail", "calendar", "sheets"];

export async function GET(req: NextRequest) {
  const requested = (req.nextUrl.searchParams.get("surfaces") ?? "drive").split(",");
  const surfaces = requested.filter((s): s is Surface => VALID_SURFACES.includes(s as Surface));

  if (surfaces.length === 0) {
    return NextResponse.json({ error: "No valid surfaces requested" }, { status: 400 });
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = signState(surfaces);

  const authUrl = buildAuthorizationUrl({ scopes: scopesFor(surfaces), state, codeChallenge });

  const res = NextResponse.redirect(authUrl);
  // Short-lived, httpOnly — this cookie only needs to survive the round trip
  // to Google and back for the token exchange's PKCE verifier.
  res.cookies.set("relay_pkce_verifier", codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
