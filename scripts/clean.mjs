#!/usr/bin/env node
// Removes build output and caches. Defaults to the artefacts that are cheap to
// regenerate; `--all` additionally removes `node_modules`, which is not.
//
//   npm run clean              build output, caches, generated docs
//   npm run clean:all          the above, plus every node_modules
//   node scripts/clean.mjs --dry-run
//
// Deliberately explicit about what it deletes: it prints the full list and the
// reclaimed size, and it will not touch anything outside the repository root.

import { rmSync, statSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const argv = new Set(process.argv.slice(2));
const ALL = argv.has("--all");
const DRY_RUN = argv.has("--dry-run") || argv.has("-n");

if (argv.has("--help") || argv.has("-h")) {
  console.log(`
  Usage: node scripts/clean.mjs [--all] [--dry-run]

    --all        also remove node_modules (requires a reinstall afterwards)
    --dry-run    list what would be removed without removing it
`);
  process.exit(0);
}

/** Directories searched for per-workspace artefacts. */
const WORKSPACES = ["apps/api", "apps/realtime", "apps/web"];

/** Everything safe to delete, with why it exists so the list stays auditable. */
const TARGETS = [
  { path: "docs/api-reference", why: "generated TypeDoc output" },
  { path: "coverage", why: "test coverage report" },
  { path: "output/playwright", why: "Playwright artefacts" },
  { path: "test-results", why: "Playwright test results" },
  { path: "playwright-report", why: "Playwright HTML report" },
  { path: "blob-report", why: "Playwright blob report (sharded runs)" },
  { path: ".playwright-cli", why: "Playwright CLI session logs" },
  { path: ".playwright-mcp", why: "Playwright MCP session logs" },
  ...WORKSPACES.flatMap((workspace) => [
    { path: join(workspace, ".next"), why: "Next.js build output" },
    { path: join(workspace, ".wrangler"), why: "Wrangler local state" },
    { path: join(workspace, "dist"), why: "build output" },
    { path: join(workspace, "tsconfig.tsbuildinfo"), why: "TypeScript incremental cache" },
  ]),
];

const NODE_MODULES = [
  { path: "node_modules", why: "installed dependencies" },
  ...WORKSPACES.map((workspace) => ({ path: join(workspace, "node_modules"), why: "installed dependencies" })),
];

/** Recursively sums a path's size. Returns 0 for anything unreadable. */
function sizeOf(path) {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return 0;
  }

  if (!stats.isDirectory()) return stats.size;

  let total = 0;
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    total += entry.isDirectory() ? sizeOf(join(path, entry.name)) : sizeOf(join(path, entry.name));
  }
  return total;
}

const human = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
};

const wanted = ALL ? [...TARGETS, ...NODE_MODULES] : TARGETS;
let reclaimed = 0;
let removed = 0;

console.log(`\n  Cleaning ${REPO_ROOT}${DRY_RUN ? "  (dry run — nothing will be deleted)" : ""}\n`);

for (const { path, why } of wanted) {
  const absolute = resolve(REPO_ROOT, path);

  // Refuse to escape the repository, whatever the target list says.
  if (absolute !== REPO_ROOT && !absolute.startsWith(REPO_ROOT + sep)) {
    console.error(`  ✖ refusing to delete outside the repository: ${absolute}`);
    process.exitCode = 1;
    continue;
  }

  if (!existsSync(absolute)) continue;

  const bytes = sizeOf(absolute);
  reclaimed += bytes;
  removed += 1;

  console.log(
    `  ${DRY_RUN ? "would remove" : "removed"}  ${relative(REPO_ROOT, absolute).padEnd(38)} ${human(bytes).padStart(10)}  ${why}`,
  );

  if (!DRY_RUN) {
    rmSync(absolute, { recursive: true, force: true });
  }
}

if (removed === 0) {
  console.log("  Nothing to clean.\n");
  process.exit(0);
}

console.log(`\n  ${DRY_RUN ? "Would reclaim" : "Reclaimed"} ${human(reclaimed)} across ${removed} path(s).\n`);

if (ALL && !DRY_RUN) {
  console.log("  node_modules is gone — run `npm ci` before anything else.\n");
}
