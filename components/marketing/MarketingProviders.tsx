"use client";

import { MotionConfig } from "framer-motion";

// One switch for the whole public site: when the OS asks for reduced
// motion, transform animations are skipped and only opacity changes remain.
export default function MarketingProviders({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
