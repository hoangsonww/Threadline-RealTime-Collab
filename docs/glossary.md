# Glossary

Terms as this codebase actually uses them — not always the industry-general definition. Alphabetical, grouped by first letter.

## Table of contents

[A](#a) &middot; [C](#c) &middot; [D](#d) &middot; [E](#e) &middot; [H](#h) &middot; [I](#i) &middot; [J](#j) &middot; [M](#m) &middot; [O](#o) &middot; [P](#p) &middot; [R](#r) &middot; [S](#s) &middot; [V](#v) &middot; [W](#w)

## A

- **ABAC (Attribute-Based Access Control)** — Threadline's access model: every decision is derived from the caller's organization role, explicitly delegated attributes (`canCreateRooms`, `canManageMembers`, `canSchedule`), and — for rooms — the room's own visibility/classification, re-evaluated on every request. Never inferred from an ID alone. See [`api.md`](api.md#attribute-based-access-control-abac).
- **Account action token** (`AccountActionToken`) — A single-use, hashed, 1-hour-expiry token backing password reset links. Not a session or access token; it can only be redeemed at its one specific confirm endpoint. Only delivered when `AUTH_DELIVERY_WEBHOOK` is configured — see [`api.md`](api.md#email-delivery).
- **Recovery code** (`RecoveryCode`) — One of eight single-use secrets issued at registration and stored only as a SHA-256 hash. Redeeming one with the matching email resets the password and revokes every session. This is Threadline's account recovery, since it has no transactional email provider — and it deliberately proves possession of a secret rather than knowledge of account facts, because member listings publish a user's email, username, and display name to their whole workspace. See [`security.md`](security.md#recovery-codes).
- **Activity feed** — `/app/activity`. The last 100 durable `RoomEvent`s across every room the caller can currently see, org-wide.
- **Alarm** — A Durable Object's built-in scheduled-callback mechanism (`state.storage.setAlarm`). `RoomDurableObject` uses it as its only retry loop: if the webhook hand-off to the API fails, it schedules an alarm 30 seconds out and tries again. See [`realtime.md`](realtime.md#roomdurableobject).

## C

- **`Cache`** (port) — The second storage port in `apps/api`, beside `Repository` and deliberately not part of it. Two operations only: `incrementWindow` (a fixed rate-limit window) and `claim` (a "did this already happen recently" flag). Everything behind it is **evictable and may throw**, so every call site must have a fallback that does more work rather than enforcing less. Implemented by `MemoryCache` (tests, single-process dev) and `RedisCache`. See [ADR-0009](decisions/0009-redis-for-ephemeral-counters.md).
- **Classification** (room) — `internal` or `confidential`. Only matters when `visibility` is `organization`: a `confidential` room additionally requires explicit `RoomMembership` even for regular org members (org owners/admins still get in via their elevated role). Doesn't apply to `restricted` rooms, which already require explicit membership regardless.
- **Credential** — The `passwordHash`/`emailVerifiedAt` record, stored as a table separate from `User` so a `User` object can be handled/logged without any risk of a hash traveling with it. `emailVerifiedAt` can no longer be set — email verification was removed because nothing could deliver its mail — so it is null for every account except one that verified before the removal, whose timestamp is retained rather than rewritten. The field survives because the OIDC `email_verified` claim is derived from it.

## D

- **Durable Object** — Cloudflare's single-instance, globally-coordinated compute+storage primitive. Threadline creates exactly one `RoomDurableObject` per room (`idFromName(roomId)`), which is the sole authoritative owner of that room's live presence and signaling state. See [`realtime.md`](realtime.md).

## E

- **Effective role** — The room role (`owner`/`host`/`member`/`viewer`) actually computed for a caller by `effectiveRoomRole()`, as opposed to their raw org role. An org admin with no explicit `RoomMembership` row gets `host` as their effective role; a plain org member gets `member` only if the room is org-visible and non-confidential.

## H

- **Hibernation** (WebSocket) — The Workers runtime's ability to evict a Durable Object from memory between WebSocket messages and restore it (along with each socket's serialized attachment) on the next one, so an idle-but-connected room costs no ongoing compute. `state.acceptWebSocket()` opts into this; a plain `addEventListener` would not.

## I

- **ICE / STUN / TURN** — Standard WebRTC connectivity-establishment building blocks. Threadline currently only configures a public STUN server by default; TURN is not wired up (see [`roadmap.md`](roadmap.md)).
- **Ingest secret** — The shared value between `apps/api` (`INTERNAL_INGEST_SECRET`) and `apps/realtime` (`PERSISTENCE_SECRET`, same value) that authenticates the Durable Object's webhook calls to `POST /v1/internal/room-events`. Proves the _request_ is from the trusted Worker; does not by itself authorize the _event's_ content — see [`security.md`](security.md#realtime--api-ingest-secret).

## J

- **Join code** (`Organization.joinCode`) — An 8-character, regenerable code (`ABCDEFGHJKMNPQRSTUVWXYZ23456789` alphabet — visually ambiguous characters excluded) that self-serves an org's `member` role via `POST /v1/join`. Owners/admins can always view or regenerate it (`GET`/`POST /v1/orgs/:orgId/invite*`); a plain member can only when `allowMemberInvites` is set. Never included in any general-purpose response (`/v1/auth/me`, `GET /v1/orgs`) — only the dedicated invite endpoints return it. See [`api.md`](api.md#organizations--rooms).

## M

- **Membership** — A user's row in an `Organization` (role: `owner`/`admin`/`member`, plus delegated `attributes`). Distinct from `RoomMembership`, which is room-scoped.

## O

- **OIDC (OpenID Connect)** — Threadline's first-party identity provider (`/oauth/*`, `/.well-known/openid-configuration`). Authorization Code + PKCE only; no implicit or password grant; first-party clients only (no public third-party registration). See [`api.md`](api.md#oidc-authorization-code-with-pkce-end-to-end).
- **Organization** — The top-level tenant. Registration no longer creates one — a new account joins or creates its first organization on `/onboarding`, via `POST /v1/orgs` (become owner) or `POST /v1/join` (redeem an invite code). A user can belong to more than one.

## P

- **PAT (Personal Access Token)** — `tl_pat_…`-prefixed, explicitly scoped, revocable bearer credential for automation. Cannot call session-only routes (create/list/revoke other PATs, list sessions, list OIDC clients) even with the `admin:*` scope. See [`security.md`](security.md#personal-access-tokens).
- **PeerMesh** — `apps/web/lib/peer-mesh.ts`. The browser-side full-mesh WebRTC client: one `RTCPeerConnection` + one data channel per remote participant, with the Durable Object relaying signaling only. See [`realtime.md`](realtime.md#webrtc-mesh-why-both-sides-have-to-offer).
- **PKCE (Proof Key for Code Exchange)** — The `code_challenge`/`code_verifier` mechanism that makes Threadline's OAuth authorization code exchange safe without a client secret. S256 only.
- **Presence** — The live participant list for a room, broadcast to everyone connected whenever it changes (join, leave, screen-share toggle). Distinct from the _durable_ `RoomEvent` log — presence is ephemeral and never persisted on its own.

## R

- **Redis** — Optional, enabled by `REDIS_URL`. Holds only ephemeral counters: rate-limit windows and 60-second session/PAT "recently recorded" claims. It is **not** a store of record — under `allkeys-lru` any key can be evicted at any moment — and nothing authorization-related is ever cached in it. `apps/realtime` has no Redis dependency and cannot have one (workerd has no Node TCP socket); presence remains a Durable Object concern per [ADR-0001](decisions/0001-durable-objects-for-realtime.md). See [ADR-0009](decisions/0009-redis-for-ephemeral-counters.md).

- **Repository** — The `apps/api/src/repository.ts` interface (`getUser`, `createRoom`, `listRoomEvents`, `incrementRateLimit`, …) with two implementations: `MemoryRepository` (tests, local dev with no `MONGODB_URI`) and `MongoRepository` (production). Route handlers in `application.ts` depend only on the interface.
- **Restricted room** (`visibility: "restricted"`) — Requires explicit `RoomMembership` to read/join at all, regardless of classification. Org owners/admins can still intervene via their elevated effective role. Currently has no membership-revoke UI — see [`roadmap.md`](roadmap.md).
- **Room** — The core unit of collaboration: both a live WebRTC/chat session and a durable, permission-filtered event timeline. Belongs to exactly one organization.
- **Room event** (`RoomEvent`) — A durably persisted, timestamped record of something that happened in a room (`room.created`, `chat`, `editor`, `screen-share`, `participant.joined`, `participant.left`). `cursor`, `signal`, and `whiteboard` are explicitly _not_ persisted — too high-frequency, not meaningful as a record. See [`architecture.md`](architecture.md#data-model).
- **Room membership** (`RoomMembership`) — A user's _explicit_ role (`owner`/`host`/`member`/`viewer`) in a specific room, as opposed to whatever role they'd get implicitly from their organization role and the room's visibility. Only required for `restricted` or `confidential` rooms.
- **Room ticket** — A short-lived (120s), single-purpose HS256 JWT issued by `POST /v1/rooms/:roomId/ticket`, authorizing exactly one WebSocket connection to exactly one room for the identity it encodes. See [`security.md`](security.md#room-tickets).

## S

- **Scope** — A PAT permission string (`rooms:read`, `rooms:write`, `orgs:read`, `orgs:write`, `admin:*`, plus the currently-unused `messages:*`/`artifacts:*`). See [`api.md`](api.md#scopes).
- **Session** — The 30-day, sliding-expiry, HttpOnly-cookie-backed browser credential. One user can have many concurrent sessions (one per signed-in browser); each is individually listable and revocable in Settings.
- **SFU vs. mesh** — Two different architectures for multi-party WebRTC. An SFU (Selective Forwarding Unit) is a media server that each participant sends one upload to; a mesh has every participant connect directly to every other participant, with no media server. Threadline uses a mesh — see the rationale in [`architecture.md`](architecture.md#why-its-split-this-way).
- **Signal** — A WebRTC signaling message (SDP offer/answer or ICE candidate), relayed 1:1 between two participants' sockets by the Durable Object, which never inspects or stores its contents.

## V

- **Visibility** (room) — `organization` (any org member can see/join, subject to classification) or `restricted` (explicit `RoomMembership` required, full stop).

## W

- **WorkspaceGate** — The single client component (`apps/web/components/workspace-gate.tsx`) every `/app/**` route renders behind. Blocks on `GET /v1/auth/me` before showing anything; redirects to `/login` if unauthenticated, or to `/onboarding` if the account has zero organizations. See [`frontend.md`](frontend.md#workspacegate-the-one-place-session-checking-happens).
