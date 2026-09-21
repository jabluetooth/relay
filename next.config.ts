import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist (lib/ingest/pdf.ts) resolves its Node "fake worker" via a
  // dynamic import relative to its own file at runtime. Bundled by
  // Turbopack, that import target gets relocated into .next's chunk
  // layout and breaks ("Cannot find module '...chunks/pdf.worker.mjs'").
  // Excluding it from server bundling makes Next.js load it via plain
  // Node module resolution instead, where the relative import is real.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
