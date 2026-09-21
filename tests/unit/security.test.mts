// Run with `npm test`. No network, database or Google account needed.
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { NextRequest } from "next/server";

process.env.RELAY_ENCRYPTION_KEY = "ab".repeat(32);
process.env.RELAY_STATE_SECRET = "s".repeat(40);
delete process.env.NEXT_PUBLIC_SITE_ONLY;

const { proxy } = await import("../../proxy");
const crypto = await import("../../lib/crypto");
const { validateGmailScope } = await import("../../lib/ingest/gmail");
const { escapeLike, isUuid, parseBody } = await import("../../lib/api");
const { z } = await import("zod");

const req = (url: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(url, { method: init.method ?? "GET", headers: init.headers });
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";
const JSON_HDR = { "content-type": "application/json" };

describe("request guard (proxy.ts)", () => {
  it("lets a normal local page load through", () => {
    assert.ok(passes(proxy(req("http://localhost:3000/chat", { headers: { host: "localhost:3000" } }))));
  });
  it("refuses a request addressed to another hostname (DNS rebinding)", () => {
    assert.equal(proxy(req("http://evil.example:3000/api/connections", { headers: { host: "evil.example:3000" } })).status, 421);
  });
  it("accepts 127.0.0.1 and [::1]", () => {
    assert.ok(passes(proxy(req("http://127.0.0.1:3000/", { headers: { host: "127.0.0.1:3000" } }))));
    assert.ok(passes(proxy(req("http://[::1]:3000/", { headers: { host: "[::1]:3000" } }))));
  });
  it("refuses a cross-origin POST", () => {
    const res = proxy(req("http://localhost:3000/api/query", { method: "POST", headers: { host: "localhost:3000", origin: "https://evil.example", ...JSON_HDR } }));
    assert.equal(res.status, 403);
  });
  it("refuses another local app on a different port", () => {
    const res = proxy(req("http://localhost:3000/api/query", { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:5173", ...JSON_HDR } }));
    assert.equal(res.status, 403);
  });
  it('refuses Origin "null" (sandboxed frame)', () => {
    const res = proxy(req("http://localhost:3000/api/query", { method: "POST", headers: { host: "localhost:3000", origin: "null", ...JSON_HDR } }));
    assert.equal(res.status, 403);
  });
  it("refuses a state-changing request that is not JSON (a simple cross-site form post)", () => {
    const res = proxy(req("http://localhost:3000/api/query", { method: "POST", headers: { host: "localhost:3000", "content-type": "text/plain" } }));
    assert.equal(res.status, 415);
  });
  it("accepts a same-origin JSON POST", () => {
    const res = proxy(req("http://localhost:3000/api/query", { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000", ...JSON_HDR } }));
    assert.ok(passes(res));
  });
  it("refuses a cross-site script or embed", () => {
    const res = proxy(req("http://localhost:3000/api/connections", { headers: { host: "localhost:3000", "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" } }));
    assert.equal(res.status, 403);
  });
  it("allows a cross-site top-level navigation (the Google OAuth redirect back)", () => {
    const res = proxy(req("http://localhost:3000/api/auth/google/callback?code=x", { headers: { host: "localhost:3000", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" } }));
    assert.ok(passes(res));
  });
  it("leaves signed job and webhook routes to their own authentication", () => {
    for (const p of ["/api/jobs/gmail-sync", "/api/webhooks/drive"]) {
      const res = proxy(req(`https://tunnel.example${p}`, { method: "POST", headers: { host: "tunnel.example", "content-type": "text/plain" } }));
      assert.ok(passes(res), p);
    }
  });
});

describe("token encryption (lib/crypto.ts)", () => {
  it("round-trips", () => assert.equal(crypto.decryptToken(crypto.encryptToken("refresh-token")), "refresh-token"));
  it("uses a fresh IV every time", () => assert.notEqual(crypto.encryptToken("x"), crypto.encryptToken("x")));
  it("rejects a truncated auth tag", () => {
    const [iv, tag, data] = crypto.encryptToken("secret").split(":");
    const short = Buffer.from(tag, "base64").subarray(0, 8).toString("base64");
    assert.throws(() => crypto.decryptToken([iv, short, data].join(":")));
  });
  it("rejects tampered ciphertext", () => {
    const [iv, tag, data] = crypto.encryptToken("secret").split(":");
    const bytes = Buffer.from(data, "base64");
    bytes[0] ^= 1;
    assert.throws(() => crypto.decryptToken([iv, tag, bytes.toString("base64")].join(":")));
  });
});

describe("OAuth state (lib/crypto.ts)", () => {
  it("round-trips the requested surfaces", () => assert.deepEqual(crypto.verifyState(crypto.signState(["drive", "gmail"])).surfaces, ["drive", "gmail"]));
  it("rejects a tampered payload", () => {
    const [payload, sig] = crypto.signState(["drive"]).split(".");
    const forged = Buffer.from(JSON.stringify({ nonce: "x", surfaces: ["drive", "gmail"], issuedAt: Date.now() })).toString("base64url");
    assert.throws(() => crypto.verifyState(`${forged}.${sig}`), /signature/i);
    assert.ok(payload);
  });
  it("rejects an expired state", () => {
    const state = crypto.signState(["drive"]);
    const real = Date.now;
    Date.now = () => real() + 11 * 60 * 1000;
    try {
      assert.throws(() => crypto.verifyState(state), /expired/i);
    } finally {
      Date.now = real;
    }
  });
  it("refuses to run with a weak state secret", () => {
    const keep = process.env.RELAY_STATE_SECRET;
    process.env.RELAY_STATE_SECRET = "short";
    try {
      assert.throws(() => crypto.signState(["drive"]), /at least 32/);
    } finally {
      process.env.RELAY_STATE_SECRET = keep;
    }
  });
});

describe("constant-time compare", () => {
  it("matches only equal strings, whatever their length", () => {
    assert.ok(crypto.safeEqual("token", "token"));
    assert.ok(!crypto.safeEqual("token", "tokem"));
    assert.ok(!crypto.safeEqual("a", "abc"));
  });
});

describe("input validation", () => {
  it("accepts a real Gmail scope and rejects one that smuggles a search operator", () => {
    assert.deepEqual(validateGmailScope({ after: "2026/01/01", labelId: "Label_12" }), { after: "2026/01/01", before: undefined, labelId: "Label_12" });
    assert.throws(() => validateGmailScope({ after: "2026/01/01 from:boss@example.com" }), /after/);
    assert.throws(() => validateGmailScope({ labelId: "INBOX -label:SPAM" }), /label/);
    assert.throws(() => validateGmailScope({}), /explicit scope/);
  });
  it("escapes LIKE wildcards so a search means the literal text", () => {
    assert.equal(escapeLike("50%_off"), "50\\%\\_off");
  });
  it("recognises UUIDs", () => {
    assert.ok(isUuid("a9cf3be7-2877-485d-ba47-343b8cb78207"));
    assert.ok(!isUuid("not-a-uuid"));
  });
  it("turns malformed JSON into a 400, not an exception", async () => {
    const r = await parseBody(new Request("http://x", { method: "POST", body: "{bad" }), z.object({ a: z.string() }));
    assert.equal(r.error?.status, 400);
  });
  it("turns a wrong-shaped body into a 400", async () => {
    const r = await parseBody(new Request("http://x", { method: "POST", body: JSON.stringify({ a: 1 }) }), z.object({ a: z.string() }));
    assert.equal(r.error?.status, 400);
  });
});

before(() => {});
