// Checks the built package before it is published: it has what a user needs,
// nothing a user shouldn't get, and no secrets. Run by `npm run test:package`
// (build first with `npm run build:package`).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const r = spawnSync("npm pack --dry-run --json", { cwd: root, encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 });
if (r.status !== 0) throw new Error("npm pack failed:\n" + r.stderr);
const info = JSON.parse(r.stdout)[0];
const files = info.files.map((f) => f.path);

const problems = [];
const need = ["bin/relay.mjs", "docker/docker-compose.yml", "dist/app/server.js", "dist/migrations/0000_watery_gorilla_man.sql", "LICENSE", "README.md"];
for (const f of need) if (!files.includes(f)) problems.push(`missing from package: ${f}`);
if (!files.some((f) => f.startsWith("dist/app/.next-package/static/"))) problems.push("missing the built browser assets (dist/app/.next/static)");
if (!files.some((f) => f.includes("standard_fonts/"))) problems.push("missing PDF font files (Drive PDFs would fail to index)");
if (!files.some((f) => /^dist\/migrations\/\d{4}_.*\.sql$/.test(f) && f !== "dist/migrations/0000_watery_gorilla_man.sql")) problems.push("only the first migration is packaged; the schema has grown since");

for (const f of files) {
  if (/(^|\/)\.env/.test(f) && !f.endsWith(".env.example")) problems.push(`environment file in package: ${f}`);
  if (/\.(pem|key|p12)$/.test(f) && !f.includes("node_modules")) problems.push(`key material in package: ${f}`);
  if (f.endsWith(".map")) problems.push(`source map in package: ${f}`);
}

// Look inside the files for anything shaped like a real credential.
const patterns = [/gsk_[A-Za-z0-9]{30,}/, /hf_[A-Za-z0-9]{30,}/, /GOCSPX-[A-Za-z0-9_-]{20,}/, /AIza[0-9A-Za-z_-]{35}/, /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, /sk_live_[A-Za-z0-9]{20,}/];
for (const f of files) {
  if (!/\.(js|mjs|cjs|json|html|txt|yml|yaml|sql|md)$/.test(f)) continue;
  const text = fs.readFileSync(path.join(root, f), "utf8");
  for (const p of patterns) if (p.test(text)) problems.push(`possible credential in ${f} (${p})`);
}

const packedMb = info.size / 1024 / 1024;
if (packedMb > 40) problems.push(`package is ${packedMb.toFixed(1)} MB packed; expected well under 40`);

if (problems.length) {
  console.error("Package check failed:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log(`✓ package ok: ${info.name}@${info.version}, ${packedMb.toFixed(1)} MB packed, ${(info.unpackedSize / 1024 / 1024).toFixed(1)} MB unpacked, ${files.length} files`);
