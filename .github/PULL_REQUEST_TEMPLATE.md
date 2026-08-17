# Pull request

## Why

<!--
The change itself is visible in the diff. What isn't visible is the reason it
exists. Describe the problem, constraint, or user-facing symptom that made this
change necessary — the way the incidents in docs/operations.md are written up.

If this fixes a bug: describe the symptom *before* the fix.
If this is a feature: describe what was impossible or awkward without it.
-->

## What changed

<!--
A short summary per service touched. Skip the ones you didn't touch.

- `apps/api` —
- `apps/realtime` —
- `apps/web` —
- `infra/` —
- `docs/` —
-->

## Test plan

<!--
What you actually ran and what you actually observed. Not "tests pass" — which
tests, and what they now assert that they didn't before.
-->

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
```

- [ ] The full local check above passes
- [ ] New behavior is covered by a test, or I've explained below why it isn't testable
- [ ] I verified the UI change by hand against a locally-running app (`apps/web` has no automated suite — see [`docs/testing.md`](../docs/testing.md#everything-the-automated-suites-dont-cover))

## Trust boundaries

<!--
Threadline's three services do not trust each other's enforcement. Answer these
even if the answer is "none" — a silent "no" and an unconsidered "no" look
identical in a diff.
-->

- [ ] This change does **not** add or modify an authorization check. _If it does:_ the new/changed check goes through `policy.ts` (`canRoom` / `canOrganization`) rather than being re-implemented inline — see [`docs/api.md`](../docs/api.md#attribute-based-access-control-abac).
- [ ] This change does **not** introduce a new secret. _If it does:_ it is absent from `NEXT_PUBLIC_*`, absent from git, and recorded in [`docs/security.md`](../docs/security.md#secrets-inventory).
- [ ] This change does **not** alter a cross-service contract (room tickets, internal ingest, OIDC). _If it does:_ both sides re-verify independently.

## Documentation

- [ ] Docs updated alongside the code — a behavior change without a doc update is treated as incomplete, not as a follow-up
- [ ] This is an architectural decision (new dependency, new data model relationship, new trust boundary) and has an ADR in [`docs/decisions/`](../docs/decisions/README.md)
- [ ] Not an architectural decision — no ADR needed

## Deployment impact

- [ ] No migration, no new environment variable, no infra change
- [ ] Requires a new environment variable (listed in the "Why" section above and added to `.env.example` / `compose.yaml` / `infra/kubernetes/**`)
- [ ] Requires a data migration or backfill (describe the rollback path)
- [ ] Changes container or Kubernetes manifests (`docker compose build` and `npm run k8s:validate` both pass locally)

## Related

<!-- Closes #123 / Refs #456 / Follows up on ADR 0006 -->
