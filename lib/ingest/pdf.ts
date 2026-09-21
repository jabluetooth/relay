import path from "path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";

// PDF text extraction (PRD §5, FR-5) — was listed but skipped during
// backfill (see the former TODO in drive.ts). Uses pdfjs-dist directly
// (Mozilla's own engine) rather than a pdf-parse-style wrapper: pure JS, no
// native/canvas dependency, and this only needs text content, not rendering.
//
// `standardFontDataUrl` must be given explicitly in Node (there's no
// document.baseURI to resolve it against like in a browser) and must be a
// forward-slash path with a trailing slash regardless of platform — passing
// a Windows backslash path throws "Invalid factory url" at runtime, and
// pdfjs-dist otherwise falls back to a substituted font with no warning,
// which risks slightly wrong glyph-to-Unicode mapping for now-substituted
// fonts. Confirmed by running it against a real minimal PDF before wiring
// this into ingestion.
// Built from the project root, not `require.resolve`: Turbopack rewrites
// `require.resolve` to a numeric module id at build time, which made
// `next build` fail here. pdfjs-dist is `serverExternalPackages`, so it is
// always the real node_modules copy at runtime.
const standardFontDataUrl =
  path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts").replace(/\\/g, "/") + "/";

/** Extracts plain text from a PDF's raw bytes, page by page, in reading order. */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const loadingTask = getDocument({ data, standardFontDataUrl });
  try {
    const doc = await loadingTask.promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((item) => (isTextItem(item) ? item.str : "")).join(" ");
      pages.push(text);
    }
    return pages.join("\n\n").trim();
  } finally {
    // Cleanup lives on the loading task, not the resolved document proxy
    // (PDFDocumentProxy only exposes `.cleanup()`, not `.destroy()`) —
    // confirmed against the actual runtime shape, not just the types.
    await loadingTask.destroy();
  }
}

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return "str" in item;
}
