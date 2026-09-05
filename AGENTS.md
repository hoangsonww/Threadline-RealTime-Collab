# AGENTS.md

Instructions for coding agents working in this repository — Claude Code, Codex, Cursor, Copilot, Jules, Aider, and anything else that reads this file. Human contributors should read [`CONTRIBUTING.md`](CONTRIBUTING.md) instead; this file exists because agents need a different shape of context, not different rules.

Everything here is enforceable. If a suggestion in this file conflicts with what you observe in the code, the code wins and the file is a bug — say so rather than working around it silently.

## Table of contents

- [The one thing to understand first](#the-one-thing-to-understand-first)
- [Repository map](#repository-map)
- [Commands](#commands)
- [Non-negotiable invariants](#non-negotiable-invariants)
- [Conventions](#conventions)
- [How to add things](#how-to-add-things)
- [Testing](#testing)
- [Definition of done](#definition-of-done)
- [Gotchas that cost real time](#gotchas-that-cost-real-time)
- [Things not to do](#things-not-to-do)

## The one thing to understand first

Threadline is **three independently deployable services that do not trust each other's enforcement**. That is not a slogan; it is the design constraint that most changes have to respect.

```
apps/web        Next.js on Vercel        the client, and the only browser-facing surface
apps/api        Express 5 on Node        identity, authorization, durable persistence (MongoDB)
apps/realtime   Cloudflare Worker + DO   signalling, presence, live fan-out — one Durable Object per room
```

The API signs a room ticket. The realtime tier **verifies that ticket independently** before admitting a connection — it does not accept "the API already checked". Every boundary re-performs its own check.

The practical consequence for you: **do not remove a check because an upstream service appears to perform it.** That duplication is the architecture, not an oversight. If a check looks redundant, read [`docs/security.md`](docs/security.md) before touching it, and if it still looks redundant, say so in the PR rather than deleting it.

## Repository map

```
apps/api/src/
  domain.ts          the shared vocabulary — User, Organization, Room, RoomEvent, Scope, …
  policy.ts          EVERY authorization decision. canOrganization / canRoom / effectiveRoomRole
  security.ts        sessions, hashing, token and room-ticket primitives
  repository.ts      the Repository interface + MemoryRepository and MongoRepository
  cache.ts           the Cache port + MemoryCache and RedisCache — ephemeral, evictable, optional
  application.ts     createApp(options) — all routes. The largest file; read the region you need
  openapi.ts         createOpenApiDocument() — the OpenAPI 3.1 spec
  api-docs.ts        Swagger UI and ReDoc rendering
  turn.ts            time-boxed TURN credential derivation
  index.ts           process entry point — wiring only, no logic

apps/realtime/src/
  index.ts           the Worker fetch handler + RoomDurableObject (hibernatable, SQLite-backed)

apps/web/
  app/               Next.js App Router. /app/** is authenticated; everything else is public
  components/        the view layer
  lib/               the reusable module surface — api, peer-mesh, sound, call-shortcuts, site, …

docs/                architecture, api, realtime, security, operations, testing, deployment,
                     troubleshooting, frontend, glossary, roadmap
docs/decisions/      architecture decision records, numbered. Read these before proposing a redesign
infra/               Dockerfiles are per-app; Kubernetes manifests + kustomize overlays live here
scripts/             repository tooling. All dependency-free Node or bash
```

## Commands

Run these rather than inventing equivalents — they are what CI runs.

```bash
npm run dev              # all three services: api :4000, realtime :8787, web :3000
npm run check            # format + lint + typecheck + test + build — the full merge gate
make check               # the same, with a summary table and every step run even after a failure
npm run doctor           # diagnose the local environment before assuming the code is broken

npm run lint             # eslint, --max-warnings=0
npm run typecheck        # tsc --noEmit across all three workspaces
npm test                 # api (vitest/node) + realtime (vitest-pool-workers)
npm run test:browser     # Playwright
npm run build            # production build for every workspace

npm run docs             # TypeDoc → docs/api-reference/ (published: https://hoangsonww.github.io/Threadline-RealTime-Collab/)
npm run docs:links       # verify every relative markdown link still resolves
npm run openapi          # write openapi.json from the live spec builder

make help                # every available target, grouped
```

**Before claiming a change works, run the specific check that proves it.** `npm run typecheck` for a type change, `npm test` for behavior, `npm run build` for anything touching Next.js configuration. Do not report success on the basis of having read the diff.

## Non-negotiable invariants

Violating any of these will be caught in review, and most are caught by CI first.

1. **Authorization goes through `apps/api/src/policy.ts`.** If a route reads or writes a room or organization resource, it calls `canRoom` / `canOrganization` / `canInviteToOrganization`. A handler that decides for itself is a bug whatever it concludes. Never infer access from an id alone.

2. **Route handlers depend on the `Repository` interface, not on MongoDB.** Importing the `mongodb` package outside `repository.ts` is wrong — see [ADR 0003](docs/decisions/0003-repository-interface.md). `MemoryRepository` exists so the suite runs without a database; a change that only works against Mongo breaks it. The same rule holds for `redis` and `cache.ts` — and `Cache` is a *separate* port on purpose: it is evictable and may throw, so every call site must have a fallback that does more work, never one that enforces less. See [ADR 0009](docs/decisions/0009-redis-for-ephemeral-counters.md).

3. **No `any`.** ESLint is configured with `@typescript-eslint/no-explicit-any: error`. If a type is genuinely hard to express, write the awkward type and a comment explaining why — not an escape hatch.

4. **Type-only imports use `import type`.** `@typescript-eslint/consistent-type-imports` is an error, not a warning.

5. **Secrets never enter `NEXT_PUBLIC_*` and never enter git.** `apps/web/.env.local` and `apps/realtime/.dev.vars` are gitignored for this reason. The inventory of what is sensitive is in [`docs/security.md`](docs/security.md#secrets-inventory). A pre-commit hook (`scripts/guard-staged.mjs`) blocks the obvious cases; it is a backstop, not permission to be careless.

6. **The realtime tier re-verifies room tickets.** Do not "optimize" that away.

7. **A behavior change without a documentation update is incomplete.** Not a follow-up — incomplete. Update the relevant file in `docs/` in the same change.

8. **No new abstraction for a single call site.** This codebase has an established style. Match the pattern used by the layer you are touching rather than introducing a new one for one feature.

## Conventions

**Comments explain _why_, not _what_.** A comment earns its place by recording a non-obvious constraint, a workaround for a specific bug, or the reason an obvious-looking simplification is wrong. Do not annotate self-evident lines. Existing comments in this codebase follow that standard closely — read a few before writing your own, and **never delete a comment you do not understand.**

**Commits are conventional commits**, lowercase imperative subject, no trailing period:

```
feat(web): make the call shortcuts discoverable
fix(api): stop leaking Mongo's internal _id through new org responses
perf(api): bound room event history in the database instead of in memory
docs: record the bounded history contract and where its guarantee is asserted
```

Types: `feat fix perf refactor docs test build ci style chore revert`. Scopes: `api realtime web infra docker k8s ci build deps docs security seo dx agents test release`. The hook at `.husky/commit-msg` enforces this; `node scripts/verify-commit-message.mjs --message "…"` checks a message without committing.

**Branches:** `type/short-description` — `fix/rate-limit-key`, `feat/room-membership-revoke`.

**Formatting is not yours to decide.** Prettier, 120 columns, double quotes, semicolons, trailing commas. `*.md` is deliberately excluded from Prettier — do not reformat markdown.

## How to add things

### A new API endpoint

1. Add or extend the type in `domain.ts` if the shape is new.
2. Add the persistence method to the `Repository` **interface**, then implement it in **both** `MemoryRepository` and `MongoRepository`. Implementing only one breaks the test suite or production, and which one is not obvious from the diff.
3. Add the route in `application.ts`, next to its siblings. Validate the request body with Zod. Make the authorization decision by calling `policy.ts`.
4. Document the operation in `openapi.ts`, including its required scope.
5. Add an integration test in `app.test.ts` — via `supertest` against `createApp()` with a `MemoryRepository`. Cover the authorized path **and** the forbidden path. A new endpoint whose 403 is untested is not finished.
6. Update [`docs/api.md`](docs/api.md).

### A new realtime message

1. Extend the message handling in `apps/realtime/src/index.ts`.
2. Re-verify authorization inside the Durable Object. Do not assume the connection's ticket already covers the new capability.
3. Add a test in `index.test.ts` — these run under `@cloudflare/vitest-pool-workers`, in a real workerd runtime, not in Node.
4. Update [`docs/realtime.md`](docs/realtime.md) with the new message and its contract.

### A new public page in `apps/web`

Add it to `publicRoutes` in [`apps/web/lib/site.ts`](apps/web/lib/site.ts). The sitemap, the robots rules, and `/llms.txt` all derive from that list — adding it in one place makes it discoverable everywhere, and adding it in only one of the four is the bug this arrangement exists to prevent.

### An architectural decision

A new dependency, a new data model relationship, or a new trust boundary needs an ADR in [`docs/decisions/`](docs/decisions/README.md), numbered after the highest existing one. Follow the format of the existing records: context, decision, consequences — including what the decision **costs**, not only what it buys.

## Testing

| Suite | Where | Runner | Notes |
| --- | --- | --- | --- |
| API integration | `apps/api/src/app.test.ts` | vitest (node) | `supertest` against `createApp()` + `MemoryRepository` |
| API units | `apps/api/src/*.test.ts` | vitest (node) | `repository`, `turn`, `openapi`, `cache` |
| Durable Object | `apps/realtime/src/index.test.ts` | `@cloudflare/vitest-pool-workers` | needs workerd — excluded from the root vitest config on purpose |
| Web units | `apps/web/lib/*.test.ts` | vitest (node) | `peer-mesh`, `sound`, `call-shortcuts` |
| Browser | `apps/web/components/*.spec.ts` | Playwright | run with `npm run test:browser`, not `npm test` |

The realtime suite is **excluded** from the root `vitest.config.ts` and invoked separately by the root `test` script. If you add a realtime test and it does not run, that exclusion is why — it is deliberate.

## Definition of done

A change is finished when all of these are true:

- [ ] `npm run check` passes (or `make check` — same thing, better output)
- [ ] New behavior has a test; new authorization behavior has a test for the **denied** path too
- [ ] The relevant file in `docs/` is updated in the same change
- [ ] An architectural decision has an ADR
- [ ] No secret, token, or connection string is in the diff
- [ ] The commit message passes `scripts/verify-commit-message.mjs`
- [ ] You have stated what you actually ran and what you observed — not "tests should pass"

## Gotchas that cost real time

- **`npm test` does not run Playwright.** Browser specs are `*.spec.ts` and run only under `npm run test:browser`.
- **`MONGODB_URI` empty means in-memory.** `npm run dev:api:local` sets it empty on purpose, so the API starts with `MemoryRepository` and no database. Data disappears on restart — that is expected, not a bug.
- **`worker-configuration.d.ts` is generated** by `wrangler types` as part of the realtime `typecheck` script. Never hand-edit it; it is also excluded from Prettier and ESLint.
- **`apps/api/src/application.ts` is ~1,800 lines.** Read the region around the routes you are changing. Do not restructure it as a side effect of an unrelated change.
- **Prettier ignores `*.md`.** Markdown formatting is intentionally hand-managed. Do not "fix" it.
- **The root `dev` script needs three ports free** — 3000, 4000, 8787. `make ports` shows what is holding them; `npm run doctor` checks them among other things.
- **TypeDoc validation is strict.** `npm run docs` fails on a broken `{@link}` or a public signature that references an unexported type. If you widen a signature, export the type it now mentions.
- **Anchors with punctuation are fragile.** GitHub drops `+` and leaves a doubled hyphen; other renderers do not. `npm run docs:links` checks all 468 relative links — run it after editing headings.

## Things not to do

- Do not delete or rewrite comments you do not understand.
- Do not "clean up" code adjacent to your change. Scope discipline is a review criterion here.
- Do not add a dependency without an ADR. This repository is deliberately conservative about them.
- Do not reformat files you did not otherwise change.
- Do not weaken a type to make an error go away.
- Do not commit generated output — `docs/api-reference/`, `openapi.json`, `.next/`, `worker-configuration.d.ts` changes that are pure regeneration noise.
- Do not claim something passes without having run it. If you could not run it, say which check you could not run and why.
