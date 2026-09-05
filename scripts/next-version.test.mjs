import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const planner = fileURLToPath(new URL("./next-version.mjs", import.meta.url));
let repo;

const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

/** Commit with a fixed identity so the fixture never depends on local git config. */
const commit = (message) => {
  writeFileSync(join(repo, "file.txt"), `${message}\n${Math.random()}`);
  git("add", "-A");
  execFileSync("git", ["commit", "-m", message], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  });
};

const plan = () =>
  JSON.parse(
    execFileSync("node", [planner, "--json"], {
      cwd: repo,
      encoding: "utf8",
      // Cleared so the fixture's notes never depend on the real repository slug.
      env: { ...process.env, GITHUB_REPOSITORY: "" },
    }),
  );

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "threadline-release-"));
  git("init", "--initial-branch=main");
  commit("chore: seed");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("release planner", () => {
  it("does not cut a release for commits that ship no behavior change", () => {
    git("tag", "v1.4.2");
    commit("docs: rewrite the glossary");
    commit("chore(dx): tidy a script");
    commit("style: reformat");

    const result = plan();
    expect(result.shouldRelease).toBe(false);
    expect(result.bump).toBe("none");
    // A version is still computed, but nothing is expected to use it.
    expect(result.releasableCount).toBe(0);
  });

  it("takes the highest bump present, not the most recent one", () => {
    git("tag", "v1.4.2");
    commit("feat(api): add an endpoint");
    commit("fix(web): correct a label");

    // A patch commit landing after a feature must not downgrade the release.
    expect(plan()).toMatchObject({ shouldRelease: true, bump: "minor", tag: "v1.5.0" });
  });

  it("treats both breaking-change spellings as major", () => {
    git("tag", "v1.4.2");
    commit("feat(api)!: drop the legacy field");
    expect(plan()).toMatchObject({ bump: "major", tag: "v2.0.0" });

    git("tag", "v2.0.0");
    commit("refactor(api): rename a module\n\nBREAKING CHANGE: the export moved.");
    // `refactor` earns nothing on its own; the footer is what makes it major.
    expect(plan()).toMatchObject({ bump: "major", tag: "v3.0.0" });
  });

  it("bumps patch for fixes and performance work", () => {
    git("tag", "v1.4.2");
    commit("perf(api): bound a query");
    expect(plan()).toMatchObject({ bump: "patch", tag: "v1.4.3" });
  });

  it("picks the highest version tag rather than the most recently created one", () => {
    // A patch tag cut after a later minor — re-tagging and out-of-order releases
    // both produce this, and choosing by date would compute from the wrong base.
    commit("feat: one");
    git("tag", "v2.3.0");
    commit("fix: two");
    git("tag", "v1.9.9");
    commit("fix(api): three");

    expect(plan()).toMatchObject({ previousTag: "v2.3.0", tag: "v2.3.1" });
  });

  it("ignores pre-release and non-semver tags when choosing the base", () => {
    git("tag", "v1.4.2");
    git("tag", "v1.5.0-rc.1");
    git("tag", "nightly");
    commit("fix: something");

    expect(plan()).toMatchObject({ previousTag: "v1.4.2", tag: "v1.4.3" });
  });

  it("summarises an unparseable commit instead of failing the release", () => {
    git("tag", "v1.4.2");
    commit("feat: a real feature");
    commit("WIP merged through with --no-verify");

    const result = plan();
    expect(result.shouldRelease).toBe(true);
    expect(result.notes).toContain("### Other");
    expect(result.notes).toContain("WIP merged through");
  });

  it("groups notes by type and marks the scope", () => {
    git("tag", "v1.4.2");
    commit("feat(realtime): add a message type");
    commit("fix: correct a typo");

    const { notes } = plan();
    expect(notes).toContain("### ✨ Features");
    expect(notes).toContain("**realtime:** add a message type");
    expect(notes).toContain("### 🐛 Fixes");
    expect(notes.indexOf("### ✨ Features")).toBeLessThan(notes.indexOf("### 🐛 Fixes"));
  });

  it("starts from 0.0.0 in a repository that has never been released", () => {
    commit("feat: the first capability");
    expect(plan()).toMatchObject({ previousTag: null, bump: "minor", tag: "v0.1.0" });
  });
});
