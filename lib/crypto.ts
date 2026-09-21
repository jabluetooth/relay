import { randomBytes, createHash, createHmac, createCipheriv, createDecipheriv, timingSafeEqual } from "crypto";

// We hand-roll the OAuth *flow* (PRD §6.3) but we don't hand-roll crypto
// primitives — AES-GCM/SHA-256/HMAC come from Node's own `crypto`, same as
// Insight's AES-256-GCM token encryption (see resume-tailor project data).

const ALGO = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const hex = process.env.RELAY_ENCRYPTION_KEY;
  if (!hex) throw new Error("RELAY_ENCRYPTION_KEY is not set — see .env.example");
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error("RELAY_ENCRYPTION_KEY must be a 32-byte value, hex-encoded (64 hex chars)");
  }
  return key;
}

/** Encrypts a refresh token for storage. Format: iv:authTag:ciphertext, all base64. */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // 96-bit nonce, standard for GCM
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptToken(stored: string): string {
  const key = getEncryptionKey();
  const [ivB64, tagB64, dataB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted token");
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

// --- PKCE (RFC 7636), for the hand-rolled authorization-code flow (FR-1) ---

export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

export function generateCodeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// --- Signed OAuth `state` param, for CSRF protection (FR-1) ---
// Format: base64url(payloadJson).base64url(hmacSignature)

interface StatePayload {
  nonce: string;
  surfaces: string[];
  issuedAt: number;
}

function getStateSecret(): string {
  const secret = process.env.RELAY_STATE_SECRET;
  if (!secret) throw new Error("RELAY_STATE_SECRET is not set — see .env.example");
  return secret;
}

export function signState(surfaces: string[]): string {
  const payload: StatePayload = { nonce: randomBytes(16).toString("hex"), surfaces, issuedAt: Date.now() };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const sig = createHmac("sha256", getStateSecret()).update(payloadB64).digest();
  return `${payloadB64}.${base64url(sig)}`;
}

/** Verifies signature and freshness (10 min TTL); throws on any mismatch. */
export function verifyState(state: string): StatePayload {
  const [payloadB64, sigB64] = state.split(".");
  if (!payloadB64 || !sigB64) throw new Error("Malformed state parameter");

  const expectedSig = base64url(createHmac("sha256", getStateSecret()).update(payloadB64).digest());
  const a = Buffer.from(sigB64);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid state signature — possible CSRF attempt");
  }

  const payload: StatePayload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
  if (Date.now() - payload.issuedAt > 10 * 60 * 1000) {
    throw new Error("State parameter expired");
  }
  return payload;
}
