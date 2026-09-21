import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SITE_URL } from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Data gets its own typeface — ids, timestamps, counts, technical status —
// so it reads as distinctly "data" against Geist Sans's prose/UI labels,
// instead of one typeface doing every job (Law #21/#58, font-pairing
// tension).
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: "./" },
  openGraph: {
    type: "website",
    siteName: "Relay",
    title: "Relay — cited answers from your own Workspace",
    description: "Self-hosted, read-only. Every answer links to the exact passage it came from, or Relay refuses.",
  },
  twitter: { card: "summary_large_image" },
  title: { default: "Relay — cited answers from your own Workspace", template: "%s · Relay" },
  description:
    "Relay indexes your Drive, Gmail, Calendar and Sheets, then answers questions with a link to the exact passage, or refuses when it can't find one. Self-hosted, read-only.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
