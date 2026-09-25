// API routes and the access-token cache, with Postgres, QStash, the RAG
// pipeline and Google's token endpoint mocked.
import assert from "node:assert/strict";
import { describe, it, mock, beforeEach } from "node:test";
import { NextRequest } from "next/server";
import { createFakeDb, mockModule } from "./helpers/fake-db";
import * as schema from "../../lib/db/schema";

process.env.RELAY_ENCRYPTION_KEY = "ab".repeat(32);
process.env.APP_BASE_URL = "https://relay.example";
process.env.RELAY_OWNER_EMAIL = "owner@example.com";

const fake = createFakeDb();
mockModule("lib/db/index.ts", { db: fake.db, schema });

const publishJSON = mock.fn<(msg: { url: string; body: unknown }) => Promise<{ messageId: string }>>(async () => ({ messageId: "msg-1" }));
mockModule("lib/qstash.ts", { qstash: () => ({ publishJSON }), appBaseUrl: () => process.env.APP_BASE_URL! });

let pipelineResult = {
  answer: "Refunds take 30 days [1]",
  refused: false,
  confidence: 0.9,
  citations: [{ chunkId: "chunk-1", title: "Refund policy", url: null, snippet: "Refunds within 30 days" }],
};
const answerQuery = mock.fn<(query: string) => Promise<typeof pipelineResult>>(async () => pipelineResult);
mockModule("lib/rag/pipeline.ts", { answerQuery });

let refreshResponse: () => Promise<{ access_token: string; expires_in: number }> = async () => ({ access_token: "at-1", expires_in: 3600 });
const refreshAccessToken = mock.fn<(refreshToken: string) => ReturnType<typeof refreshResponse>>(async () => refreshResponse());
mockModule("lib/google/oauth.ts", { refreshAccessToken });

const driveWebhook = await import("../../app/api/webhooks/drive/route");
const calendarWebhook = await import("../../app/api/webhooks/calendar/route");
const queryRoute = await import("../../app/api/query/route");
const { getValidAccessToken, invalidateCachedToken } = await import("../../lib/google/tokens");
const { encryptToken } = await import("../../lib/crypto");

beforeEach(() => {
  fake.reset();
  publishJSON.mock.resetCalls();
  answerQuery.mock.resetCalls();
  refreshAccessToken.mock.resetCalls();
});

// --------------------------------------------------------------- webhooks

const webhooks = [
  { name: "Drive", route: driveWebhook, job: "/api/jobs/drive-sync" },
  { name: "Calendar", route: calendarWebhook, job: "/api/jobs/calendar-sync" },
];

const notify = (headers: Record<string, string>) =>
  new NextRequest("https://relay.example/api/webhooks/x", { method: "POST", headers });
const goog = (state = "update", token = "channel-secret") => ({
  "x-goog-channel-id": "chan-1",
  "x-goog-channel-token": token,
  "x-goog-resource-state": state,
});
const channel = { connectionId: "conn-1", channelToken: "channel-secret" };

for (const { name, route, job } of webhooks) {
  describe(`${name} push webhook`, () => {
    it("rejects a notification missing Google's channel headers", async () => {
      assert.equal((await route.POST(notify({}))).status, 400);
      assert.equal(fake.calls.length, 0);
    });

    it("rejects an unknown channel", async () => {
      fake.queue([]);
      assert.equal((await route.POST(notify(goog()))).status, 403);
      assert.equal(publishJSON.mock.callCount(), 0);
    });

    it("rejects a known channel id with the wrong token (a forged notification)", async () => {
      fake.queue([channel]);
      assert.equal((await route.POST(notify(goog("update", "guessed")))).status, 403);
      assert.equal(publishJSON.mock.callCount(), 0);
    });

    it("acknowledges Google's initial 'sync' handshake without queueing work", async () => {
      fake.queue([channel]);
      const res = await route.POST(notify(goog("sync")));
      assert.equal(res.status, 200);
      assert.equal(publishJSON.mock.callCount(), 0);
    });

    it("acknowledges but skips a change when auto-sync was turned off", async () => {
      fake.queue([channel], [{ autoSyncEnabled: false }]);
      const body = await (await route.POST(notify(goog()))).json();
      assert.equal(body.skipped, true);
      assert.equal(publishJSON.mock.callCount(), 0);
    });

    it("queues a background sync job for a verified change", async () => {
      fake.queue([channel], [{ autoSyncEnabled: true }]);
      const res = await route.POST(notify(goog()));
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true, queued: true, messageId: "msg-1" });
      assert.deepEqual(publishJSON.mock.calls[0].arguments[0], {
        url: `https://relay.example${job}`,
        body: { connectionId: "conn-1" },
      });
    });
  });
}

// ------------------------------------------------------------ /api/query

const ask = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/query", () => {
  it("rejects an empty or oversized message", async () => {
    assert.equal((await queryRoute.POST(ask({ message: "" }))).status, 400);
    assert.equal((await queryRoute.POST(ask({ message: "x".repeat(2001) }))).status, 400);
    assert.equal((await queryRoute.POST(ask("{not json"))).status, 400);
    assert.equal(answerQuery.mock.callCount(), 0);
  });

  it("rejects a session id that is not a UUID", async () => {
    assert.equal((await queryRoute.POST(ask({ message: "hi", sessionId: "1 or 1=1" }))).status, 400);
  });

  it("404s an unknown session instead of creating messages under it", async () => {
    fake.queue([]);
    const res = await queryRoute.POST(ask({ message: "hi", sessionId: "a9cf3be7-2877-485d-ba47-343b8cb78207" }));
    assert.equal(res.status, 404);
    assert.equal(fake.callsTo("insert").length, 0);
  });

  it("starts a session, stores both messages, and saves the citations", async () => {
    fake.queue([{ id: "owner-1" }], [{ id: "sess-1" }], [{ id: "msg-assistant" }]);
    const res = await queryRoute.POST(ask({ message: "How long do refunds take?" }));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.sessionId, "sess-1");
    assert.equal(body.answer, "Refunds take 30 days [1]");

    const messages = fake.callsTo("insert", schema.chatMessages).map((c) => c.values as { role: string; content: string });
    assert.deepEqual(messages.map((m) => m.role), ["user", "assistant"]);
    assert.equal(messages[0].content, "How long do refunds take?");

    const [cites] = fake.callsTo("insert", schema.citations).map((c) => c.values as Array<{ messageId: string; chunkId: string }>);
    assert.deepEqual(cites, [{ messageId: "msg-assistant", chunkId: "chunk-1", snippet: "Refunds within 30 days" }]);
  });

  it("stores a refusal without writing any citations", async () => {
    pipelineResult = { answer: "I couldn't find anything", refused: true, confidence: 0.001, citations: [] };
    fake.queue([{ id: "sess-1" }], [{ id: "msg-2" }]);
    const res = await queryRoute.POST(ask({ message: "hi", sessionId: "a9cf3be7-2877-485d-ba47-343b8cb78207" }));
    assert.equal((await res.json()).refused, true);
    assert.equal(fake.callsTo("insert", schema.citations).length, 0);
    const assistant = fake.callsTo("insert", schema.chatMessages)[1].values as { refused: boolean };
    assert.equal(assistant.refused, true);
  });
});

// ------------------------------------------------ lib/google/tokens.ts

describe("access-token cache (lib/google/tokens.ts)", () => {
  const connectionRow = () => [{ id: "conn", encryptedRefreshToken: encryptToken("refresh-xyz") }];

  it("decrypts the stored refresh token and exchanges it", async () => {
    invalidateCachedToken("conn-a");
    fake.queue(connectionRow());
    refreshResponse = async () => ({ access_token: "fresh", expires_in: 3600 });
    assert.equal(await getValidAccessToken("conn-a"), "fresh");
    assert.equal(refreshAccessToken.mock.calls[0].arguments[0], "refresh-xyz");
  });

  it("serves a still-valid token from cache without calling Google", async () => {
    invalidateCachedToken("conn-b");
    fake.queue(connectionRow());
    refreshResponse = async () => ({ access_token: "cached", expires_in: 3600 });
    await getValidAccessToken("conn-b");
    assert.equal(await getValidAccessToken("conn-b"), "cached");
    assert.equal(refreshAccessToken.mock.callCount(), 1);
  });

  it("refreshes a token inside the one-minute safety margin", async () => {
    invalidateCachedToken("conn-c");
    fake.queue(connectionRow(), connectionRow());
    refreshResponse = async () => ({ access_token: "short-lived", expires_in: 30 });
    await getValidAccessToken("conn-c");
    await getValidAccessToken("conn-c");
    assert.equal(refreshAccessToken.mock.callCount(), 2);
  });

  it("single-flights concurrent refreshes into one call to Google", async () => {
    invalidateCachedToken("conn-d");
    fake.queue(connectionRow());
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    refreshResponse = async () => {
      await gate;
      return { access_token: "shared", expires_in: 3600 };
    };
    const all = Promise.all(Array.from({ length: 5 }, () => getValidAccessToken("conn-d")));
    release();
    assert.deepEqual(await all, Array(5).fill("shared"));
    assert.equal(refreshAccessToken.mock.callCount(), 1);
  });

  it("does not cache a failed refresh, so the next call retries", async () => {
    invalidateCachedToken("conn-e");
    fake.queue(connectionRow(), connectionRow());
    refreshResponse = async () => {
      throw new Error("invalid_grant");
    };
    await assert.rejects(getValidAccessToken("conn-e"), /invalid_grant/);
    refreshResponse = async () => ({ access_token: "recovered", expires_in: 3600 });
    assert.equal(await getValidAccessToken("conn-e"), "recovered");
  });

  it("drops a cached token after disconnect", async () => {
    invalidateCachedToken("conn-f");
    fake.queue(connectionRow(), connectionRow());
    refreshResponse = async () => ({ access_token: "t", expires_in: 3600 });
    await getValidAccessToken("conn-f");
    invalidateCachedToken("conn-f");
    await getValidAccessToken("conn-f");
    assert.equal(refreshAccessToken.mock.callCount(), 2);
  });

  it("fails clearly for a connection that does not exist", async () => {
    invalidateCachedToken("ghost");
    fake.queue([]);
    await assert.rejects(getValidAccessToken("ghost"), /No google_connections row/);
  });
});
