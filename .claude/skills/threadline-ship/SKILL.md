---
name: threadline-ship
description: Use when preparing a change for review — before committing, before opening a pull request, and before claiming work is complete. Covers the commit convention, the pre-push gate, what the pull request has to contain, and what CI will check.
---

# Shipping a change

## Before you commit

```bash
npm run check      # format, lint, typecheck, test, build
make check         # same, but every step runs even after a failure, with a summary
make check-fix     # fixes formatting and lint first, then runs the gate
```

Run this before committing, not after pushing. The pre-push hook runs typecheck and tests, but the pre-commit hook only runs `lint-staged` plus `scripts/guard-staged.mjs` — passing it is necessary, not sufficient.

`scripts/guard-staged.mjs` blocks: committed secrets, `.env` / `.dev.vars` files, merge conflict markers, `debugger` statements, and focused tests (`.only`). If it fires on a false positive, `git commit --no-verify` works — say so in the pull request rather than leaving it unexplained.

## Commit messages

Conventional commits. Lowercase imperative subject, no trailing period.

```
feat(web): make the call shortcuts discoverable
fix(api): stop leaking Mongo's internal _id through new org responses
perf(api): bound room event history in the database instead of in memory
docs: record the bounded history contract and where its guarantee is asserted
```

- **Types:** `feat fix perf refactor docs test build ci style chore revert`
- **Scopes:** `api realtime web infra docker k8s ci build deps docs security seo dx agents test release`
- **Subject:** imperative — "add", not "added" or "adds". Under 72 characters.
- **Body:** blank line, then *why*. The diff already shows what changed.

Check one without committing:

```bash
node scripts/verify-commit-message.mjs --message "feat(api): add room export endpoint"
make verify-commit MSG="feat(api): add room export endpoint"
```

`.husky/commit-msg` enforces this, and CI re-checks both the pull request title and every commit it introduces — the title matters because a squash merge takes its subject from it.

Prefer a few focused commits over one enormous one, but do not split a single logical change — a fix and its regression test belong together.

## Branches

`type/short-description`: `fix/rate-limit-key`, `feat/room-membership-revoke`, `docs/operations-runbook`.

## The pull request

The template at [`.github/PULL_REQUEST_TEMPLATE.md`](../../../.github/PULL_REQUEST_TEMPLATE.md) is not a formality — CI fails a non-draft pull request whose description is effectively empty.

What it needs:

- **Why**, not what. For a bug fix, describe the symptom *before* the fix, the way the incidents in [`docs/operations.md`](../../../docs/operations.md#incidents) are written up.
- **A test plan** — what you ran, what you observed. Not "tests pass".
- **The trust-boundary checkboxes answered honestly.** A silent "no" and an unconsidered "no" look identical in a diff, which is why they are explicit.
- **The docs you updated.** A behavior change without a doc update is incomplete, not a follow-up.
- **An ADR** if this is an architectural decision — new dependency, new data model relationship, new trust boundary.

## What CI runs

| Workflow | Gates a merge? | What it does |
| --- | --- | --- |
| CI / CD Pipeline | ✅ | preflight → lint/format, typecheck, security audit → tests → build → container and Kubernetes validation |
| PR Hygiene | ✅ | pull request title, every commit message, non-empty description |
| Documentation | ✅ | TypeDoc builds with strict validation; every relative markdown link resolves |
| Labels | — | path labels and a size label |

The container and Kubernetes jobs run on every pull request. `docker compose build` and `npm run k8s:validate` reproduce them locally.

GHCR publishing and Trivy scanning run only on pushes to `main` — they do not gate a pull request.

## Before you say it is done

The standard is in [`AGENTS.md`](../../../AGENTS.md#definition-of-done). The part most often skipped:

> **State what you actually ran and what you observed.**

"The types should be fine" is not verification. If you could not run something — no Docker, no cluster, no browser — name the check you skipped and why, rather than omitting it and letting the omission read as a pass.

## Checklist

- [ ] `npm run check` passes
- [ ] New behavior has a test; new authorization behavior tests the denied path
- [ ] `docs/` updated in the same change
- [ ] ADR written if this is an architectural decision
- [ ] No secret, token, or connection string in the diff
- [ ] Commit messages pass `scripts/verify-commit-message.mjs`
- [ ] Pull request explains *why* and includes a real test plan
- [ ] Trust-boundary checkboxes answered deliberately
- [ ] Reported the commands you ran and their results
