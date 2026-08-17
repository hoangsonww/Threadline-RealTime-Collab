#!/usr/bin/env node
// Pre-commit guard for the things `eslint` and `prettier` structurally cannot
// catch: a secret about to enter git history, a file that should never have
// been staged, an unresolved merge conflict, or a debugging aid left behind.
//
// The bar for a *blocking* finding is "this is almost certainly a mistake and
// it is expensive to undo once pushed". Everything softer is a warning. A hook
// that cries wolf is a hook that gets `--no-verify`d by reflex, at which point
// it protects nothing.
//
// Dependency-free by design — see scripts/verify-commit-message.mjs.

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

const MAX_FILE_BYTES = 1024 * 1024; // 1 MiB

/** Paths that must never be committed, whatever they contain. */
const FORBIDDEN_PATHS = [
  { pattern: /(^|\/)\.env(\.|$)/, reason: "environment files hold real secrets", allow: /\.env\.example$/ },
  { pattern: /(^|\/)\.dev\.vars$/, reason: "Wrangler dev secrets", allow: /\.dev\.vars\.example$/ },
  { pattern: /(^|\/)\.DS_Store$/, reason: "macOS Finder metadata" },
  { pattern: /(^|\/)node_modules\//, reason: "installed dependencies" },
  { pattern: /(^|\/)\.vercel\//, reason: "local Vercel link and build output" },
  { pattern: /(^|\/)\.wrangler\//, reason: "local Wrangler state" },
  { pattern: /(^|\/)\.next\//, reason: "Next.js build output" },
  { pattern: /(^|\/)\.playwright-cli\//, reason: "Playwright session logs" },
  { pattern: /\.tsbuildinfo$/, reason: "TypeScript incremental build cache" },
  {
    pattern: /infra\/kubernetes\/overlays\/[^/]+\/secrets.*\.ya?ml$/,
    reason: "Kubernetes secret overlays are gitignored for a reason",
  },
];

/**
 * High-confidence secret shapes. Each has to be specific enough that a match is
 * a finding rather than a coin flip.
 */
const SECRET_PATTERNS = [
  { name: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/ },
  { name: "AWS access key id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Stripe secret key", pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/ },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "OpenAI-style key", pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: "Anthropic key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: "Sentry DSN with a secret", pattern: /https:\/\/[0-9a-f]{32}:[0-9a-f]{32}@/ },
  { name: "MongoDB URI with credentials", pattern: /mongodb(?:\+srv)?:\/\/[^\s:/@]+:[^\s:/@]+@/ },
  {
    name: "assigned secret literal",
    // A secret-ish identifier assigned a long opaque literal. The placeholder
    // allowlist below is what keeps compose.yaml's `change-me` values quiet.
    pattern:
      /\b(?:secret|token|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["'`]([^"'`\n]{16,})["'`]/i,
    capture: 1,
  },
];

/** Values that look like secrets but are documentation, defaults, or fixtures. */
const PLACEHOLDER =
  /change[-_ ]?me|example|placeholder|your[-_]|redacted|dummy|sample|fixture|\.\.\.|^<.*>$|^\$\{|xxx+|^(?:development|dev|local|test|testing|fake|mock)[-_]/i;

/** Extensions worth scanning line-by-line. Everything else is treated as opaque. */
const TEXTUAL =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|md|env|sh|bash|zsh|css|html|txt|Dockerfile|example|vars)$|(?:^|\/)(?:Dockerfile|Makefile)$/;

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const staged = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").split("\0").filter(Boolean);

if (staged.length === 0) {
  process.exit(0);
}

const errors = [];
const warnings = [];

for (const path of staged) {
  // ── Paths that should never be staged ──────────────────────────────────────
  for (const { pattern, reason, allow } of FORBIDDEN_PATHS) {
    if (pattern.test(path) && !(allow && allow.test(path))) {
      errors.push({
        path,
        detail: `must not be committed — ${reason}`,
        remedy: `git restore --staged "${path}"`,
      });
    }
  }

  // ── Oversized files ────────────────────────────────────────────────────────
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    continue; // Staged as a rename or deleted from the worktree since.
  }

  if (size > MAX_FILE_BYTES && !/^apps\/web\/public\//.test(path)) {
    warnings.push({
      path,
      detail: `is ${(size / 1024 / 1024).toFixed(1)} MiB — git keeps every version of it forever`,
      remedy: `Confirm this belongs in the repository rather than in a release artifact.`,
    });
  }

  if (!TEXTUAL.test(path)) {
    continue;
  }

  // ── Content checks, against the staged blob rather than the worktree ───────
  let content;
  try {
    content = git("show", `:${path}`);
  } catch {
    continue;
  }

  if (/^<{7} |^={7}$|^>{7} /m.test(content)) {
    errors.push({
      path,
      detail: "contains unresolved merge conflict markers",
      remedy: "Resolve the conflict, then re-stage the file.",
    });
  }

  for (const { name, pattern, capture } of SECRET_PATTERNS) {
    const match = pattern.exec(content);
    if (!match) continue;

    const value = capture ? match[capture] : match[0];
    if (PLACEHOLDER.test(value)) continue;

    const line = content.slice(0, match.index).split("\n").length;
    errors.push({
      path: `${path}:${line}`,
      detail: `looks like a committed secret (${name})`,
      remedy: `Move it to an environment variable and record it in docs/security.md § Secrets inventory.\n      If this is a false positive, commit with --no-verify and say so in the PR.`,
    });
  }

  // ── Debugging leftovers ────────────────────────────────────────────────────
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path)) {
    if (/^\s*debugger\s*;?\s*$/m.test(content)) {
      errors.push({ path, detail: "contains a `debugger` statement", remedy: "Remove it before committing." });
    }

    if (/\b(?:describe|it|test)\.only\s*\(/.test(content)) {
      errors.push({
        path,
        detail: "contains a focused test (`.only`) — the rest of the suite will silently not run",
        remedy: "Drop the `.only` before committing.",
      });
    }

    if (/\bit\.skip\s*\(|\bdescribe\.skip\s*\(/.test(content)) {
      warnings.push({
        path,
        detail: "contains a skipped test",
        remedy: "A skipped test with no comment explaining why reads as an accident.",
      });
    }
  }
}

const render = (entries, marker) =>
  entries
    .map(({ path, detail, remedy }) => `  ${marker} ${path}\n      ${detail}\n      ${remedy ?? ""}`.trimEnd())
    .join("\n\n");

if (warnings.length > 0) {
  console.error(`\n  Warnings (not blocking):\n\n${render(warnings, "!")}\n`);
}

if (errors.length > 0) {
  console.error(`\n  Commit blocked — ${errors.length} problem${errors.length === 1 ? "" : "s"} in staged files:\n`);
  console.error(`${render(errors, "✖")}\n`);
  console.error(`  To bypass this check for one commit: git commit --no-verify\n`);
  process.exit(1);
}

process.exit(0);
