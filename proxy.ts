import { NextResponse } from "next/server";

// Site-only mode is for the public deployment (Vercel): only the marketing
// pages exist there. The product pages have no login and their API routes
// need a database, so they must not be reachable at all — a 404, not a
// broken page. Self-hosted installs leave the variable unset and get
// everything. NEXT_PUBLIC_ so the header can read the same flag at build time.
const SITE_ONLY = process.env.NEXT_PUBLIC_SITE_ONLY === "1";

export function proxy() {
  if (!SITE_ONLY) return NextResponse.next();
  return new NextResponse("Not found", { status: 404 });
}

export const config = {
  matcher: ["/chat/:path*", "/connections/:path*", "/observability/:path*", "/api/:path*"],
};
