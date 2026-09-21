import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy. The point here is containment: Relay renders text
// that came out of a language model reading other people's email, so if
// something slips through (a markdown image, a link, injected markup) the
// browser itself must refuse to send data anywhere else. Everything is
// same-origin only.
//  - img-src / connect-src / form-action 'self': an answer can't make the
//    browser fetch or post to a third-party address, which is how a
//    prompt-injected email would smuggle data out.
//  - frame-ancestors 'none' + X-Frame-Options: nobody can embed the app in
//    a page and trick a click on "Disconnect".
//  - script-src keeps 'unsafe-inline' because Next.js emits inline bootstrap
//    scripts; a per-request nonce would force every page (including the
//    static marketing pages) to render dynamically. 'unsafe-eval' is
//    development-only (React refresh).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Citation links open Drive/Gmail URLs; don't tell them which page of the
  // app (or which local address) the click came from.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // pdfjs-dist (lib/ingest/pdf.ts) resolves its Node "fake worker" via a
  // dynamic import relative to its own file at runtime. Bundled by
  // Turbopack, that import target gets relocated into .next's chunk
  // layout and breaks ("Cannot find module '...chunks/pdf.worker.mjs'").
  // Excluding it from server bundling makes Next.js load it via plain
  // Node module resolution instead, where the relative import is real.
  serverExternalPackages: ["pdfjs-dist"],

  poweredByHeader: false,

  // The npm package ships a prebuilt, self-contained server (`npm run
  // build:package`), so people who install it never run a build or download
  // the ~700 MB of build tooling. Off for normal dev and for Vercel.
  output: process.env.RELAY_STANDALONE === "1" ? "standalone" : undefined,
  // Pin the trace root to this project so a lockfile in some parent folder
  // can't change where the standalone server ends up.
  outputFileTracingRoot: path.join(process.cwd()),
  // lib/ingest/pdf.ts reads pdfjs's font files by path at runtime, which the
  // file tracer can't see, so they are listed explicitly.
  outputFileTracingIncludes: {
    "/api/jobs/*": ["./node_modules/pdfjs-dist/standard_fonts/**/*"],
    "/api/ingest/*": ["./node_modules/pdfjs-dist/standard_fonts/**/*"],
  },

  // The public deployment must never serve the product. Fail closed: a build
  // that runs on Vercel is site-only even if the variable was forgotten.
  // Self-hosters aren't on Vercel, so they are unaffected.
  env: {
    NEXT_PUBLIC_SITE_ONLY: process.env.NEXT_PUBLIC_SITE_ONLY ?? (process.env.VERCEL ? "1" : ""),
  },

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Nothing outside this origin has any business reading API responses.
      { source: "/api/:path*", headers: [{ key: "Cross-Origin-Resource-Policy", value: "same-origin" }, { key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
