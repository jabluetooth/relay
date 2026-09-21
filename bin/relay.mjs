#!/usr/bin/env node
// The `relay` command. Everything runs on this computer: it starts Postgres and
// Qdrant in Docker (bound to 127.0.0.1), creates the database tables, starts
// QStash's local job emulator, and serves the app on http://localhost:3000.
//
//   relay          start Relay (runs setup first if this is a new install)
//   relay setup    (re)enter your Google / Hugging Face / Groq keys
//   relay doctor   check that everything Relay needs is working
//   relay stop     stop Postgres and Qdrant (your data is kept)
//
// Config and secrets live in ~/.relay/.env (or $RELAY_HOME/.env).

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
const HOME = process.env.RELAY_HOME || path.join(os.homedir(), ".relay");
const ENV_FILE = path.join(HOME, ".env");
const APP_DIR = path.join(PKG_ROOT, "dist", "app");
const COMPOSE_FILE = path.join(PKG_ROOT, "docker", "docker-compose.yml");
const MIGRATIONS = path.join(PKG_ROOT, "dist", "migrations");

// Public, documented development credentials for QStash's local emulator. They
// only work against the emulator on this machine, so they are not secrets.
const QSTASH_DEV = {
  token: "eyJVc2VySUQiOiJkZWZhdWx0VXNlciIsIlBhc3N3b3JkIjoiZGVmYXVsdFBhc3N3b3JkIn0=",
  currentSigningKey: "sig_7kYjw48mhY7kAjqNGcy6cr29RJ6r",
  nextSigningKey: "sig_5ZB6DVzB1wjE8S6rZ7eenA8Pdnhs",
};

// ---------- output ----------
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c("1", s);
const dim = (s) => c("2", s);
const green = (s) => c("32", s);
const red = (s) => c("31", s);
const yellow = (s) => c("33", s);
const accent = (s) => c("38;5;173", s);
const ok = (s) => console.log(`${green("✓")} ${s}`);
const warn = (s) => console.log(`${yellow("!")} ${s}`);
const fail = (s) => console.log(`${red("✗")} ${s}`);
const step = (s) => console.log(`\n${accent("▸")} ${bold(s)}`);
const die = (msg, hint) => {
  fail(msg);
  if (hint) console.log(`  ${dim(hint)}`);
  process.exit(1);
};

// ---------- env file ----------
function readEnv() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const out = {};
  for (const raw of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    out[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, "");
  }
  return out;
}

function writeEnv(env) {
  fs.mkdirSync(HOME, { recursive: true });
  const body =
    "# Written by `relay setup`. Holds your secrets: don't share or commit this file.\n" +
    "# RELAY_ENCRYPTION_KEY protects your stored Google tokens. If you lose it you have to reconnect Google.\n" +
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") +
    "\n";
  fs.writeFileSync(ENV_FILE, body, { mode: 0o600 });
  try {
    fs.chmodSync(ENV_FILE, 0o600); // no-op on Windows; the user profile folder is already private there
  } catch {
    /* ignore */
  }
}

const REQUIRED = [
  "RELAY_OWNER_EMAIL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "HF_TOKEN",
  "GROQ_API_KEY",
  "RELAY_ENCRYPTION_KEY",
  "RELAY_STATE_SECRET",
  "POSTGRES_PASSWORD",
  "QDRANT_API_KEY",
];
const missingKeys = (env) => REQUIRED.filter((k) => !env[k]);

const ports = (env) => ({
  app: Number(env.PORT || 3000),
  pg: Number(env.RELAY_PG_PORT || 5433),
  qdrant: Number(env.RELAY_QDRANT_PORT || 6335),
  qstash: Number(env.QSTASH_DEV_PORT || 8080),
});

// Derived values are recomputed on every run so a changed port or password in
// the file always wins over a stale copy.
function withDerived(env) {
  const p = ports(env);
  return {
    ...env,
    PORT: String(p.app),
    RELAY_PG_PORT: String(p.pg),
    RELAY_QDRANT_PORT: String(p.qdrant),
    QSTASH_DEV_PORT: String(p.qstash),
    DATABASE_URL: `postgres://relay:${env.POSTGRES_PASSWORD}@127.0.0.1:${p.pg}/relay`,
    QDRANT_URL: `http://127.0.0.1:${p.qdrant}`,
    APP_BASE_URL: `http://localhost:${p.app}`,
    GOOGLE_REDIRECT_URI: `http://localhost:${p.app}/api/auth/google/callback`,
    QSTASH_DEV: "true",
    QSTASH_URL: `http://127.0.0.1:${p.qstash}`,
    QSTASH_TOKEN: QSTASH_DEV.token,
    QSTASH_CURRENT_SIGNING_KEY: QSTASH_DEV.currentSigningKey,
    QSTASH_NEXT_SIGNING_KEY: QSTASH_DEV.nextSigningKey,
  };
}

// ---------- small helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", shell: false, ...opts });
}

function dockerState() {
  const v = run("docker", ["--version"]);
  if (v.error || v.status !== 0) return "missing";
  const info = run("docker", ["info"], { timeout: 20000 });
  if (info.status !== 0) return "stopped";
  const compose = run("docker", ["compose", "version"]);
  return compose.status === 0 ? "ok" : "no-compose";
}

function requireDocker() {
  const s = dockerState();
  if (s === "ok") return;
  if (s === "missing") die("Docker isn't installed.", "Install Docker Desktop (https://docs.docker.com/get-docker/), start it, then run `relay` again.");
  if (s === "stopped") die("Docker is installed but not running.", "Start Docker Desktop, wait until it says it's running, then run `relay` again.");
  die("Docker Compose v2 is missing.", "Update Docker Desktop, or install the docker compose plugin.");
}

async function httpUp(url, headers) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(2500) });
    return res.status;
  } catch {
    return 0;
  }
}

async function waitFor(label, probe, seconds = 60) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await probe()) return true;
    await sleep(1000);
  }
  fail(`${label} did not become ready within ${seconds}s.`);
  return false;
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

// ---------- key checks (a live call, so a typo is caught now, not at first sync) ----------
async function checkKey(kind, value) {
  const targets = {
    groq: ["https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${value}` }],
    hf: ["https://huggingface.co/api/whoami-v2", { Authorization: `Bearer ${value}` }],
  };
  const [url, headers] = targets[kind];
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (res.status === 401 || res.status === 403) return "rejected";
    return res.ok ? "ok" : "unknown";
  } catch {
    return "unreachable";
  }
}

// ---------- setup ----------
async function setup({ interactive = true } = {}) {
  const existing = readEnv();
  const env = { ...existing };
  const p = ports(env);

  // Secrets are generated once and then kept. Regenerating the encryption key
  // would make every stored Google token unreadable.
  env.RELAY_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString("hex");
  env.RELAY_STATE_SECRET ||= crypto.randomBytes(32).toString("hex");
  env.POSTGRES_PASSWORD ||= crypto.randomBytes(18).toString("hex");
  env.QDRANT_API_KEY ||= crypto.randomBytes(24).toString("base64url");

  const rl = interactive && process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = async (key, envName, prompt, { validate, secret = false } = {}) => {
    const preset = process.env[envName];
    if (preset) {
      env[key] = preset.trim();
      return;
    }
    const current = existing[key];
    if (!rl) {
      if (current) return;
      die(`${key} is missing and there is no terminal to ask in.`, `Run \`relay setup\` in a terminal, or set ${envName}.`);
    }
    for (;;) {
      const shown = current ? ` ${dim(secret ? "(Enter keeps the saved one)" : `(Enter keeps ${current})`)}` : "";
      const answer = (await rl.question(`  ${prompt}${shown}: `)).trim();
      const value = answer || current || "";
      if (!value) {
        warn("This one is required.");
        continue;
      }
      const problem = validate ? await validate(value) : null;
      if (problem) {
        warn(problem);
        continue;
      }
      env[key] = value;
      return;
    }
  };

  console.log(`\n${bold("Relay setup")}  ${dim("(about five minutes, most of it in Google Cloud)")}`);
  console.log(dim(`Your keys are saved to ${ENV_FILE} and never leave this computer, except to the service each one belongs to.`));

  step("1 of 3  Google Cloud");
  const redirect = `http://localhost:${p.app}/api/auth/google/callback`;
  console.log(
    [
      "  Relay reads your Workspace through a Google Cloud project that you own.",
      `  ${dim("a)")} Create a project:            https://console.cloud.google.com/projectcreate`,
      `  ${dim("b)")} Enable these five APIs:     Drive, Docs, Gmail, Calendar, Sheets`,
      `                                  https://console.cloud.google.com/apis/library`,
      `  ${dim("c)")} OAuth consent screen:        User type External, publishing status Testing,`,
      "                                  and add your own Google account under Test users",
      `                                  https://console.cloud.google.com/auth/overview`,
      `  ${dim("d)")} Credentials → Create OAuth client ID → Web application,`,
      `                                  with this Authorized redirect URI:  ${bold(redirect)}`,
      `                                  https://console.cloud.google.com/auth/clients`,
      "",
    ].join("\n"),
  );
  await ask("GOOGLE_CLIENT_ID", "RELAY_GOOGLE_CLIENT_ID", "Client ID", {
    validate: (v) => (v.endsWith(".apps.googleusercontent.com") ? null : "That doesn't look like a Google client ID (it ends in .apps.googleusercontent.com)."),
  });
  await ask("GOOGLE_CLIENT_SECRET", "RELAY_GOOGLE_CLIENT_SECRET", "Client secret", { secret: true });
  await ask("RELAY_OWNER_EMAIL", "RELAY_OWNER_EMAIL", "The Google account you'll connect", {
    validate: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : "That doesn't look like an email address."),
  });

  step("2 of 3  Hugging Face  (turns text into searchable vectors)");
  console.log("  Create a token with Read access: https://huggingface.co/settings/tokens\n");
  await ask("HF_TOKEN", "RELAY_HF_TOKEN", "Hugging Face token", {
    secret: true,
    validate: async (v) => {
      const r = await checkKey("hf", v);
      if (r === "rejected") return "Hugging Face rejected that token. Check that you copied all of it.";
      if (r === "unreachable") warn("Couldn't reach Hugging Face to check it; continuing.");
      return null;
    },
  });

  step("3 of 3  Groq  (writes the answers)");
  console.log("  Create a key: https://console.groq.com/keys\n");
  await ask("GROQ_API_KEY", "RELAY_GROQ_API_KEY", "Groq API key", {
    secret: true,
    validate: async (v) => {
      const r = await checkKey("groq", v);
      if (r === "rejected") return "Groq rejected that key. Check that you copied all of it.";
      if (r === "unreachable") warn("Couldn't reach Groq to check it; continuing.");
      return null;
    },
  });

  rl?.close();
  writeEnv(env);
  console.log();
  ok(`Saved ${ENV_FILE}`);
  ok("Generated your encryption key and database passwords (kept for next time)");
  return env;
}

// ---------- start / stop ----------
function compose(env, ...args) {
  return spawnSync(
    "docker",
    ["compose", "-f", COMPOSE_FILE, "--env-file", ENV_FILE, ...args],
    { stdio: "inherit", env: { ...process.env, RELAY_PROJECT: env.RELAY_PROJECT || "relay" } },
  );
}

async function migrate(env) {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate: run } = await import("drizzle-orm/postgres-js/migrator");
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await run(drizzle(sql), { migrationsFolder: MIGRATIONS });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function postgresReady(env) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

const children = [];
function shutdown(code = 0) {
  for (const ch of children) {
    try {
      ch.kill();
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function ensureQstash(env) {
  const p = ports(env);
  const url = `http://127.0.0.1:${p.qstash}`;
  if (await httpUp(url)) return true;
  // Started here, not by the app: the QStash SDK's own auto-start breaks on Windows.
  // A single command string (no separate args) keeps npx.cmd working on Windows without Node's shell-args warning.
  const ch = spawn(`npx --yes @upstash/qstash-cli@latest dev --port ${Number(p.qstash)}`, { stdio: "ignore", shell: true, windowsHide: true });
  children.push(ch);
  ch.on("error", () => {});
  return waitFor("The QStash job emulator", async () => (await httpUp(url)) > 0, 90);
}

async function registerSchedules(env) {
  const { Client } = await import("@upstash/qstash");
  const p = ports(env);
  const client = new Client({ baseUrl: `http://127.0.0.1:${p.qstash}`, token: QSTASH_DEV.token });
  const schedules = [
    // Gmail has no push notifications, so it is polled.
    { scheduleId: "relay-gmail-poll", destination: `http://localhost:${p.app}/api/jobs/gmail-sync`, cron: "*/5 * * * *" },
    { scheduleId: "relay-watch-renewal", destination: `http://localhost:${p.app}/api/jobs/renew-watch-channels`, cron: "0 */6 * * *" },
  ];
  for (const s of schedules) await client.schedules.create(s);
}

async function start({ open = false } = {}) {
  if (!fs.existsSync(path.join(APP_DIR, "server.js"))) {
    die("This install has no built app.", "If you cloned the repository, run `npm run build:package` first. Installed from npm? Reinstall the package.");
  }
  let env = readEnv();
  if (missingKeys(env).length > 0) {
    if (!process.stdin.isTTY && !process.env.RELAY_GOOGLE_CLIENT_ID) die("Relay isn't set up yet.", "Run `relay setup` in a terminal first.");
    console.log(bold("\nWelcome to Relay."), dim("First run, so a short setup comes first."));
    env = await setup();
  }
  env = withDerived(env);
  const p = ports(env);

  step("Checking Docker");
  requireDocker();
  ok("Docker is running");

  step("Starting Postgres and Qdrant");
  const up = compose(env, "up", "-d");
  if (up.status !== 0) die("Docker couldn't start the databases.", "Is another program using ports " + `${p.pg} or ${p.qdrant}? You can change them with RELAY_PG_PORT / RELAY_QDRANT_PORT in ${ENV_FILE}.`);
  if (!(await waitFor("Postgres", () => postgresReady(env)))) process.exit(1);
  if (!(await waitFor("Qdrant", async () => (await httpUp(`${env.QDRANT_URL}/collections`, { "api-key": env.QDRANT_API_KEY })) === 200))) process.exit(1);
  ok("Postgres and Qdrant are up (localhost only)");

  step("Preparing the database");
  await migrate(env);
  ok("Tables are up to date");

  step("Starting the background job runner");
  if (await ensureQstash(env)) {
    try {
      await registerSchedules(env);
      ok("Gmail polling and channel renewal are scheduled");
    } catch (err) {
      warn(`Couldn't register the recurring jobs (${err.message}). Manual syncs still work.`);
    }
  } else {
    warn("The job runner didn't start, so syncs won't run. Try `npx @upstash/qstash-cli dev` in another terminal.");
  }

  if (!(await portFree(p.app))) {
    die(`Port ${p.app} is already in use.`, `Stop whatever is using it, or set PORT in ${ENV_FILE} (and add the new redirect URI in Google Cloud).`);
  }

  step("Starting Relay");
  const server = spawn(process.execPath, ["server.js"], {
    cwd: APP_DIR,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, ...env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(p.app) },
  });
  children.push(server);
  server.on("exit", (code) => {
    if (code) fail(`The server stopped unexpectedly (code ${code}).`);
    shutdown(code ?? 0);
  });

  if (!(await waitFor("The app", async () => (await httpUp(`http://127.0.0.1:${p.app}/`)) === 200, 60))) shutdown(1);
  const home = `http://localhost:${p.app}`;
  console.log(`\n${green("●")} ${bold("Relay is running")}  ${accent(home + "/connections")}`);
  console.log(dim("  First time? Open Connections and connect your Google account."));
  console.log(dim("  Press Ctrl+C to stop the app. Your databases keep running; `relay stop` stops those too.\n"));
  if (open) openBrowser(`${home}/connections`);
}

function openBrowser(url) {
  const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* the URL is printed anyway */
  }
}

async function stop() {
  const env = withDerived(readEnv());
  if (missingKeys(readEnv()).length > 0) die("Nothing to stop: Relay isn't set up.");
  requireDocker();
  const r = compose(env, "down");
  if (r.status === 0) ok("Postgres and Qdrant stopped. Your data is kept; `relay` starts them again.");
  process.exit(r.status ?? 0);
}

// ---------- doctor ----------
async function doctor() {
  let bad = 0;
  const row = (good, label, hint) => {
    if (good) return ok(label);
    fail(label);
    if (hint) console.log(`  ${dim(hint)}`);
    bad++;
  };
  console.log(bold(`Relay ${pkg.version}  doctor\n`));
  row(Number(process.versions.node.split(".")[0]) >= 20, `Node.js ${process.versions.node}`, "Relay needs Node 20.9 or newer.");
  const d = dockerState();
  row(d === "ok", "Docker running", d === "missing" ? "Install Docker Desktop." : d === "stopped" ? "Start Docker Desktop." : "Update Docker Desktop for Compose v2.");

  const raw = readEnv();
  const miss = missingKeys(raw);
  row(fs.existsSync(ENV_FILE) && miss.length === 0, `Config at ${ENV_FILE}`, miss.length ? `Missing: ${miss.join(", ")}. Run \`relay setup\`.` : "Run `relay setup`.");
  row(fs.existsSync(path.join(APP_DIR, "server.js")), "Built app present", "Reinstall the package, or run `npm run build:package` in the repository.");

  if (miss.length === 0 && d === "ok") {
    const env = withDerived(raw);
    const p = ports(env);
    row(await postgresReady(env), `Postgres on 127.0.0.1:${p.pg}`, "Run `relay` to start it.");
    row((await httpUp(`${env.QDRANT_URL}/collections`, { "api-key": env.QDRANT_API_KEY })) === 200, `Qdrant on 127.0.0.1:${p.qdrant}`, "Run `relay` to start it.");
    row((await httpUp(`http://127.0.0.1:${p.qstash}`)) > 0, `Job runner on 127.0.0.1:${p.qstash}`, "Started by `relay`. Needs internet the first time to download it.");
    row((await httpUp(`http://127.0.0.1:${p.app}/`)) === 200, `Relay on http://localhost:${p.app}`, "Not running. Start it with `relay`.");
    const hf = await checkKey("hf", env.HF_TOKEN);
    row(hf === "ok" || hf === "unknown", "Hugging Face token accepted", hf === "rejected" ? "Rejected. Run `relay setup` with a new token." : "Couldn't reach Hugging Face.");
    const gq = await checkKey("groq", env.GROQ_API_KEY);
    row(gq === "ok" || gq === "unknown", "Groq key accepted", gq === "rejected" ? "Rejected. Run `relay setup` with a new key." : "Couldn't reach Groq.");
  }
  console.log(bad ? `\n${red(`${bad} problem${bad > 1 ? "s" : ""} found.`)}` : `\n${green("All good.")}`);
  process.exit(bad ? 1 : 0);
}

// ---------- entry ----------
function help() {
  console.log(`${bold("relay")} ${dim(pkg.version)}  Ask questions of your own Google Workspace. Runs entirely on this computer.

  ${bold("relay")}           start Relay (first run walks you through setup)
  ${bold("relay setup")}     enter or change your Google, Hugging Face and Groq keys
  ${bold("relay doctor")}    check that everything Relay needs is working
  ${bold("relay stop")}      stop Postgres and Qdrant (your data is kept)
  ${bold("relay --open")}    start, then open the app in your browser

  Config: ${ENV_FILE}
  Docs:   ${pkg.homepage}/get-started
`);
}

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith("-")) ?? "start";
try {
  if (args.includes("--version") || args.includes("-v")) console.log(pkg.version);
  else if (args.includes("--help") || args.includes("-h") || cmd === "help") help();
  else if (cmd === "setup") {
    await setup();
    console.log(`\nNext: run ${bold("relay")} to start.`);
  } else if (cmd === "doctor") await doctor();
  else if (cmd === "stop") await stop();
  else if (cmd === "start") await start({ open: args.includes("--open") });
  else {
    fail(`Unknown command "${cmd}".`);
    help();
    process.exit(1);
  }
} catch (err) {
  die(err?.message || String(err));
}
