---
name: threadline-api-endpoint
description: Use when adding, changing, or removing an HTTP route in apps/api — including anything that touches the Repository interface, the OpenAPI specification, or an authorization decision. Enforces the six-step order that keeps routes, persistence, policy, spec, tests, and docs in sync.
---

# Adding an API endpoint

An endpoint in `apps/api` is six artefacts, not one. Skipping any of them produces a change that passes locally and fails in review, in CI, or — worst — in production against a database the test suite never exercises.

Do them in this order. The order matters: each step's output is the next step's input, and doing them backwards produces a route whose spec and tests were written against an interface that then changed.

## 1. Domain type — `apps/api/src/domain.ts`

Only if the shape is genuinely new. Reuse the existing vocabulary where one fits — `User`, `Organization`, `Membership`, `Room`, `RoomMembership`, `RoomEvent`, `CalendarEvent`, `PersonalAccessToken`, `Scope`.

If the endpoint needs a new scope, add it to the `scopes` array. `Scope` is derived from that array, so nothing else needs editing — and a scope invented inline in a route rather than added here will not typecheck.

## 2. Persistence — `apps/api/src/repository.ts`

Three edits, always together:

1. Add the method to the **`Repository` interface**.
2. Implement it in **`MemoryRepository`**.
3. Implement it in **`MongoRepository`**.

Implementing only one is the single most common way to break this codebase, and the failure is asymmetric: miss `MemoryRepository` and every test fails immediately; miss `MongoRepository` and everything passes until deployment. TypeScript catches a missing interface implementation, so let it — add the interface method **first**, then let the two compile errors tell you what to write.

Never import `mongodb` outside this file. That is [ADR 0003](../../../docs/decisions/0003-repository-interface.md).

## 3. Route — `apps/api/src/application.ts`

Place it next to its siblings — routes are grouped by resource, and a new one dropped at the end of the file is a review comment.

Every route does these in order:

1. **Authenticate.** Reuse the existing session / PAT middleware; do not re-derive identity.
2. **Validate** the request body, params, and query with Zod. An unvalidated body reaching the repository is a defect regardless of whether it currently causes a bug.
3. **Load** the resources the decision needs — the `Membership`, the `Room`, the `RoomMembership`.
4. **Decide** by calling `policy.ts`:
   - `canOrganization(membership, action)` — `read`, `create_room`, `manage_members`, `schedule`
   - `canRoom(membership, room, roomMembership, action)` — `read`, `join_live`, `write`, `manage`
   - `canInviteToOrganization(membership, organization)` — join-code visibility and rotation
5. **Act**, then respond.

**Never infer access from an id alone.** Possessing a room id is not evidence of membership in it. If you find yourself writing a role comparison inline, stop — that logic belongs in `policy.ts`, and duplicating it there is how the two copies diverge.

If a genuinely new kind of decision is needed, extend `policy.ts` rather than special-casing the route. Widening `RoomAction` or `OrganizationAction` is the normal way to do that.

Also check what the response body contains. MongoDB's internal `_id` has leaked through before — see the `fix(api): stop leaking Mongo's internal _id` commit. Return domain objects, not raw documents.

## 4. Specification — `apps/api/src/openapi.ts`

Document the operation: path, method, summary, request schema, every response status you can actually return, and **the required scope**. The spec is served live by the running service, so an undocumented operation is invisible to every consumer that reads it.

Verify: `npm run openapi` writes `openapi.json`; `apps/api/src/openapi.test.ts` asserts structural properties of the document.

## 5. Tests — `apps/api/src/app.test.ts`

`supertest` against `createApp()` with a `MemoryRepository`. Cover, at minimum:

- The **authorized** path — the caller who should succeed, does.
- The **denied** path — a caller who should not, gets 403 (or 404 where the endpoint deliberately hides existence; there is precedent for that in the organization join-code routes, which close an existence oracle).
- **Validation** — a malformed body is rejected before it reaches persistence.

An endpoint whose denial is untested is not finished. The 200 path tends to be exercised by hand during development; the 403 path only ever runs in the test suite.

## 6. Documentation — `docs/api.md`

Add the route, its scope, and its authorization rule. A behavior change without a doc update is treated as incomplete in this repository, not as a follow-up.

## Verify

```bash
npm run typecheck
npm test
npm run lint
npm run openapi        # regenerates the spec; confirms it still builds
npm run docs:links     # if you edited any heading in docs/
```

Report what you ran and what it said.

## Checklist

- [ ] Domain type added or reused
- [ ] `Repository` interface method added
- [ ] `MemoryRepository` implements it
- [ ] `MongoRepository` implements it
- [ ] Route validates with Zod
- [ ] Authorization decision made by `policy.ts`, not inline
- [ ] Response returns domain objects, not raw database documents
- [ ] Operation documented in `openapi.ts` with its required scope
- [ ] Test for the authorized path
- [ ] Test for the denied path
- [ ] Test for a malformed request
- [ ] `docs/api.md` updated
- [ ] `npm run check` passes
