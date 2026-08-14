# Architecture Decision Records

Each ADR here captures a decision already made in this codebase — the context, the decision, the alternatives considered, and the consequences — so it doesn't get silently re-litigated later. Dates are derived from git history (`apps/realtime`, `apps/api/src/repository.ts`, etc. all trace back to the same initial commit), not guessed.

## Table of contents

- [Decisions](#decisions)
- [Adding a new ADR](#adding-a-new-adr)

## Decisions

| ADR                                                | Decision                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| [0001](0001-durable-objects-for-realtime.md)       | One Cloudflare Durable Object per room for live coordination                     |
| [0002](0002-webrtc-mesh-not-sfu.md)                | Full-mesh WebRTC, not a media server (SFU)                                       |
| [0003](0003-repository-interface.md)               | A `Repository` interface with in-memory and MongoDB implementations              |
| [0004](0004-three-auth-surfaces.md)                | Three separate authentication surfaces: session cookie, PAT, first-party OIDC    |
| [0005](0005-sqlite-hibernatable-durable-object.md) | SQLite-backed, hibernatable Durable Object storage                               |
| [0006](0006-self-service-workspace-membership.md)  | Self-service workspace creation and invite-code joining, not org-at-registration |
| [0007](0007-no-email-verification-without-a-mail-provider.md) | Remove email verification rather than ship a flow that silently sends nothing     |

## Adding a new ADR

Don't delete a superseded ADR — mark its status `Superseded by ADR-XXXX` and write a new one instead. See [`../architecture.md`](../architecture.md) for the live summary table these expand on.
