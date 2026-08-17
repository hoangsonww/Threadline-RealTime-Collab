# scripts/

Repository tooling. Every script here is **dependency-free** — plain Node ESM or bash, no imports beyond the standard library.

That constraint is deliberate and non-negotiable: `verify-commit-message.mjs` and `guard-staged.mjs` run from git hooks, and a hook that needs `npm install` to have completed successfully is a hook that fails at the worst possible moment. The rest follow the same rule so that `scripts/` never becomes a place where adding a dependency is the path of least resistance.

## Table of contents

- [What is here](#what-is-here)
- [Git hooks](#git-hooks)
- [How to run them](#how-to-run-them)
- [Conventions for adding one](#conventions-for-adding-one)

## What is here

| Script | Run it with | What it does |
| --- | --- | --- |
| `bootstrap.sh` | `make setup` | Fresh clone → running environment. Checks the toolchain, installs dependencies, wires hooks, seeds local env files, verifies with a typecheck. Idempotent; never overwrites an existing env file. |
| `check.sh` | `make check` | The full merge gate — format, lint, typecheck, test, build. Runs **every** step even after a failure, then prints a summary, so "your formatting is wrong" never hides "your tests are broken". `--fix`, `--fast`, `--with-docs`. |
| `doctor.mjs` | `npm run doctor` | Diagnoses the environment: Node against `engines`, dependency consistency, git hooks, env files, tracked-but-ignored files, and the four development ports. Reports the remedy for each failure, not just the failure. |
| `clean.mjs` | `npm run clean` | Removes build output and caches, printing exactly what it deletes and how much it reclaimed. `--all` also removes `node_modules`; `--dry-run` shows without deleting. Refuses to touch anything outside the repository root. |
| `verify-commit-message.mjs` | `make verify-commit MSG="…"` | Validates a commit message or pull request title against this repository's conventional-commit convention. Used by `.husky/commit-msg` **and** by the PR Hygiene workflow, so local and CI enforcement cannot drift. |
| `guard-staged.mjs` | `npm run verify:staged` | Pre-commit guard for what ESLint and Prettier structurally cannot catch: committed secrets, forbidden paths, merge conflict markers, `debugger`, and focused tests. |
| `check-doc-links.mjs` | `npm run docs:links` | Verifies every relative markdown link resolves — the file exists, and its anchor is actually produced by a heading. External URLs are deliberately not fetched. |
| `lint-shell.mjs` | `npm run lint:shell` | `bash -n` on every shell script, plus `shellcheck` when it is installed. Its absence is reported, never fatal. |
| `serve-docs.mjs` | `npm run docs:serve` | Serves the generated TypeDoc reference on `:8080`. A server rather than `file://` because TypeDoc's search index is fetched over XHR, which `file://` origins cannot do — the search box silently does nothing when the site is opened from disk. |
| `lib/common.sh` | *(sourced)* | Shared bash helpers: strict mode, repository root resolution, colour that disables itself when not attached to a terminal, timed step runner, and a `confirm` that refuses to assume an answer without a TTY. |

`apps/api/scripts/` holds scripts that need the API's own dependencies and run through `tsx` — `emit-openapi.ts`, `generate-oidc-key.ts`, `dedupe-usernames.ts`. Those are workspace scripts, not repository tooling, which is why they live there rather than here.

## Git hooks

Three hooks, deliberately tiered by cost:

| Hook | Runs | Why there |
| --- | --- | --- |
| `pre-commit` | `lint-staged` + `guard-staged.mjs` | Fast. A slow pre-commit hook trains people to use `--no-verify`, and a hook that is routinely bypassed protects nothing. |
| `commit-msg` | `verify-commit-message.mjs` | Instant, and the only moment the message can still be fixed cheaply. |
| `pre-push` | `typecheck` + `test` | Too slow for every commit, but cheaper to fail here than in CI five minutes after you have moved on. Skip deliberately with `THREADLINE_SKIP_PREPUSH=1 git push`. |

Every hook can be bypassed with `--no-verify`. That is intentional — they are a safety net, not a cage — but a bypass belongs in the pull request description.

## How to run them

Prefer `make`, which is discoverable:

```bash
make help          # every target, grouped, with descriptions
make setup         # bootstrap.sh
make check         # check.sh
make doctor        # doctor.mjs
make clean         # clean.mjs
```

Or npm, which is what `make` and CI both call underneath:

```bash
npm run check
npm run doctor
npm run docs:links
npm run verify:staged
```

Or directly, which is useful when you want flags:

```bash
./scripts/check.sh --fix --with-docs
node scripts/clean.mjs --all --dry-run
node scripts/verify-commit-message.mjs --message "feat(api): add room export"
```

## Conventions for adding one

- **No dependencies.** Node standard library or bash. If a script seems to need a package, it probably belongs in a workspace under `apps/*/scripts/` instead.
- **Bash scripts source `lib/common.sh`** and get strict mode, `REPO_ROOT`, and the output helpers from it.
- **Node scripts are `.mjs`** and resolve `REPO_ROOT` from `import.meta.url` rather than trusting the working directory.
- **Say what to do about it.** A check that reports a problem without its remedy has done half the work — `doctor.mjs` is the model.
- **Nothing destructive without confirmation.** `confirm()` in `lib/common.sh` refuses to assume an answer when there is no terminal; override explicitly with `ASSUME_YES=1`.
- **Colour only for humans.** `lib/common.sh` disables it when stdout is not a TTY, when `NO_COLOR` is set, and when `TERM` is `dumb`.
- **Run `npm run lint:shell`** after touching a shell script. ESLint only covers `apps/`, so nothing else lints these.
