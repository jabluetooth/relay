import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  real,
  jsonb,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// v1 is single-tenant (see PRD §2.2), but modeled as a real users table so
// ownership-scoped retrieval (FR-15) isn't a retrofit when multi-user lands.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const surfaceEnum = pgEnum("surface", ["drive", "gmail", "calendar", "sheets"]);

// One row per connected Google account. Google issues one refresh token per
// (client, account) pair covering whatever scopes were granted so far —
// incremental auth (FR-2) updates the scopes array on the same row rather
// than creating a new row per surface.
export const googleConnections = pgTable("google_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  googleAccountEmail: text("google_account_email").notNull(),
  // AES-256-GCM ciphertext (see lib/crypto.ts) — never store a raw refresh token (FR-3).
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  scopes: text("scopes").array().notNull(),
  // One unified switch for "keep every connected surface on this account
  // fresh automatically" — covers both mechanisms transparently: Drive
  // (and later Calendar) via a real push-notification channel, Gmail via
  // the polling job (FR-11's documented tradeoff — Gmail can't get a
  // Drive-style webhook without Google Cloud Pub/Sub). Off by default: an
  // explicit opt-in, consistent with FR-6's own "don't sync personal
  // content until asked" stance. Manual "Sync now" clicks work regardless
  // of this flag — it only controls ongoing automatic behavior.
  autoSyncEnabled: boolean("auto_sync_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Per-surface sync state: last successful sync, and whatever cursor that
// surface's API uses to resume incrementally (Drive/Calendar: page/sync
// token; Gmail: historyId). Kept separate from googleConnections because
// each surface's freshness lifecycle is independent (FR-10, FR-11).
export const surfaceSync = pgTable(
  "surface_sync",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => googleConnections.id, { onDelete: "cascade" }),
    surface: surfaceEnum("surface").notNull(),
    cursor: text("cursor"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    // Per-surface ingestion scope, e.g. Gmail's { labelId, after, before }
    // (FR-6 opt-in scoping — real personal email isn't indexed by default,
    // see lib/ingest/gmail.ts). Empty object means "not configured yet" for
    // surfaces that require explicit scope before they'll do anything.
    config: jsonb("config").notNull().default({}),
    // Non-null while a backfill/sync job is actively running for this
    // surface; cleared (success or failure) when it finishes. Serves two
    // purposes: the connections UI polls this to show a real "Syncing…"
    // state instead of the misleading instant flash a fire-and-forget
    // 202 gives (background jobs run for minutes, not the request/response
    // cycle), and it doubles as a durable dedup guard against QStash's
    // at-least-once delivery — the in-process Set in
    // app/api/jobs/backfill/route.ts only protects one server instance and
    // doesn't survive a restart, this does.
    syncStartedAt: timestamp("sync_started_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    connectionSurfaceUnique: uniqueIndex("surface_sync_connection_surface_idx").on(
      t.connectionId,
      t.surface
    ),
  })
);

// Active Google push-notification channels for Drive/Calendar (FR-10).
// Gmail has no channel row since it syncs by polling (FR-11), not push.
export const webhookChannels = pgTable("webhook_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  connectionId: uuid("connection_id")
    .notNull()
    .references(() => googleConnections.id, { onDelete: "cascade" }),
  surface: surfaceEnum("surface").notNull(),
  channelId: text("channel_id").notNull().unique(),
  resourceId: text("resource_id").notNull(),
  // Random per-channel secret Google echoes back on every notification
  // (X-Goog-Channel-Token) — verified on receipt before any sync work runs.
  channelToken: text("channel_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per ingested source item (a Doc, a Gmail message, a Calendar
// event, a Sheet). Chunk text/embeddings live in Qdrant; this table is the
// provenance layer citations are built from (FR-9).
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => googleConnections.id, { onDelete: "cascade" }),
    surface: surfaceEnum("surface").notNull(),
    sourceId: text("source_id").notNull(), // Google's own id: fileId / messageId / eventId / spreadsheetId
    title: text("title").notNull(),
    url: text("url"),
    contentHash: text("content_hash").notNull(), // change detection — skip re-embedding unchanged content
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    connectionSourceUnique: uniqueIndex("documents_connection_source_idx").on(
      t.connectionId,
      t.surface,
      t.sourceId
    ),
  })
);

export const chunks = pgTable("chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  // The point id in Qdrant holding this chunk's vector — Postgres never
  // stores the embedding itself, only the pointer + citation metadata.
  qdrantPointId: uuid("qdrant_point_id").notNull().unique(),
  content: text("content").notNull(),
  // e.g. { docHeading }, { sheetTab, range }, { emailSnippetOffset } —
  // whatever a given surface needs to render a precise, clickable citation.
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roleEnum = pgEnum("role", ["user", "assistant"]);

export const chatSessions = pgTable("chat_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull(),
  content: text("content").notNull(),
  confidence: real("confidence"), // null for user messages
  refused: boolean("refused").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Per-claim citations (FR-9, FR-13) — an assistant message can cite several
// chunks, each rendered as a distinct, clickable source.
export const citations = pgTable("citations", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id")
    .notNull()
    .references(() => chatMessages.id, { onDelete: "cascade" }),
  chunkId: uuid("chunk_id")
    .notNull()
    .references(() => chunks.id, { onDelete: "cascade" }),
  snippet: text("snippet").notNull(),
});

// Observability (FR-20): every query logged regardless of outcome, so a
// quality regression is visible on the dashboard, not silent.
export const queryLogs = pgTable("query_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").references(() => chatSessions.id, { onDelete: "set null" }),
  query: text("query").notNull(),
  latencyMs: real("latency_ms"),
  refused: boolean("refused").notNull().default(false),
  confidence: real("confidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
