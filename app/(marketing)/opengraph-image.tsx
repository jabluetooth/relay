import { ImageResponse } from "next/og";

export const alt = "Relay — cited answers from your own Workspace";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Type only, in the site's own palette: no stock imagery, no fabricated UI.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#141210",
          color: "#f2ede7",
          padding: "72px 80px",
        }}
      >
        <div style={{ display: "flex", fontSize: 40, fontFamily: "monospace" }}>
          relay<span style={{ color: "#d97757" }}>_</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 108, fontWeight: 700, letterSpacing: -4, lineHeight: 1 }}>
          <div>Cited answers from</div>
          <div>your own Workspace.</div>
          <div style={{ color: "#948b81", marginTop: 8 }}>Or none at all.</div>
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#948b81", fontFamily: "monospace" }}>
          Self-hosted · read-only · Drive, Gmail, Calendar, Sheets
        </div>
      </div>
    ),
    size,
  );
}
