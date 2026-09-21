"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, ExternalLink, ShieldAlert, Copy, Check } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Tooltip from "@/components/ui/Tooltip";
import ConnectionStatus from "@/components/ConnectionStatus";

interface Citation {
  chunkId: string;
  title: string;
  url: string | null;
  snippet: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  refused?: boolean;
  confidence?: number;
  citations?: Citation[];
}

// One example per connected surface (Drive, Gmail, Calendar, Sheets) so the
// empty state doubles as a quick demo of everything Relay can actually
// answer, not just a blank prompt.
const STARTERS = [
  "What's on my calendar this week?",
  "Any important emails I'm missing?",
  "What do my spreadsheets track?",
  "What's in my latest Google Doc?",
] as const;

// The model regularly formats answers with real Markdown (**bold**, lists —
// visible throughout this project's own eval transcripts), but the chat UI
// was rendering it as a raw string, so a user saw literal asterisks instead
// of bold text. Found by actually looking at the rendered page, not by
// checking the API response alone. Only assistant messages go through this
// — a user's own typed input has no reason to be parsed as Markdown.
const markdownComponents: Components = {
  p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  ul: ({ children }) => <ul className="list-disc pl-4 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  ),
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    if (!text || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
      });
      // An empty/non-JSON body (server or database down) must not throw.
      const raw = await res.text();
      let data: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {}

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${data.error ?? `the server returned ${res.status}. Is the database running?`}` },
        ]);
        return;
      }

      setSessionId(data.sessionId);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer,
          refused: data.refused,
          confidence: data.confidence,
          citations: data.citations,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    send(input.trim());
  }

  // Visual feedback on copy (Law #235) — the icon itself flips to a
  // checkmark for a moment instead of a separate toast, since the action
  // and its confirmation live in exactly the same spot.
  async function copyMessage(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((cur) => (cur === index ? null : cur)), 1500);
    } catch {
      // Clipboard permission denied or unavailable — nothing to recover.
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[74ch] flex-col justify-center px-4 py-6 sm:px-6">
      {/* A real terminal window, not a full-bleed chat page — a bordered
          frame with its own title bar gives the chat a distinct identity
          instead of just being "the page". Bounded and vertically centered
          rather than stretched edge-to-edge, so it reads as a discrete
          window instead of just filling the viewport. */}
      <div className="flex h-[min(78vh,680px)] flex-col rounded border border-border bg-surface">
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              <span className="size-2 rounded-full bg-danger/50" />
              <span className="size-2 rounded-full bg-accent/50" />
              <span className="size-2 rounded-full bg-success/50" />
            </div>
            <span className="font-mono text-xs text-muted">relay — chat</span>
          </div>
          <ConnectionStatus />
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
          {messages.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="flex h-full flex-col items-center justify-center"
            >
              <p className="text-lg font-medium tracking-tight">Ask Relay anything</p>
            </motion.div>
          ) : (
            <ul className="space-y-5">
              <AnimatePresence initial={false}>
                {messages.map((m, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className={m.role === "user" ? "text-right" : "text-left"}
                  >
                    <div
                      className={
                        "group relative inline-block max-w-[85%] rounded px-4 py-3 text-sm leading-relaxed " +
                        (m.role === "user" ? "bg-accent text-accent-foreground" : "border border-border bg-surface")
                      }
                    >
                      {m.role === "assistant" ? (
                        <ReactMarkdown components={markdownComponents}>{m.content}</ReactMarkdown>
                      ) : (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      )}
                      {m.refused && (
                        <Tooltip content="Retrieval confidence was too low to answer reliably, so Relay refused rather than guess.">
                          <span className="mt-1.5 inline-flex cursor-default items-center gap-1 text-xs opacity-70">
                            <ShieldAlert className="size-3.5" aria-hidden="true" />
                            refused
                          </span>
                        </Tooltip>
                      )}
                      {m.role === "assistant" && (
                        <button
                          onClick={() => copyMessage(m.content, i)}
                          aria-label="Copy message"
                          className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded border border-border bg-surface text-muted opacity-0 pointer-events-none transition-opacity hover:text-accent group-hover:pointer-events-auto group-hover:opacity-100"
                        >
                          {copiedIndex === i ? (
                            <Check className="size-3.5 text-success" aria-hidden="true" />
                          ) : (
                            <Copy className="size-3.5" aria-hidden="true" />
                          )}
                        </button>
                      )}
                    </div>
                    {m.citations && m.citations.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {m.citations.map((c) => (
                          <li key={c.chunkId}>
                            <motion.button
                              whileHover={{ y: -1 }}
                              whileTap={{ scale: 0.97 }}
                              onClick={() => setOpenCitation(c)}
                              className="rounded border border-border px-2.5 py-1 font-mono text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent"
                            >
                              {c.title}
                            </motion.button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </motion.li>
                ))}
              </AnimatePresence>
              {loading && (
                <motion.li
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="inline-flex items-center gap-1 rounded border border-border bg-surface px-4 py-3"
                  aria-label="Relay is thinking"
                >
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="size-1.5 bg-muted"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
                    />
                  ))}
                </motion.li>
              )}
            </ul>
          )}
        </div>

        {messages.length === 0 && (
          <div className="px-5 pb-5">
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {STARTERS.map((s, i) => (
                <motion.li
                  key={s}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                >
                  <motion.button
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => send(s)}
                    disabled={loading}
                    className="w-full rounded border border-border px-3.5 py-2 text-left font-mono text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40"
                  >
                    {s}
                  </motion.button>
                </motion.li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={sendMessage} className="flex items-center gap-3 border-t border-border p-5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded border border-border bg-background px-4 py-3 focus-within:border-accent">
            <span className="font-mono text-sm text-accent" aria-hidden="true">
              &gt;
            </span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your Docs, Gmail, Calendar, or Sheets…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <motion.button
            type="submit"
            whileHover={input.trim() && !loading ? { y: -1 } : undefined}
            whileTap={input.trim() && !loading ? { scale: 0.94 } : undefined}
            disabled={loading || !input.trim()}
            aria-label="Send message"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded border border-accent bg-accent text-accent-foreground disabled:opacity-40"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </motion.button>
        </form>
      </div>

      <Modal open={openCitation !== null} onClose={() => setOpenCitation(null)} title={openCitation?.title ?? "Source"}>
        {openCitation && (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap rounded border border-border bg-background px-3 py-2.5 font-mono text-xs text-foreground/90">
              {openCitation.snippet}
            </p>
            {openCitation.url && (
              <a
                href={openCitation.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-accent underline underline-offset-2"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
                Open source
              </a>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
