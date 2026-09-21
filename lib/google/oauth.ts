// Hand-rolled Google OAuth2 authorization-code + PKCE flow, against Google's
// raw endpoints (accounts.google.com / oauth2.googleapis.com) — deliberately
// not using google-auth-library's OAuth2Client for this part. See PRD §6.3:
// the entire point of this project is proving the flow itself is understood
// and written by hand, not delegated to a library or (elsewhere in this
// portfolio) to n8n's Google nodes.
//
// The `googleapis` SDK is still used elsewhere (lib/google/client.ts) to
// call Drive/Docs/Gmail/Calendar/Sheets once we already hold an access
// token — that's just an API client, it doesn't hide any OAuth mechanics.

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — see .env.example`);
  return v;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string; // only present on the very first exchange, or with prompt=consent
  scope: string;
  token_type: string;
  id_token?: string;
}

export function buildAuthorizationUrl(opts: {
  scopes: string[];
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: requiredEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: requiredEnv("GOOGLE_REDIRECT_URI"),
    response_type: "code",
    scope: opts.scopes.join(" "),
    access_type: "offline", // request a refresh token
    include_granted_scopes: "true", // incremental auth (FR-2)
    prompt: "consent", // force a refresh token even on a re-connect
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requiredEnv("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export async function revokeToken(token: string): Promise<void> {
  const res = await fetch(REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  // Google returns 200 even if the token was already invalid — only a
  // non-2xx here indicates our request itself was malformed.
  if (!res.ok) {
    throw new Error(`Google token revoke failed (${res.status}): ${await res.text()}`);
  }
}

export async function fetchAccountEmail(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google userinfo fetch failed (${res.status}): ${await res.text()}`);
  }
  const info = (await res.json()) as { email?: string };
  if (!info.email) throw new Error("Google userinfo response had no email");
  return info.email;
}
