# Product Requirements Document
## Relay — Google Workspace RAG Assistant

**Author:** Fil Heinz O. Re La Torre
**Date:** September 2026
**Status:** Draft v1.0
**Project type:** Portfolio / demonstration project, purpose-built to close a named, recurring gap across real job applications
**Working title:** "Relay" — rename freely; the PRD doesn't depend on the name.

---

## 1. Problem Statement

Across roughly two dozen real job applications tailored this month (via this author's own `resume-tailor` pipeline), one gap recurred more than any other: hands-on experience integrating with everyday business SaaS platforms — Google Workspace, Microsoft 365, Monday.com, Dropbox — named explicitly in 8 of 22 postings. One listing (Single Thread Health, Product Analyst) named it as a hard requirement, spelled out to the API level: *"Experience developing solutions within Google Workspace, including Apps Script and the Drive, Docs, Gmail, Calendar, and Sheets APIs."*

The deeper issue isn't just a missing line item. This author's existing integration work (Match's job-board scraping, Bonny-AI's Google OAuth sign-in) runs almost entirely through n8n's pre-built nodes — which means there's no evidence anywhere of personally having handled OAuth token refresh, webhook signature/channel verification, or pagination without a low-code tool doing it invisibly underneath.

There's also a real underlying problem worth solving, not just a skill to demonstrate: work is scattered across Drive, Docs, Gmail, Calendar, and Sheets with no single place to ask "what did we decide about X" or "when's the deadline for Y" and get a grounded answer with a citation back to the actual source. This is the same "connected workflows" pitch Single Thread Health's own company overview makes about its *internal* tooling — this project is a smaller, single-user version of exactly that problem.

## 2. Goal

Build a Google Workspace-connected AI assistant that a user signs into with their own Google account (hand-rolled OAuth2, not a wrapper library that hides the flow), which indexes their Drive files (Docs, Sheets, PDFs), Gmail messages, and Calendar events into a searchable, RAG-grounded knowledge base, and answers natural-language questions with citations back to the exact source — refusing rather than guessing when it isn't confident, reusing the grounded-RAG pattern already proven in this author's Mimo project. A companion Google Sheets Apps Script add-on lets a user query the assistant without leaving Workspace, demonstrating Apps Script as a genuinely distinct skill from calling the REST APIs externally.

### 2.1 Success Criteria

| Metric | Target |
|---|---|
| Retrieval accuracy (expected source in top-4 reranked chunks, ground-truth eval set built from this author's real Drive/Gmail/Calendar content) | ≥ 90% |
| Citation correctness (citation actually points to the source the answer is grounded in) | ≥ 90% |
| Prompt-injection resistance (adversarial suite, content planted in a test email/doc) | ≥ 95% resisted |
| OAuth reliability | Zero manual re-authentication required over a 7-day connected session (silent refresh only) |
| Surface coverage | All five named APIs (Drive, Docs, Gmail, Calendar, Sheets) successfully ingest and are independently queryable |
| Sync freshness (Drive/Calendar via push notification) | Index reflects a source change within 5 minutes, end to end |
| Apps Script add-on | A query submitted from inside a real Google Sheet returns a grounded, cited answer, end to end |
| Real usage | This author's own Workspace account connected and used for real queries over a 2-week pilot |

### 2.2 Non-Goals (v1)

- **No write-back or action-taking.** Relay answers questions; it never creates a Calendar event, edits a Doc, or sends an email on its own. Same hard line as this author's Insight project — a read-only assistant earns trust before an action-taking one gets considered.
- **Not multi-tenant.** v1 is scoped to one connected account (this author's own), the same way Mimo started as a single-tenant knowledge base before any RBAC layer was added. Google's own unverified-app cap (100 test users) makes multi-tenant a non-starter for v1 anyway — see §8.
- **Not an enterprise-wide search tool.** No shared-drive-across-an-organization indexing; a user's own Drive/Gmail/Calendar only.
- **No full-thread Gmail rendering.** Indexes subject, snippet, and body text for retrieval; not a Gmail client replacement.
- **No Microsoft 365, Monday.com, or Dropbox connector in v1** — deliberately deferred. The architecture (§6) is built so a second connector is an additional ingestion adapter, not a rewrite, but building a second platform now would dilute the depth that makes the Google Workspace coverage credible.

## 3. Users & Use Cases

**Primary persona:** This author, using it on their own real Workspace account — the same "eat your own dog food" approach Insight and Mimo both took before anyone else touched them.

**Secondary persona (the one a hiring manager is picturing):** An operations-heavy small team member who wants to ask "what did we agree with this vendor" or "when's our next call with X" without hunting across Gmail, Calendar, and a Drive folder by hand.

**Example use cases:**
- "What did I actually commit to in my email thread with [company] about the Product Analyst role?" — grounded in real Gmail content, cited back to the message.
- "What's on my calendar this week that mentions AEC Agent or Modular Engineers?" — grounded in Calendar, cited to the event.
- "What does the tailoring-notes file for the Single Thread Health application say the gaps were?" — grounded in a real Drive file (a Doc or plain text file), cited to the file and section.
- From inside a Google Sheet tracking job applications: select a row, ask the Apps Script sidebar "summarize my last email exchange with this company" — answered without leaving Sheets.

## 4. Functional Requirements

### 4.1 Authentication & Authorization
- FR-1: System shall implement Google OAuth2 authorization-code flow with PKCE and a signed `state` parameter directly (no all-in-one "Sign in with Google" component that hides the exchange), since proving this was hand-built is the point of the project.
- FR-2: System shall request incremental, least-privilege scopes — a user can connect Drive only, or add Gmail/Calendar/Sheets later, rather than an all-or-nothing consent screen.
- FR-3: Refresh tokens shall be stored AES-256-GCM encrypted at rest (matching the pattern already proven in Insight); access tokens refresh transparently on expiry with a single-flight guard so concurrent requests don't race to refresh the same token.
- FR-4: Disconnecting an account shall revoke the stored token with Google, purge it locally, and cancel any active push-notification channels for that account (see FR-9).

### 4.2 Ingestion & Indexing
- FR-5: **Drive/Docs** — list and fetch Docs (via the Docs API, not just a Drive export blob, so structure like headings survives into chunking) and PDFs (Drive download + text extraction) within a user-selected root folder or the whole Drive.
- FR-6: **Gmail** — index subject, snippet, and body for messages matching a user-configured scope (label and/or date range, opt-in — see §8 on why this isn't "index everything" by default), via `messages.list`/`get`.
- FR-7: **Calendar** — index event titles, descriptions, attendees, and times for a user-selected calendar (primary by default).
- FR-8: **Sheets** — index a spreadsheet's tab names, header rows, and cell values as structured, retrievable facts rather than flattening a sheet into an unstructured text blob — a deliberate distinction from treating every source the same way.
- FR-9: Every ingested chunk shall store enough provenance (source type, source id, a deep link back to the exact Doc heading/email/event/spreadsheet range) to render a real, clickable citation — the same per-claim citation discipline Mimo already proved out.

### 4.3 Sync & Freshness
- FR-10: Drive and Calendar changes shall propagate via Google push-notification channels (`files.watch` / `events.watch`) hitting a webhook receiver this project implements and verifies by channel token, with scheduled renewal before each channel's ~24-hour expiry — not proxied through n8n or any other low-code tool.
- FR-11: Gmail changes shall sync via scheduled `history.list` polling rather than a push-notification channel. **Documented tradeoff:** Gmail push notifications require a Google Cloud Pub/Sub topic, which would force an end user (in a future multi-tenant version) through GCP project setup just to connect their inbox; polling keeps the connection flow to "sign in with Google" only. This is an explicit architecture decision, not an oversight — see §6.
- FR-12: Sheets changes are detected via the same Drive-level file watch (a Sheet is a Drive file) and trigger a targeted re-fetch of that spreadsheet's values only, not a full Drive re-scan.

### 4.4 Retrieval & Answering
- FR-13: Grounded RAG pipeline reusing Mimo's proven shape: vector retrieval → cross-encoder reranking → confidence-gated generation → explicit refusal path, with per-claim citations linking back to the real Google source.
- FR-14: Retrieved content (email bodies, doc text) shall be treated as untrusted data in the system prompt, never as instructions — the same posture as Mimo's FR-12, since forwarded/quoted email content is exactly the kind of externally-controlled text that could carry a planted prompt injection.
- FR-15: The retrieval layer shall filter by source ownership (the connected account's own data only) at the query layer by design, even though v1 is single-user — so multi-tenancy later is an added filter, not a retrofit.

### 4.5 Apps Script Companion
- FR-16: A Google Sheets-bound Apps Script add-on (Card service sidebar) shall let a user type a question and receive a grounded, cited answer without leaving Sheets, calling the same backend query endpoint the web app uses.
- FR-17: The add-on shall support scoping a query to "this spreadsheet only," using the open spreadsheet's file ID — something only possible because Apps Script runs inside the Workspace host context, not from an external server.
- FR-18: The add-on authenticates via a token exchange using the Apps Script `ScriptApp`-issued OAuth token, exchanged once for this app's own short-lived session token — documented as an explicit handshake, not a shared secret pasted into script properties.

### 4.6 Interface
- FR-19: Web chat interface (reusing Mimo's chat/citation UI pattern) plus a connections page showing, per surface, whether it's connected, which scopes are granted, and last successful sync time, with a disconnect control per surface.
- FR-20: Observability dashboard: query volume, refusal rate, per-surface sync lag, and latency — the same differentiator already shipped in Mimo and Insight, applied here.

## 5. Non-Functional Requirements

- **Security:** least-privilege incremental OAuth scopes (FR-2); encrypted token storage (FR-3); webhook channel-token verification on every push-notification receipt, rejecting anything that doesn't match an active channel; no token or raw email/doc content ever logged in plaintext.
- **Privacy:** this project indexes a real person's real email and documents, not synthetic data. Full account disconnection must purge both the OAuth token and every indexed vector/provenance row tied to that account, and this is stated plainly before a user connects. Given that reality, the live public demo pattern used for Insight and Mimo (anyone can try it, no signup) is **not appropriate here** — see §8 for how this changes the portfolio presentation.
- **Reliability:** the webhook receiver must handle Google's at-least-once delivery idempotently (dedupe by `resourceId` + change token), renew push channels before expiry with an alert if a renewal fails silently, and retry/back off on Google API rate limits (per-user quota, not just a global one).
- **Cost control:** one bounded LLM call per query, incremental sync (only re-embed changed content, never a full re-index on every webhook fire).
- **Maintainability:** each surface (Drive/Docs, Gmail, Calendar, Sheets) is a separable ingestion adapter behind a common chunk-and-provenance interface, so a fifth or sixth connector (Microsoft 365, Dropbox) is additive, not a rewrite — mirroring the component separation already used in Insight.

## 6. Proposed Architecture

### 6.1 High-Level Flow

```
User → OAuth connect (incremental scopes, per surface)
     → Initial backfill ingestion (Drive/Docs, Gmail, Calendar, Sheets)
     → Chunk → Embed → Qdrant (+ provenance in Postgres)

Ongoing:
  Drive/Calendar file change → Google push notification → webhook receiver
                                                          → targeted re-fetch → re-embed changed chunks
  Gmail change → scheduled history.list poll → targeted re-fetch → re-embed changed chunks

Query:
  Web chat OR Apps Script sidebar → query endpoint
     → retrieve (Qdrant) → rerank → confidence gate
     → generate (grounded, cited) OR refuse
     → log to Postgres (observability dashboard)
```

### 6.2 Components

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (chat, connections page, dashboard) | Consistent with this author's existing stack (Match, Mimo's own frontend, What To Do). |
| Backend / API routes | Next.js API routes, hand-written (no n8n) | The entire point of this project is proving hand-rolled OAuth/webhook/integration code exists somewhere in the portfolio. |
| OAuth & webhook handling | Hand-implemented against Google's REST endpoints directly | Same reasoning as above — a convenience SDK that hides the token exchange defeats the purpose. |
| Vector DB | Qdrant (self-hosted, Docker) | Matches Mimo; reuses proven embedding/rerank pipeline instead of introducing a new vector store to debug. |
| Embeddings / Reranker | Hugging Face Inference API, same models as Mimo | Consistency, proven latency/cost profile. |
| LLM | Groq | Consistency with the rest of the portfolio. |
| Relational store | Postgres (Neon) | Provenance, connection state, sync watermarks, observability logs. |
| Background sync | Scheduled jobs (Gmail polling, channel renewal) | Upstash QStash/cron, same pattern already used in What To Do. |
| Apps Script | Google Apps Script (Card service UI, `ScriptApp` OAuth) | The only way to genuinely demonstrate Apps Script rather than claim it by association. |
| Deployment | Vercel (frontend/API) + self-hosted Qdrant | Matches existing deployment pattern across the portfolio. |

### 6.3 Why Not n8n

Every other automation-heavy project in this portfolio (Match, Mimo, Insight, ZeroPress) is n8n-orchestrated, and that's a real strength elsewhere. It's specifically the wrong choice here: n8n's Google nodes handle OAuth and pagination invisibly, which is exactly the capability this project exists to demonstrate in the applicant's own code. Relay's backend is hand-written Next.js API routes calling Google's REST APIs directly.

### 6.4 Google API Verification Reality

An unverified Google OAuth app is capped at 100 test users and shows an "unverified app" warning screen. For a single-user (this author's own account) v1, that's a non-issue — it's explicitly scoped as such in §2.2. It becomes a real constraint the moment this is opened to other users, which is why multi-tenant is out of scope for v1 rather than a stretch goal.

### 6.5 Open Architecture Questions

- Whether PDF text extraction should run client-side (Drive export + a JS PDF library) or server-side (Python subprocess, reusing patterns from GrooveGrid's FastAPI split) — deferred to implementation.
- Whether Sheets structured-fact retrieval needs its own retrieval path (structured query) alongside the vector path, or whether flattening a row into a citable chunk is sufficient for v1 — flagged for the eval phase (§7) to answer empirically rather than guessing upfront.

## 7. Evaluation Plan

Mirrors Mimo's methodology directly:
- A ground-truth Q&A set (target: 25+ questions) built from this author's own real Drive/Gmail/Calendar content, spanning all five surfaces.
- An adversarial suite adapted from Mimo's 12-case suite, with at least one new case specific to this project: a planted prompt-injection payload inside a Gmail message body (the highest-risk untrusted-content surface here, per FR-14).
- Measure retrieval accuracy, citation correctness, and refusal calibration against both sets, the same way Mimo's threshold fix (0.5 → 0.45) was found — by inspecting raw reranker scores, not trusting the final answer text.

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Real personal email/doc content is sensitive | Opt-in scoping per surface (FR-2, FR-6); no public live demo with real data — portfolio presentation uses a recorded walkthrough and a redacted/synthetic demo account instead (see §10). |
| Push-notification channel silently expires, sync goes stale | Renewal job runs well before the ~24h expiry window; a missed renewal alerts (Slack, matching the pattern in Insight/Mimo) rather than failing silently. |
| Unverified-app warning screen looks unpolished in a demo | Documented plainly as a known, deliberate v1 scoping choice (§6.4), not hidden — same honesty pattern as Mimo's "Known limitations" section. |
| Gmail polling misses a narrow race window between two polls | `history.list`'s own history-id cursor makes this eventually consistent within one poll interval; acceptable for v1, documented as a freshness bound, not a data-loss risk (nothing is ever silently dropped, only delayed). |

## 9. Milestones

1. **M1 — Core connector + chat:** OAuth (FR-1–4), Drive/Docs ingestion (FR-5), chat with citations (FR-13–14, 19).
2. **M2 — Full surface coverage:** Gmail, Calendar, Sheets ingestion (FR-6–8).
3. **M3 — Freshness:** Drive/Calendar push-notification sync, Gmail polling (FR-10–12).
4. **M4 — Apps Script companion:** Sheets sidebar add-on (FR-16–18).
5. **M5 — Eval & observability:** ground-truth/adversarial suite (§7), dashboard (FR-20), portfolio writeup.

## 10. Portfolio Presentation Strategy

Unlike Insight and Mimo, this project should **not** ship as a public "try it with no signup" demo — it indexes real personal Gmail/Drive content, and offering that to anonymous visitors is a different risk profile than a portfolio README. The presentation instead leans on:
- A recorded demo (GIF/video) walking through connecting an account, an indexed query with a real citation, and the Apps Script sidebar working live inside a Sheet.
- A README that states plainly, the same way Mimo's does, what's genuinely live versus a known limitation — including the unverified-app screen and the single-tenant scoping.
- Explicit framing, in the README and on the portfolio site, that this project exists specifically to answer a named, recurring gap surfaced across real job applications (Single Thread Health's literal API list), not as a generic RAG demo — that's the differentiator over Mimo, which already proves the RAG pattern works.

## 11. Out of Scope (v1) / Future Work

- Microsoft 365 and Dropbox connectors (the architecture in §6 is built to make this additive; not attempted until Google Workspace coverage is solid and evaluated).
- Any write-back/action-taking capability (create an event, send a reply, edit a Doc).
- Multi-tenant / other users connecting their own accounts (blocked on Google's OAuth verification review, which isn't worth pursuing for a single-user portfolio piece).
- Monday.com-style board/task integration (a different problem shape — structured task data rather than document/message retrieval — better suited to its own project than bolted onto this one).
- **React Native/Expo mobile client and home-screen widgets.** Technically feasible (would follow WhatToDo-mobile's bearer-token OAuth-bridge pattern) and discussed during planning, but deliberately dropped from scope: no job description this project was built to answer (Modular Engineers, Single Thread Health, AOAI, Pivotly) asks for mobile or native widget work, so it would compete with M1–M5 time without reinforcing the gap this project exists to close. Web-only for v1.
