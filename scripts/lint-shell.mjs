#!/usr/bin/env node
// Lints shell scripts, because eslint and prettier do not.
//
//   node scripts/lint-shell.mjs                 every tracked .sh and .husky hook
//   node scripts/lint-shell.mjs scripts/x.sh    specific files (lint-staged uses this form)
//
// Two passes:
//   1. `bash -n` — a parse check. Always available, catches the class of typo
//      that would otherwise only surface when the script runs in CI.
//   2. `shellcheck` — a real linter, if it happens to be installed. Its absence
//      is reported once and is never an error; requiring it would make the
//      pre-commit hook fail on a machine that is otherwise perfectly set up.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const has = (binary) => spawnSync(binary, ["--version"], { stdio: "ignore" }).status === 0;

/** Files given on the command line, or every shell script git knows about. */
function targets() {
  const explicit = process.argv.slice(2).filter((argument) => !argument.startsWith("-"));
  if (explicit.length > 0) return explicit.filter((file) => existsSync(file));

  const tracked = execFileSync("git", ["ls-files", "-z", "*.sh", ".husky/*"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);

  // `.husky/_` is husky's own generated shim directory, not ours to lint.
  return tracked.filter((file) => !file.startsWith(".husky/_/") && existsSync(resolve(REPO_ROOT, file)));
}

const files = targets();

if (files.length === 0) {
  process.exit(0);
}

if (!has("bash")) {
  console.error("  ! bash not found — skipping shell lint entirely.");
  process.exit(0);
}

const shellcheckAvailable = has("shellcheck");
let failures = 0;

for (const file of files) {
  const parse = spawnSync("bash", ["-n", file], { cwd: REPO_ROOT, encoding: "utf8" });
  if (parse.status !== 0) {
    console.error(`\n  ✖ ${file} — syntax error\n`);
    console.error((parse.stderr || "").replace(/^/gm, "      "));
    failures += 1;
    continue;
  }

  if (!shellcheckAvailable) continue;

  const lint = spawnSync("shellcheck", ["--severity=warning", "--color=auto", file], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

  if (lint.status !== 0) {
    console.error(`\n  ✖ ${file} — shellcheck\n`);
    console.error((lint.stdout || lint.stderr || "").replace(/^/gm, "  "));
    failures += 1;
  }
}

if (!shellcheckAvailable) {
  console.error(
    `  ! shellcheck is not installed — ran syntax checks only on ${files.length} file(s).\n` +
      `    brew install shellcheck  (or apt-get install shellcheck) for the real linter.`,
  );
}

if (failures > 0) {
  console.error(`\n  ${failures} shell script(s) failed.\n`);
  process.exit(1);
}

process.exit(0);
