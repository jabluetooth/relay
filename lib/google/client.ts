import { OAuth2Client } from "google-auth-library";
import { drive } from "@googleapis/drive";
import { docs } from "@googleapis/docs";
import { gmail } from "@googleapis/gmail";
import { calendar } from "@googleapis/calendar";
import { sheets } from "@googleapis/sheets";

// One small package per API instead of the umbrella `googleapis` package
// (210 MB, every Google API that exists). Relay talks to five, and the
// difference is what makes it practical to install with npm.
//
// `OAuth2Client` is used here ONLY as a bearer-token carrier for an access
// token we already obtained via our own hand-rolled flow
// (lib/google/oauth.ts) — never for .generateAuthUrl()/.getToken(), which
// is the part deliberately not delegated to a library. See PRD §6.3.
function authFor(accessToken: string) {
  const auth = new OAuth2Client();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

export function driveClient(accessToken: string) {
  return drive({ version: "v3", auth: authFor(accessToken) });
}

export function docsClient(accessToken: string) {
  return docs({ version: "v1", auth: authFor(accessToken) });
}

export function gmailClient(accessToken: string) {
  return gmail({ version: "v1", auth: authFor(accessToken) });
}

export function calendarClient(accessToken: string) {
  return calendar({ version: "v3", auth: authFor(accessToken) });
}

export function sheetsClient(accessToken: string) {
  return sheets({ version: "v4", auth: authFor(accessToken) });
}
