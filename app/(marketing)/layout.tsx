import MarketingProviders from "@/components/marketing/MarketingProviders";
import SiteHeader from "@/components/marketing/SiteHeader";
import SiteFooter from "@/components/marketing/SiteFooter";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <MarketingProviders>
      <a
        href="#main"
        className="sr-only z-50 rounded bg-accent px-3 py-2 font-mono text-xs text-accent-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <div className="site-noise" aria-hidden="true" />
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </MarketingProviders>
  );
}
