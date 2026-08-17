---
name: threadline-local-stack
description: Use when running, verifying, or debugging Threadline locally — starting the three services, choosing between in-memory and MongoDB persistence, reproducing a realtime bug, or diagnosing why the stack will not come up. Read before assuming a symptom is a code defect.
---

# Running and debugging the local stack

Three services, three ports. Most "the app is broken" reports resolve to one of the environment conditions below rather than to a code defect, so check here first.

## Start it

```bash
npm run dev            # all three: api :4000, realtime :8787, web :3000
npm run dev:api:local  # api only
npm run dev:realtime:local
npm run dev:web:local

npm run docker:up      # all three as containers, plus MongoDB
make ports             # what is currently holding 3000 / 4000 / 8787 / 27017
npm run doctor         # full environment diagnosis — run this first when something is off
```

`npm run doctor` checks Node against `engines`, dependency consistency, git hooks, local env files, tracked-but-ignored files, and whether the four ports are free. It reports the remedy for each failure rather than only the failure.

## The two persistence modes — this explains most confusion

`npm run dev:api:local` sets `MONGODB_URI=` **empty on purpose**. An empty value makes `apps/api/src/index.ts` select `MemoryRepository` instead of `MongoRepository`.

Consequences, all expected rather than broken:

- **Data does not survive a restart.** Editing an API source file triggers `tsx watch`, which restarts the process, which discards every user, session, and room. This is documented in [`docs/troubleshooting.md`](../../../docs/troubleshooting.md#local-data-users-rooms-sessions-disappears-after-editing-api-code) because it catches everyone once.
- **Indexes are not created.** `MongoRepository.connect()` is where unique indexes and TTLs are declared. A uniqueness bug that only appears against a real database will not reproduce in memory.

For persistence, run `npm run docker:up` (which includes MongoDB), or set `MONGODB_URI` to a running instance. In production the fallback is refused outright — see [`docs/security.md`](../../../docs/security.md#boot-time-validation).

## Reproducing a realtime bug

**One browser tab is not enough.** Fan-out, presence, and signalling bugs are invisible with a single client. Open two sessions — two profiles, or one normal and one private window, since a shared session cookie makes both tabs the same participant.

The realtime tier runs under `wrangler dev --local`, which is a real workerd instance. Behavior there is what production does; behavior under Node is not evidence.

If the Durable Object seems to lose state, check whether the state was in memory rather than in storage. The object hibernates, and in-memory fields do not survive that.

## Ports

| Port | Service |
| --- | --- |
| 3000 | `apps/web` — Next.js |
| 4000 | `apps/api` — Express |
| 8787 | `apps/realtime` — Wrangler |
| 27017 | MongoDB (Docker Compose or dev container only) |
| 8080 | TypeDoc preview (`npm run docs:serve`) |

```bash
make ports        # show holders
make kill-ports   # free 3000, 4000, 8787 — asks first
```

`npm run dev` uses `concurrently --kill-others-on-fail`, so one service failing to bind takes all three down. The error scrolls past quickly; the surviving symptom is "nothing started".

## Environment files

Both are gitignored, and both have a committed example:

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/realtime/.dev.vars.example apps/realtime/.dev.vars
```

`scripts/bootstrap.sh` and the dev container's `post-create.sh` both seed these automatically and never overwrite an existing one.

Nothing in `NEXT_PUBLIC_*` is secret — those values are compiled into the client bundle.

## Dev container

`.devcontainer/` provides the full toolchain plus a MongoDB sidecar, with `MONGODB_URI` already pointed at it — so the API persists by default in there, unlike on the host. Chromium and shellcheck are preinstalled.

## When it still will not run

1. `npm run doctor` — it checks the boring causes.
2. `npm ci` — a `node_modules` that disagrees with `package.json` produces confusing failures. `npm run clean:all && npm ci` for the nuclear version.
3. [`docs/troubleshooting.md`](../../../docs/troubleshooting.md) — real symptoms with real causes.
4. `make info` — versions and repository state, worth including in any bug report.

## Verifying a change actually works

Running the app is not the same as verifying the change. State the specific evidence:

```bash
npm run check     # format, lint, typecheck, test, build — the merge gate
make check        # same, with a summary and every step run even after a failure
```

For a UI change, `apps/web` has no full automated suite — verify by hand against a running app and say what you observed. For a realtime change, verify with two clients. For an API change, the test suite is the evidence, and the denied path matters more than the allowed one.
