#!/usr/bin/env node
// Diagnoses a development environment before it wastes an hour of your time.
//
//   npm run doctor
//
// Every check reports one of three states and, when it isn't `ok`, exactly what
// to run next. A `warn` is something you can work without; a `fail` is
// something that will break a normal workflow.
//
// Exit code is 1 only if something failed — warnings do not fail the command,
// so this is safe to run in CI as an informational step.

import { execFileSync, execSync } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const results = [];

const record = (name, state, detail, remedy) => results.push({ name, state, detail, remedy });
const ok = (name, detail) => record(name, "ok", detail);
const warn = (name, detail, remedy) => record(name, "warn", detail, remedy);
const fail = (name, detail, remedy) => record(name, "fail", detail, remedy);

const which = (binary) => {
  try {
    return execFileSync(process.platform === "win32" ? "where" : "which", [binary], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

const capture = (command) => {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], cwd: REPO_ROOT }).trim();
  } catch {
    return null;
  }
};

/** Semver-ish comparison good enough for `>=` engine checks. */
const atLeast = (have, want) => {
  const parse = (value) =>
    value
      .replace(/^v/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parse(have), parse(want)];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return true;
};

/** Resolves true if something is already listening on the port. */
const portInUse = (port) =>
  new Promise((done) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    const settle = (value) => {
      socket.destroy();
      done(value);
    };
    socket.setTimeout(400);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

// ── Toolchain ─────────────────────────────────────────────────────────────────
const requiredNode = (pkg.engines?.node ?? ">=20.11").replace(/[^\d.]/g, "");
const nodeVersion = process.versions.node;

if (atLeast(nodeVersion, requiredNode)) {
  ok("Node", `v${nodeVersion} (requires >=${requiredNode})`);
} else {
  fail("Node", `v${nodeVersion} is older than the required >=${requiredNode}`, "Install a newer Node — nvm use 22");
}

const npmVersion = capture("npm -v");
if (npmVersion) {
  ok("npm", `v${npmVersion}`);
} else {
  fail("npm", "not found on PATH", "Reinstall Node, which bundles npm");
}

for (const [binary, purpose, level] of [
  ["git", "version control", "fail"],
  ["docker", "npm run docker:up, and the container CI job", "warn"],
  ["kubectl", "npm run k8s:validate", "warn"],
]) {
  const path = which(binary);
  if (path) {
    ok(binary, path);
  } else if (level === "fail") {
    fail(binary, "not found on PATH", `Install ${binary} — it is required`);
  } else {
    warn(binary, "not found on PATH", `Optional. Needed for: ${purpose}`);
  }
}

// ── Dependencies ──────────────────────────────────────────────────────────────
if (!existsSync(join(REPO_ROOT, "node_modules"))) {
  fail("Dependencies", "node_modules is missing", "npm ci");
} else {
  const outdatedLock = capture("git diff --name-only -- package-lock.json");
  if (outdatedLock) {
    warn(
      "Lockfile",
      "package-lock.json has uncommitted changes",
      "Review the diff — a stray lockfile change is usually accidental",
    );
  } else {
    ok("Lockfile", "clean");
  }

  // `npm ls` exits non-zero when the tree does not satisfy the manifests, which
  // is the cheapest reliable "did someone edit package.json without installing"
  // signal available.
  const treeOk = capture("npm ls --workspaces --all --depth=0 >/dev/null 2>&1 && echo ok");
  if (treeOk === "ok") {
    ok("Dependencies", "installed and consistent with the manifests");
  } else {
    warn("Dependencies", "node_modules does not match package.json", "npm ci");
  }
}

// ── Git hooks ─────────────────────────────────────────────────────────────────
const hooksPath = capture("git config core.hooksPath");
const expectedHooks = ["pre-commit", "commit-msg", "pre-push"];
const missingHooks = expectedHooks.filter((hook) => !existsSync(join(REPO_ROOT, ".husky", hook)));

if (missingHooks.length > 0) {
  fail("Git hooks", `missing: ${missingHooks.join(", ")}`, "npm run prepare");
} else if (hooksPath !== ".husky/_") {
  warn("Git hooks", `core.hooksPath is "${hooksPath ?? "unset"}", expected ".husky/_"`, "npm run prepare");
} else {
  ok("Git hooks", `${expectedHooks.join(", ")} installed`);
}

// ── Local environment files ───────────────────────────────────────────────────
for (const [file, example] of [
  ["apps/web/.env.local", "apps/web/.env.example"],
  ["apps/realtime/.dev.vars", "apps/realtime/.dev.vars.example"],
]) {
  if (existsSync(join(REPO_ROOT, file))) {
    ok(file, "present");
  } else if (existsSync(join(REPO_ROOT, example))) {
    warn(file, "missing", `cp ${example} ${file}`);
  } else {
    warn(file, "missing, and so is its example", "Check docs/deployment.md for what it should contain");
  }
}

// ── Nothing ignored should be tracked ─────────────────────────────────────────
const trackedButIgnored = capture("git ls-files --cached --ignored --exclude-standard");
if (trackedButIgnored) {
  const files = trackedButIgnored.split("\n").filter(Boolean);
  warn(
    "Tracked files",
    `${files.length} tracked file(s) match .gitignore: ${files.slice(0, 3).join(", ")}${files.length > 3 ? " …" : ""}`,
    "git rm --cached <path> for each, then commit",
  );
} else {
  ok("Tracked files", "nothing tracked that .gitignore excludes");
}

// ── Ports ─────────────────────────────────────────────────────────────────────
const ports = [
  [3000, "apps/web"],
  [4000, "apps/api"],
  [8787, "apps/realtime"],
  [27017, "MongoDB"],
  [6379, "Redis"],
];

for (const [port, owner] of ports) {
  // Sequential on purpose: five probes with a 400 ms timeout each is fast
  // enough, and checking them in parallel would report ports as free when the
  // real cause is that the machine is briefly refusing connections under load.
  const busy = await portInUse(port);
  // Redis is optional and nothing in `npm run dev` binds it, so a listener there
  // is a service you already started rather than a conflict to resolve. Reporting
  // it as a warning would train people to ignore this section.
  const optional = port === 6379;
  if (busy && optional) {
    ok(`Port ${port}`, `a ${owner} is listening — the API will use it if REDIS_URL points here`);
  } else if (busy) {
    warn(
      `Port ${port}`,
      `already in use (${owner} expects it)`,
      `lsof -ti:${port} | xargs kill  — or leave it if that is your own stack`,
    );
  } else if (optional) {
    ok(`Port ${port}`, `free — no local ${owner}, so rate limits and session touches use MongoDB`);
  } else {
    ok(`Port ${port}`, `free (${owner})`);
  }
}

// ── Report ────────────────────────────────────────────────────────────────────
const colour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (colour ? `[${code}m${text}[0m` : text);
const MARK = { ok: paint(32, "✓"), warn: paint(33, "!"), fail: paint(31, "✖") };

const width = Math.max(...results.map((result) => result.name.length));

console.log(`\n  ${paint(1, "Threadline — environment check")}\n`);

for (const { name, state, detail, remedy } of results) {
  console.log(`  ${MARK[state]} ${name.padEnd(width)}  ${detail}`);
  if (remedy) console.log(`    ${paint(2, `→ ${remedy}`)}`);
}

const failures = results.filter((result) => result.state === "fail").length;
const warnings = results.filter((result) => result.state === "warn").length;

console.log(`\n  ${results.length - failures - warnings} ok, ${warnings} warning(s), ${failures} failure(s).\n`);

if (failures > 0) {
  console.log(`  ${paint(31, "Fix the failures above before expecting the stack to run.")}\n`);
  process.exit(1);
}

if (warnings > 0) {
  console.log(`  ${paint(33, "Warnings are survivable — each one narrows what you can do locally.")}\n`);
}

process.exit(0);
