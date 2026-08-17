---
name: threadline-trust-boundary
description: Use before changing anything that touches authorization, room tickets, the internal ingest path, OIDC/OAuth, sessions, secrets, or TURN credentials — and before removing any check that appears redundant with another service's. Covers the review a security-relevant change has to survive.
---

# Reviewing a trust-boundary change

Threadline's design claim is that **three services do not trust each other's enforcement**. Every change in this area is evaluated against that claim, and the most dangerous change is the one that looks like a simplification.

## The reflex to resist

> "The API already checks this before issuing the ticket, so the Durable Object's check is redundant."

It is not redundant. It is the architecture. The API and the realtime tier are separately deployed, separately reachable, and separately compromisable. A check that exists only upstream protects nothing once someone reaches the downstream service directly.

If a check genuinely is dead — unreachable, or subsumed by a stronger check *in the same service* — say so explicitly in the pull request with the reasoning, and expect it to be scrutinised. Do not delete it quietly.

## The files that define the boundaries

These are owned in [`.github/CODEOWNERS`](../../../.github/CODEOWNERS) precisely because a change to them is never "just a refactor":

| File | What it enforces |
| --- | --- |
| `apps/api/src/policy.ts` | Every ABAC decision — `canOrganization`, `canRoom`, `canInviteToOrganization`, `effectiveRoomRole` |
| `apps/api/src/security.ts` | Sessions, hashing, token and room-ticket primitives |
| `apps/api/src/turn.ts` | Time-boxed TURN credential derivation |
| `apps/realtime/src/index.ts` | Independent ticket verification at the realtime boundary |
| `docs/security.md` | The written trust model those files implement |

Read [`docs/security.md`](../../../docs/security.md) before editing any of them. It documents the secrets inventory and, for each secret, exactly which plane holds it and what it authorizes. Several secrets are deliberately **not** shared between planes; a change that widens one's reach is a design change requiring an ADR.

## What to check

### Authorization

- Does the decision go through `policy.ts`? Inline role comparisons in a route are the failure mode this module exists to prevent.
- Is access inferred from an id anywhere? Holding a room id is not evidence of membership.
- Does the change alter `effectiveRoomRole`? That function encodes backwards compatibility for rooms created before visibility and classification existed — organization-visible, non-confidential rooms default to `member` access. Changing it silently changes who can reach historical rooms.
- Is the **denied** path tested? Not the allowed one — the denied one.

### Tickets and cross-service secrets

- `ROOM_TICKET_SECRET` — the API signs, the realtime tier verifies. Both sides, independently.
- `INTERNAL_INGEST_SECRET` / `PERSISTENCE_SECRET` — the realtime tier sends, the API verifies inbound. Persisted room events must not be forgeable by anything that can reach the API.
- Does the change extend a ticket's lifetime, widen its scope, or make it reusable? Each of those is a security decision, not an implementation detail.

### Secrets

- Nothing sensitive in `NEXT_PUBLIC_*` — those are compiled into the client bundle and are public by construction.
- Nothing sensitive in a log line or an error response. Error bodies have leaked internal identifiers before.
- New secret? Add it to the inventory in `docs/security.md`, to `.env.example` / `.dev.vars.example`, to `compose.yaml`, and to the Kubernetes overlays. A secret that only exists in one deployment path produces an outage in the others.

### Information disclosure

- Does a 404-vs-403 distinction reveal whether a resource exists? The organization join-code routes deliberately close that oracle; match the precedent rather than contradicting it.
- Does the response include database internals? `_id` has leaked before.

### Rate limiting

Authentication and join endpoints are rate limited. Is the new surface reachable without one? Check how the limiter derives its key — a limiter keyed on the wrong attribute has been a real bug here.

## Verify

```bash
npm test                          # the denied-path tests are the point
npm run typecheck
npm run lint
```

Then re-read the diff asking one question per removed line: *what was this protecting, and what protects it now?*

## When this needs an ADR

Write one ([`.claude/skills/threadline-adr`](../threadline-adr/SKILL.md)) if the change:

- introduces a new trust boundary, or removes one;
- changes what a secret authorizes, or which plane holds it;
- changes the ticket format, lifetime, or verification;
- changes the default access a role receives.

## Checklist

- [ ] No check removed on the grounds that another service performs it
- [ ] Every decision goes through `policy.ts`
- [ ] No access inferred from an id alone
- [ ] Denied path tested
- [ ] Ticket lifetime, scope, and reusability unchanged — or changed deliberately and recorded
- [ ] No secret in `NEXT_PUBLIC_*`, logs, or error responses
- [ ] New secrets added to the inventory and to every deployment path
- [ ] No new existence oracle
- [ ] No database internals in responses
- [ ] Rate limiting still covers the surface
- [ ] `docs/security.md` updated
- [ ] ADR written if a boundary moved
