"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

// Framer's own useReducedMotion reads the media query on the first client
// render, so a reduced-motion visitor hydrates different markup than the
// server sent and React throws a hydration error. useSyncExternalStore
// hydrates with the server snapshot (false), then switches to the real
// value right after, which React treats as a normal update, not a mismatch.
export function useReducedMotionSafe(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
