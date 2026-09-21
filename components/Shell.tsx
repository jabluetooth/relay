"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Plug, Activity } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const NAV = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/connections", label: "Connections", icon: Plug },
  { href: "/observability", label: "Observability", icon: Activity },
] as const;

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-full flex-col">
      {/* Solid surface, not a blurred glass bar — Warm Terminal has no
          blur/glow effects anywhere (Anti-AI Tell #81). A pure typographic
          wordmark instead of an icon+text lockup (Law #29: logotypes over
          generic icon marks). */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-2.5 sm:px-6">
        <Link href="/" aria-label="Relay home" className="font-mono text-sm font-medium tracking-tight text-foreground">
          relay
          <motion.span
            className="text-accent"
            animate={{ opacity: [1, 1, 0, 0] }}
            transition={{ duration: 1, repeat: Infinity, times: [0, 0.5, 0.5, 1], ease: "linear" }}
          >
            _
          </motion.span>
        </Link>

        <nav aria-label="Primary" className="min-w-0">
          <ul className="flex items-center gap-0.5 rounded border border-border bg-background p-0.5">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={
                      "relative flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-xs uppercase tracking-wide transition-colors sm:px-3 " +
                      (active ? "text-accent-foreground" : "text-muted hover:text-foreground")
                    }
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-0 rounded bg-accent"
                        transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      />
                    )}
                    <Icon className="relative z-10 size-3.5 shrink-0" aria-hidden="true" />
                    <span className="relative z-10 hidden sm:inline">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main className="min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="h-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
