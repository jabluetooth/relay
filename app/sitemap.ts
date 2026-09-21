import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Public pages only — the product routes are not served on the public site.
const PATHS = ["", "/how-it-works", "/security", "/get-started", "/design"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((path) => ({ url: `${SITE_URL}${path}`, changeFrequency: "monthly" }));
}
