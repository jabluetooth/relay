// Builds what the npm package ships: dist/app (a self-contained Next.js
// server), dist/migrations (the database schema). Run by `npm run
// build:package`, and automatically before `npm publish`.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const log = (m) => console.log(`\n▸ ${m}`);

function run(cmd, args, env = {}) {
  const r = spawnSync([cmd, ...args].join(" "), { cwd: root, stdio: "inherit", shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
}

// A package built on a machine that has these set would ship the public
// marketing site (product routes disabled) or bake in someone's overrides.
for (const k of ["NEXT_PUBLIC_SITE_ONLY", "VERCEL"]) {
  if (process.env[k]) throw new Error(`${k} is set in this shell. Unset it before building the package.`);
}

const NEXT_DIR = ".next-package"; // must match distDir in next.config.ts
log(`cleaning dist/ and ${NEXT_DIR}/`);
fs.rmSync(dist, { recursive: true, force: true });
fs.rmSync(path.join(root, NEXT_DIR), { recursive: true, force: true });

log("next build (standalone)");
run("npx", ["next", "build"], { RELAY_STANDALONE: "1" });

const standalone = path.join(root, NEXT_DIR, "standalone");
if (!fs.existsSync(path.join(standalone, "server.js"))) throw new Error("standalone server.js was not produced");

log("assembling dist/app");
fs.cpSync(standalone, path.join(dist, "app"), { recursive: true, dereference: true });
fs.cpSync(path.join(root, NEXT_DIR, "static"), path.join(dist, "app", NEXT_DIR, "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public"), path.join(dist, "app", "public"), { recursive: true });
fs.cpSync(path.join(root, "lib", "db", "migrations"), path.join(dist, "migrations"), { recursive: true });

// The standalone folder can carry the developer's own secrets if a .env file
// was next to the project. The package must never contain one.
for (const f of fs.readdirSync(path.join(dist, "app"))) {
  if (f.startsWith(".env")) {
    fs.rmSync(path.join(dist, "app", f), { force: true });
    console.log(`  removed ${f} from the package`);
  }
}

// Source maps only help debugging the developers own build; they add size.
let maps = 0;
const stripMaps = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) stripMaps(p);
    else if (e.name.endsWith(".map")) {
      fs.rmSync(p);
      maps++;
    }
  }
};
stripMaps(path.join(dist, "app", NEXT_DIR));
console.log(`  removed ${maps} source maps`);

const mb = (dir) => {
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else total += fs.statSync(p).size;
    }
  };
  walk(dir);
  return (total / 1024 / 1024).toFixed(1);
};
console.log(`\n✓ dist/ ready (${mb(dist)} MB unpacked)`);
