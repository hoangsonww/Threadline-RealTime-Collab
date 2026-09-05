#!/usr/bin/env node
// Decides whether the commits since the last release warrant a new one, and if
// so, what to call it and what to say about it.
//
// This repository already enforces conventional commits at the hook and in CI
// (scripts/verify-commit-message.mjs), which means the release notes and the
// version bump are already implied by the history — they just have to be read
// out of it. That is all this script does: no state, no service, no dependency.
//
// Deliberately dependency-free, like every other script here. A release that
// cannot be computed on a laptop without `npm install` is a release nobody can
// check before it ships.
//
// Usage:
//   node scripts/next-version.mjs              # human-readable plan
//   node scripts/next-version.mjs --json       # machine-readable, for CI
//   node scripts/next-version.mjs --notes      # just the release notes body
//
// Exit codes: 0 always, unless the repository state is unreadable (2). "No
// release needed" is a normal outcome reported in the payload, not a failure —
// CI has to distinguish "nothing to ship" from "the planner broke".

import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();

/**
 * Which bump each conventional-commit type earns.
 *
 * Only three types can produce a release on their own. That is deliberate: a
 * repository that cuts a release for a `docs:` or `chore:` commit trains people
 * to ignore its releases, and the version number stops meaning anything about
 * whether the deployed thing changed. Those commits still *appear* in the notes
 * when they ride along with a releasable change — they just cannot trigger one.
 */
const BUMP_BY_TYPE = { feat: "minor", fix: "patch", perf: "patch", revert: "patch" };

const RANK = { major: 3, minor: 2, patch: 1, none: 0 };

/** How each section of the generated notes is titled, in the order they appear. */
const SECTIONS = [
  ["breaking", "⚠️ Breaking changes"],
  ["feat", "✨ Features"],
  ["fix", "🐛 Fixes"],
  ["perf", "⚡ Performance"],
  ["revert", "⏪ Reverts"],
  ["refactor", "♻️ Refactoring"],
  ["docs", "📖 Documentation"],
  ["test", "🧪 Tests"],
  ["build", "📦 Build & dependencies"],
  ["ci", "🤖 CI"],
  ["style", "🎨 Style"],
  ["chore", "🧹 Chores"],
];

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<subject>.+)$/;

/**
 * The most recent release tag, or undefined for a repository that has never cut
 * one.
 *
 * Sorted by version rather than by tag date on purpose: a tag can be re-pointed
 * or created out of order, and picking "newest timestamp" would then silently
 * compute the next version from the wrong base.
 */
function lastReleaseTag() {
  const tags = git("tag", "--list", "v[0-9]*.[0-9]*.[0-9]*", "--sort=-v:refname")
    .split("\n")
    .filter(Boolean)
    // Reject pre-release and build-metadata tags; this project ships plain semver.
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  return tags[0];
}

function parseVersion(tag) {
  const [major, minor, patch] = tag.replace(/^v/, "").split(".").map(Number);
  return { major, minor, patch };
}

/** Commits reachable from HEAD but not from the last release, oldest first. */
function commitsSince(tag) {
  // ASCII unit/record separators rather than NUL. NUL looks like the safe choice
  // but a commit with an empty body emits two adjacent NULs of its own, which
  // then merge with the record terminator and shift every subsequent field by
  // one — the parser silently saw only the first commit. 0x1f/0x1e cannot appear
  // in a commit message and cannot collide with an empty field.
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const raw = git("log", range, "--no-merges", "--reverse", "--format=%H%x1f%s%x1f%b%x1e");
  return raw
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, subject, body = ""] = entry.split("\x1f");
      return { sha, subject, body };
    });
}

/**
 * Classify one commit.
 *
 * A commit that does not parse as a conventional commit is not an error here.
 * The hook rejects those at authoring time, but history predating the hook (or
 * a merge that slipped through with `--no-verify`) still has to be summarised
 * rather than crash the release.
 */
function classify({ sha, subject, body }) {
  const match = HEADER.exec(subject);
  if (!match?.groups) return { sha, subject, type: "other", scope: undefined, breaking: false, bump: "none" };
  const { type, scope, subject: text } = match.groups;
  // Both spellings are the conventional-commit standard: a `!` after the scope,
  // or a `BREAKING CHANGE:` footer. Accept either, because contributors use both.
  const breaking = Boolean(match.groups.breaking) || /^BREAKING[ -]CHANGE:/m.test(body);
  return {
    sha,
    subject: text,
    type,
    scope,
    breaking,
    bump: breaking ? "major" : (BUMP_BY_TYPE[type] ?? "none"),
  };
}

function nextVersion(current, bump) {
  const { major, minor, patch } = current;
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function renderNotes(commits, { tag, version, repository }) {
  const link = (sha) =>
    repository
      ? `([\`${sha.slice(0, 7)}\`](https://github.com/${repository}/commit/${sha}))`
      : `(\`${sha.slice(0, 7)}\`)`;
  const line = (commit) => `- ${commit.scope ? `**${commit.scope}:** ` : ""}${commit.subject} ${link(commit.sha)}`;

  const lines = [];
  for (const [key, title] of SECTIONS) {
    const matching =
      key === "breaking" ? commits.filter((c) => c.breaking) : commits.filter((c) => c.type === key && !c.breaking);
    if (!matching.length) continue;
    lines.push(`### ${title}`, "", ...matching.map(line), "");
  }

  const uncategorised = commits.filter((c) => c.type === "other");
  if (uncategorised.length) lines.push("### Other", "", ...uncategorised.map(line), "");

  if (repository && tag) {
    lines.push(
      `**Full changelog:** [\`${tag}...v${version}\`](https://github.com/${repository}/compare/${tag}...v${version})`,
    );
  }
  return lines.join("\n").trim();
}

const tag = lastReleaseTag();
const current = tag ? parseVersion(tag) : { major: 0, minor: 0, patch: 0 };
const commits = commitsSince(tag).map(classify);
const bump = commits.reduce((highest, c) => (RANK[c.bump] > RANK[highest] ? c.bump : highest), "none");
const version = nextVersion(current, bump);
const repository = process.env.GITHUB_REPOSITORY;

const plan = {
  shouldRelease: bump !== "none",
  bump,
  previousTag: tag ?? null,
  version,
  tag: `v${version}`,
  commitCount: commits.length,
  releasableCount: commits.filter((c) => c.bump !== "none").length,
  notes: bump === "none" ? "" : renderNotes(commits, { tag, version, repository }),
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(plan, null, 2));
} else if (process.argv.includes("--notes")) {
  console.log(plan.notes);
} else {
  console.log(`\n  Previous release: ${plan.previousTag ?? "none"}`);
  console.log(`  Commits since:    ${plan.commitCount} (${plan.releasableCount} releasable)`);
  console.log(`  Bump:             ${plan.bump}`);
  console.log(
    plan.shouldRelease
      ? `  Next release:     ${plan.tag}\n\n${plan.notes}\n`
      : `  Next release:     none — nothing since ${plan.previousTag ?? "the first commit"} changes shipped behavior\n`,
  );
}
