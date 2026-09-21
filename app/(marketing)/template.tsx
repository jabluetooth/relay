"use client";

import { motion } from "framer-motion";

// A template (unlike a layout) remounts on every navigation, which gives
// each public page a short entrance without AnimatePresence bookkeeping.
// Opacity only, so sticky children on the pages keep working.
export default function MarketingTemplate({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, ease: "easeOut" }}>
      {children}
    </motion.div>
  );
}
