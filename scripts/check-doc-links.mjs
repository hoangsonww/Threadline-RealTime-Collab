#!/usr/bin/env node
// Verifies that every relative link in the repository's markdown resolves — the
// target file exists, and if the link carries an anchor, a heading that
// produces that anchor exists in it.
//
//   node scripts/check-doc-links.mjs
//   node scripts/check-doc-links.mjs --quiet     only report failures
//
// This repository cross-links its documentation heavily and treats an
// undocumented behavior change as an incomplete change, which makes a rotted
// link an actual defect rather than a cosmetic one. External (http) links are
// deliberately *not* fetched: a third-party site being briefly unreachable is
// not a reason to fail a pull request.

import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const QUIET = process.argv.includes("--quiet");

/** Markdown files git knows about, minus generated output. */
const files = execFileSync("git", ["ls-files", "-z", "*.md"], { cwd: REPO_ROOT, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((file) => !file.startsWith("docs/api-reference/"));

/**
 * GitHub's heading-to-anchor transform: lowercase, drop everything that is not
 * a word character, space, or hyphen, then turn spaces into hyphens. Note that
 * a dropped character between two spaces leaves a double hyphen — which is why
 * `## A + B` and `## A B` produce different anchors.
 */
const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s/g, "-");

/** Every anchor a markdown file offers: its headings, plus explicit anchor tags. */
const anchorsIn = (absolute) => {
  const text = readFileSync(absolute, "utf8");
  const anchors = new Set();
  let inFence = false;

  for (const line of text.split("\n")) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const base = slug(heading[2]);
      anchors.add(base);
      // GitHub disambiguates repeated headings with -1, -2, … Accept a few
      // rather than tracking exact occurrence counts.
      for (let i = 1; i <= 5; i += 1) anchors.add(`${base}-${i}`);
    }

    for (const explicit of line.matchAll(/<a\s+(?:[^>]*\s)?(?:name|id)=["']([^"']+)["']/gi)) {
      anchors.add(explicit[1].toLowerCase());
    }
    for (const explicit of line.matchAll(/\{#([^}]+)\}/g)) {
      anchors.add(explicit[1].toLowerCase());
    }
  }

  return anchors;
};

const anchorCache = new Map();
const anchorsFor = (absolute) => {
  if (!anchorCache.has(absolute)) anchorCache.set(absolute, anchorsIn(absolute));
  return anchorCache.get(absolute);
};

/** Extracts inline and reference-style link targets, ignoring fenced code. */
function linksIn(text) {
  const found = [];
  const lines = text.split("\n");
  let inFence = false;

  lines.forEach((line, index) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const withoutCode = line.replace(/`[^`]*`/g, (match) => " ".repeat(match.length));

    for (const match of withoutCode.matchAll(/\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) {
      found.push({ target: match[1], line: index + 1 });
    }
    for (const match of withoutCode.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/g)) {
      found.push({ target: match[1], line: index + 1 });
    }
  });

  return found;
}

const problems = [];
let checked = 0;

for (const file of files) {
  const absolute = join(REPO_ROOT, file);
  const text = readFileSync(absolute, "utf8");

  for (const { target, line } of linksIn(text)) {
    // Skip anything that is not a relative in-repository reference.
    if (/^(?:https?:|mailto:|tel:|data:|#!)/i.test(target)) continue;
    if (target.startsWith("<")) continue;

    checked += 1;

    const [rawPath, rawAnchor] = target.split("#");
    const anchor = rawAnchor ? decodeURIComponent(rawAnchor).toLowerCase() : null;

    // A bare `#anchor` points inside the current file.
    const targetFile = rawPath === "" ? absolute : resolve(dirname(absolute), decodeURIComponent(rawPath));

    if (!existsSync(targetFile)) {
      problems.push({ file, line, target, reason: `target does not exist (${relative(REPO_ROOT, targetFile)})` });
      continue;
    }

    if (!anchor) continue;

    if (statSync(targetFile).isDirectory()) {
      problems.push({ file, line, target, reason: "anchor points at a directory" });
      continue;
    }

    if (!targetFile.endsWith(".md")) continue;

    const available = anchorsFor(targetFile);
    if (!available.has(anchor)) {
      const near = [...available].filter((candidate) => candidate.replace(/-+/g, "-") === anchor.replace(/-+/g, "-"));
      problems.push({
        file,
        line,
        target,
        reason: `no heading in ${relative(REPO_ROOT, targetFile)} produces "#${anchor}"${
          near.length > 0 ? ` — did you mean "#${near[0]}"?` : ""
        }`,
      });
    }
  }
}

if (!QUIET) {
  console.log(`\n  Checked ${checked} relative link(s) across ${files.length} markdown file(s).\n`);
}

if (problems.length === 0) {
  console.log("  ✓ Every relative documentation link resolves.\n");
  process.exit(0);
}

for (const { file, line, target, reason } of problems) {
  console.error(`  ✖ ${file}:${line}`);
  console.error(`      ${target}`);
  console.error(`      ${reason}\n`);
  // Surfaces as an annotation on the pull request diff when run in Actions.
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::error file=${file},line=${line}::${target} — ${reason}`);
  }
}

console.error(`  ${problems.length} broken link(s).\n`);
process.exit(1);
