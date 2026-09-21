import { google } from "googleapis";

// `google.auth.OAuth2` is used here ONLY as a bearer-token carrier for an
// access token we already obtained via our own hand-rolled flow
// (lib/google/oauth.ts) — never for .generateAuthUrl()/.getToken(), which
// is the part deliberately not delegated to this library. See PRD §6.3.
function authFor(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

export function driveClient(accessToken: string) {
  return google.drive({ version: "v3", auth: authFor(accessToken) });
}

export function docsClient(accessToken: string) {
  return google.docs({ version: "v1", auth: authFor(accessToken) });
}

export function gmailClient(accessToken: string) {
  return google.gmail({ version: "v1", auth: authFor(accessToken) });
}

export function calendarClient(accessToken: string) {
  return google.calendar({ version: "v3", auth: authFor(accessToken) });
}

export function sheetsClient(accessToken: string) {
  return google.sheets({ version: "v4", auth: authFor(accessToken) });
}
