# GitHub Copilot instructions

**The authoritative guidance for this repository is [`AGENTS.md`](../AGENTS.md).** Read it. This file is a short orientation for Copilot's inline and chat surfaces, where a long document does not fit; nothing here overrides it.

## What this repository is

Three independently deployable services that **do not trust each other's enforcement**:

- `apps/web` — Next.js on Vercel. The client.
- `apps/api` — Express 5 on Node with MongoDB, plus an optional Redis cache. Identity, authorization, persistence.
- `apps/realtime` — Cloudflare Worker with one Durable Object per room. Signalling, presence, fan-out.

The API signs a room ticket; the realtime tier verifies it **independently**. A check that looks redundant across services is almost certainly load-bearing. Do not suggest removing one.

## Rules that will fail review if broken

1. **Authorization goes through `apps/api/src/policy.ts`** — `canRoom`, `canOrganization`, `canInviteToOrganization`. Never infer access from an id alone, and never inline a role comparison in a route handler.
2. **New `Repository` methods must be implemented in both `MemoryRepository` and `MongoRepository`.** Missing the first fails every test; missing the second fails only in production.
3. **Never import `mongodb` outside `apps/api/src/repository.ts`, or `redis` outside `apps/api/src/cache.ts`.**
4. **`Cache` is not `Repository`.** The repository is the store of record; the cache is evictable and may throw. Every `Cache` call site needs a fallback that does *more* work — never one that enforces less. Nothing authorization-related is ever cached. See [ADR-0009](../docs/decisions/0009-redis-for-ephemeral-counters.md).
5. **No `any`.** ESLint treats `@typescript-eslint/no-explicit-any` as an error.
6. **Type-only imports use `import type`.**
7. **No secrets in `NEXT_PUBLIC_*`** — those are compiled into the client bundle.
8. **A new endpoint needs a test for its 403**, not only its 200.
9. **A behavior change needs its `docs/` update in the same change.**

## Style

- TypeScript strict, Prettier at 120 columns, double quotes, semicolons, trailing commas.
- `*.md` is excluded from Prettier — do not reformat markdown.
- Comments explain **why**, not what. Do not annotate self-evident lines, and never delete a comment you do not understand.
- No new abstraction for a single call site. Match the pattern already used by the layer being edited.

## Commits

Conventional commits, lowercase imperative subject, no trailing period:

```
feat(web): make the call shortcuts discoverable
fix(api): stop leaking Mongo's internal _id through new org responses
```

Types: `feat fix perf refactor docs test build ci style chore revert`. Scopes: `api realtime web infra docker k8s ci build deps docs security seo dx agents test release`.

CI validates the pull request title and every commit — see `scripts/verify-commit-message.mjs`.

## Verification

```bash
npm run check    # format, lint, typecheck, test, build — the merge gate
```

Do not describe a change as working without having run the check that proves it.
