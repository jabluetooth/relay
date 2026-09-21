import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Two jobs, both about keeping a person's data on their own machine.
//
// 1. Site-only mode (the public deployment): only the marketing pages exist.
//    The product pages have no login and their API routes need a database,
//    so they 404 outright. NEXT_PUBLIC_SITE_ONLY is set for the build in
//    next.config.ts (it is also forced on whenever the build runs on Vercel).
//
// 2. Self-hosted mode: Relay has no login, because it is meant to run on the
//    owner's own computer, so the protection is "only that computer's own
//    browser tab can talk to it". Any website you visit can still make your
//    browser send requests to http://localhost:3000, and a DNS-rebinding
//    page can even read the replies, so every request has to prove it is
//    really the local app talking to itself:
//      - Host must be a loopback name (defeats DNS rebinding, where the
//        attacker's own hostname points at 127.0.0.1),
//      - Origin, when the browser sends one, must be loopback too,
//      - Sec-Fetch-Site must not say the request came from another site,
//      - anything that changes state must be JSON (a cross-site page can't
//        send application/json without a CORS preflight, which is refused).
const SITE_ONLY = process.env.NEXT_PUBLIC_SITE_ONLY === "1";
const PRODUCT_PATHS = ["/chat", "/connections", "/observability", "/api"];
const isProductPath = (p: string) => PRODUCT_PATHS.some((x) => p === x || p.startsWith(x + "/"));

// Routes that have their own, stronger authentication and are called by
// Google / QStash from the internet by design, not by the user's browser:
// Google's push channels carry a per-channel secret token, and QStash jobs
// carry a signed request. They must skip the loopback-only checks or a
// tunnelled install could never receive them.
const MACHINE_ROUTES = ["/api/webhooks/", "/api/jobs/"];

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Escape hatch for people who deliberately serve Relay on another name.
// Comma-separated hostnames, e.g. RELAY_ALLOWED_HOSTS=relay.internal
const EXTRA_HOSTS = new Set(
  (process.env.RELAY_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

function hostnameOf(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  // "[::1]:3000" -> "[::1]", "localhost:3000" -> "localhost"
  const h = hostHeader.trim().toLowerCase();
  return h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0];
}

function isAllowedHost(name: string | null): boolean {
  return name !== null && (LOOPBACK.has(name) || EXTRA_HOSTS.has(name));
}

const deny = (status: number, message: string) =>
  new NextResponse(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (SITE_ONLY) {
    return isProductPath(pathname) ? new NextResponse("Not found", { status: 404 }) : NextResponse.next();
  }

  if (MACHINE_ROUTES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (!isAllowedHost(hostnameOf(req.headers.get("host")))) {
    return deny(421, "Relay only answers requests addressed to localhost.");
  }

  // Same-origin only: the Origin must be exactly this server (host AND port),
  // so a different local app or dev server on another port can't call it either.
  const origin = req.headers.get("origin");
  if (origin !== null) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      /* "null" (sandboxed iframe / file:) and malformed values are refused below */
    }
    if (originHost !== (req.headers.get("host") ?? "").toLowerCase()) {
      return deny(403, "Cross-origin requests are not allowed.");
    }
  }

  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site") {
    // A top-level navigation (typing the address, following the Google
    // OAuth redirect back) is fine; a script or embed from another site is not.
    const isNavigation = req.headers.get("sec-fetch-mode") === "navigate" && req.method === "GET";
    if (!isNavigation) return deny(403, "Cross-site requests are not allowed.");
  }

  const changesState = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (changesState && pathname.startsWith("/api/")) {
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return deny(415, "Send a JSON body with Content-Type: application/json.");
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next's own static assets. Pages are covered too, not
  // only the API: the Host check is what stops a rebinding page loading the
  // app itself.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
