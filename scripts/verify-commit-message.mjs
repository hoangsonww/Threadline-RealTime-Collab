#!/usr/bin/env node
// Validates a commit message (or a pull request title) against the convention
// this repository actually follows, which `git log` demonstrates more reliably
// than any document: conventional-commit headers, lowercase imperative
// subjects, and a body that explains *why* rather than restating the diff.
//
// Deliberately dependency-free. A commit hook that needs `npm install` to have
// completed successfully is a commit hook that fails at the worst moment.
//
// Usage:
//   node scripts/verify-commit-message.mjs .git/COMMIT_EDITMSG
//   node scripts/verify-commit-message.mjs --message "feat(web): add a thing"
//   echo "docs: fix a link" | node scripts/verify-commit-message.mjs -
//
// Exit codes: 0 accepted (warnings may still be printed), 1 rejected,
// 2 the script itself was misused.

import { readFileSync } from "node:fs";

/** Conventional-commit types, with what each one is for in this repository. */
const TYPES = {
  feat: "a capability that did not exist before",
  fix: "a defect in behavior that was supposed to work",
  perf: "a measured latency, throughput, or resource improvement",
  refactor: "restructuring that preserves behavior",
  docs: "documentation only, including ADRs",
  test: "test coverage or test infrastructure",
  build: "the toolchain, dependencies, Dockerfiles, or manifests",
  ci: "GitHub Actions workflows and repository automation",
  style: "formatting with no semantic effect",
  chore: "housekeeping that fits none of the above",
  revert: "reverting a previous commit",
};

/**
 * Scopes that map to a real boundary in this repository. Anything else is
 * warned about rather than rejected — an unfamiliar scope is more often a new
 * area than a mistake, and a hook that blocks on vocabulary is a hook people
 * learn to bypass.
 */
const KNOWN_SCOPES = new Set([
  "api",
  "realtime",
  "web",
  "infra",
  "docker",
  "k8s",
  "ci",
  "build",
  "deps",
  "docs",
  "security",
  "seo",
  "dx",
  "agents",
  "test",
  "release",
]);

/**
 * Past-tense and gerund openers that indicate a non-imperative subject, mapped
 * to the imperative form. `git log` reads as a list of instructions to the
 * codebase; "Fixed the leak" breaks that reading.
 */
const NON_IMPERATIVE = {
  added: "add",
  adding: "add",
  adds: "add",
  fixed: "fix",
  fixing: "fix",
  fixes: "fix",
  updated: "update",
  updating: "update",
  updates: "update",
  removed: "remove",
  removing: "remove",
  removes: "remove",
  changed: "change",
  changing: "change",
  changes: "change",
  created: "create",
  creating: "create",
  creates: "create",
  implemented: "implement",
  implementing: "implement",
  implements: "implement",
  refactored: "refactor",
  refactoring: "refactor",
  moved: "move",
  moving: "move",
  renamed: "rename",
  renaming: "rename",
  deleted: "delete",
  deleting: "delete",
  bumped: "bump",
  bumping: "bump",
  improved: "improve",
  improving: "improve",
  made: "make",
  making: "make",
};

/** Headers matching any of these are structural and skip subject validation. */
const EXEMPT = [
  /^Merge branch /,
  /^Merge remote-tracking branch /,
  /^Merge pull request #\d+ /,
  /^Merge tag /,
  /^Revert "/,
  /^fixup! /,
  /^squash! /,
  /^amend! /,
  /^Initial commit$/,
];

const SOFT_HEADER_LIMIT = 72;
const HARD_HEADER_LIMIT = 100;
const BODY_LINE_LIMIT = 100;

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9][a-z0-9-]*)\))?(?<breaking>!)?: (?<subject>.+)$/;

const problems = [];
const warnings = [];

const fail = (message, hint) => problems.push({ message, hint });
const warn = (message, hint) => warnings.push({ message, hint });

/** Reads the message from a file path, an inline `--message`, or stdin. */
function readMessage(argv) {
  const inlineIndex = argv.findIndex((arg) => arg === "--message" || arg === "-m");
  if (inlineIndex !== -1) {
    const value = argv[inlineIndex + 1];
    if (value === undefined) {
      console.error("verify-commit-message: --message requires a value");
      process.exit(2);
    }
    return value;
  }

  const source = argv.find((arg) => !arg.startsWith("-")) ?? "-";
  if (source === "-") {
    try {
      return readFileSync(0, "utf8");
    } catch {
      console.error("verify-commit-message: no message on stdin");
      process.exit(2);
    }
  }

  try {
    return readFileSync(source, "utf8");
  } catch (error) {
    console.error(`verify-commit-message: cannot read ${source} — ${error.message}`);
    process.exit(2);
  }
}

/**
 * Strips comment lines, the `git commit --verbose` diff, and the scissors
 * section, leaving only what the author actually wrote.
 */
function stripGitNoise(raw) {
  const scissors = raw.indexOf("\n# ------------------------ >8 ------------------------");
  const withoutScissors = scissors === -1 ? raw : raw.slice(0, scissors);
  return withoutScissors
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();
}

const message = stripGitNoise(readMessage(process.argv.slice(2)));

if (message.length === 0) {
  console.error("\n  ✖ The commit message is empty.\n");
  process.exit(1);
}

const lines = message.split("\n");
const header = lines[0];

if (EXEMPT.some((pattern) => pattern.test(header))) {
  process.exit(0);
}

// ── Header shape ──────────────────────────────────────────────────────────────
const match = HEADER.exec(header);

if (!match) {
  fail(
    `The header does not match \`type(scope): subject\`.`,
    [
      `  Got:      ${header}`,
      `  Expected: feat(web): make the call shortcuts discoverable`,
      ``,
      `  Types: ${Object.keys(TYPES).join(", ")}`,
      `  The scope is optional; the space after the colon is not.`,
    ].join("\n"),
  );
} else {
  const { type, scope, subject } = match.groups;

  if (!(type in TYPES)) {
    fail(
      `\`${type}\` is not a known commit type.`,
      Object.entries(TYPES)
        .map(([name, purpose]) => `  ${name.padEnd(9)} ${purpose}`)
        .join("\n"),
    );
  }

  if (scope && !KNOWN_SCOPES.has(scope)) {
    warn(
      `\`${scope}\` is not one of this repository's usual scopes.`,
      `  Usual scopes: ${[...KNOWN_SCOPES].join(", ")}\n  Keep it if the area is genuinely new.`,
    );
  }

  if (/^[A-Z]/.test(subject) && !/^[A-Z]{2,}\b/.test(subject)) {
    fail(
      `The subject starts with a capital letter.`,
      `  Got:      ${subject}\n  Expected: ${subject[0].toLowerCase()}${subject.slice(1)}`,
    );
  }

  if (subject.endsWith(".")) {
    fail(`The subject ends with a period.`, `  A header is a label, not a sentence.`);
  }

  const firstWord = subject
    .split(/\s+/)[0]
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (firstWord in NON_IMPERATIVE) {
    fail(
      `The subject is not in the imperative mood.`,
      `  Got:      ${firstWord}\n  Expected: ${NON_IMPERATIVE[firstWord]}\n\n  Read it as "this commit will …" — "${NON_IMPERATIVE[firstWord]} the thing", not "${firstWord} the thing".`,
    );
  }

  if (subject.trim().length < 8) {
    fail(`The subject is too short to say anything.`, `  Describe the change, not the file you touched.`);
  }
}

// ── Header length ─────────────────────────────────────────────────────────────
if (header.length > HARD_HEADER_LIMIT) {
  fail(
    `The header is ${header.length} characters; the limit is ${HARD_HEADER_LIMIT}.`,
    `  Move the detail into the body, which is where the "why" belongs anyway.`,
  );
} else if (header.length > SOFT_HEADER_LIMIT) {
  warn(
    `The header is ${header.length} characters. Under ${SOFT_HEADER_LIMIT} keeps it readable in \`git log --oneline\` and in the GitHub UI.`,
  );
}

// ── Body shape ────────────────────────────────────────────────────────────────
if (lines.length > 1) {
  if (lines[1].trim() !== "") {
    fail(
      `Line 2 must be blank.`,
      `  Git treats the first paragraph as the subject; without the blank line the\n  body is folded into it.`,
    );
  }

  const longBodyLine = lines
    .slice(2)
    .findIndex((line) => line.length > BODY_LINE_LIMIT && !/^\s*[-*]?\s*\S+$/.test(line));
  if (longBodyLine !== -1) {
    warn(
      `Body line ${longBodyLine + 3} is ${lines[longBodyLine + 2].length} characters.`,
      `  Wrap the body at ~72–${BODY_LINE_LIMIT} columns; \`git log\` does not wrap it for you.`,
    );
  }
}

// ── Report ────────────────────────────────────────────────────────────────────
const render = (entries, marker) =>
  entries.map(({ message: text, hint }) => `  ${marker} ${text}${hint ? `\n\n${hint}\n` : ""}`).join("\n");

if (warnings.length > 0) {
  console.error(`\n${render(warnings, "!")}`);
}

if (problems.length > 0) {
  console.error(`\n${render(problems, "✖")}`);
  console.error(`  Commit message rejected.\n`);
  console.error(`  ${header}\n`);
  console.error(`  See CONTRIBUTING.md § Commit messages and branches.`);
  console.error(`  To bypass this check for one commit: git commit --no-verify\n`);
  process.exit(1);
}

process.exit(0);
