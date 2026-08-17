/**
 * The shared vocabulary of the API tier.
 *
 * Every entity the system persists is declared here, and nowhere else. The
 * types are deliberately plain — no classes, no decorators, no ORM annotations
 * — because they are the contract between four things that must not diverge:
 * the route handlers in {@link application}, both implementations of
 * {@link repository.Repository}, the OpenAPI document, and the client.
 *
 * When a term here disagrees with [`docs/glossary.md`](../../../docs/glossary.md),
 * the type is correct and the glossary is stale.
 *
 * @module
 */

/**
 * Every scope a personal access token or an OAuth grant can carry.
 *
 * Declared `as const` so {@link Scope} derives from it — adding a scope to this
 * array is the only edit required, and a scope invented inline anywhere else
 * will not typecheck.
 */
export const scopes = [
  "rooms:read",
  "rooms:write",
  "messages:read",
  "messages:write",
  "artifacts:read",
  "artifacts:write",
  "orgs:read",
  "orgs:write",
  "admin:*",
] as const;

/** A single authorization scope. Derived from {@link scopes}. */
export type Scope = (typeof scopes)[number];

/**
 * A user's role within one room, in descending order of authority.
 *
 * Distinct from the organization role on {@link Membership}: a user can be a
 * plain organization `member` and still be the `owner` of a room within it.
 * The two are combined by `effectiveRoomRole` in {@link policy}, which
 * is the only place that resolution should happen.
 */
export type RoomRole = "owner" | "host" | "member" | "viewer";

/**
 * A person.
 *
 * Note that `email`, `username`, and `displayName` are all disclosed to other
 * members of the same workspace by the `publicUser` projection — which is why
 * account recovery cannot be built on knowledge of them. See
 * {@link RecoveryCode}.
 */
export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A user's password material, kept in a separate record from {@link User} so
 * that reading a profile never loads a hash into memory alongside it.
 */
export interface Credential {
  userId: string;
  passwordHash: string;
  passwordUpdatedAt: Date;
  /**
   * Retained for records predating the removal of email verification. Nothing
   * sets it now — see [ADR 0007](../../../docs/decisions/0007-no-email-verification-without-a-mail-provider.md).
   */
  emailVerifiedAt?: Date;
}

/**
 * A browser session.
 *
 * Only the refresh token's hash is stored, so a database disclosure does not
 * yield usable sessions. `ipHash` is likewise a hash rather than an address:
 * enough to notice a session moving between networks, not enough to constitute
 * a location log.
 */
export interface Session {
  id: string;
  userId: string;
  refreshTokenHash: string;
  userAgent?: string;
  ipHash?: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date;
  /** Set when the session is signed out or revoked. A revoked session is never deleted. */
  revokedAt?: Date;
}

/**
 * A workspace. The top-level tenancy boundary: rooms, memberships, calendar
 * events, and activity all belong to exactly one.
 */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  /** Shareable, regenerable code used to self-serve join this organization. */
  joinCode: string;
  /** When false (the default), only an owner/admin can view or regenerate joinCode. */
  allowMemberInvites: boolean;
  createdAt: Date;
}

/**
 * A user's membership of an organization, and the authority it carries.
 *
 * The `role` is the base grant; `attributes` are explicit additions on top of
 * it. Both are read by `canOrganization` in {@link policy} — never
 * compared directly in a route handler.
 */
export interface Membership {
  id: string;
  orgId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  /** Explicit, auditable delegation beyond the base organization role. */
  attributes?: {
    canCreateRooms?: boolean;
    canManageMembers?: boolean;
    canSchedule?: boolean;
  };
  createdAt: Date;
}

/**
 * Who can reach a room at all.
 *
 * `organization` — any member of the owning organization. `restricted` —
 * only users with an explicit {@link RoomMembership}.
 */
export type RoomVisibility = "organization" | "restricted";

/**
 * How sensitive a room's contents are.
 *
 * `confidential` requires an explicit {@link RoomMembership} even when
 * {@link RoomVisibility} would otherwise admit the whole organization.
 * Organization owners and admins can still intervene — see `effectiveRoomRole`.
 */
export type RoomClassification = "internal" | "confidential";

/**
 * A room: simultaneously a live session and the durable record of what
 * happened in it.
 *
 * `visibility` and `classification` were both introduced after the first rooms
 * existed, so `effectiveRoomRole` in {@link policy} treats their absence
 * as `organization` / `internal` to keep historical rooms reachable. Changing
 * that default silently changes who can read old rooms.
 */
export interface Room {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  visibility: RoomVisibility;
  classification: RoomClassification;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A scheduled session, optionally bound to a specific {@link Room}. */
export interface CalendarEvent {
  id: string;
  orgId: string;
  roomId?: string;
  title: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Explicit membership of a single room.
 *
 * Its presence overrides whatever {@link RoomVisibility} would otherwise grant
 * — which is how a `restricted` or `confidential` room admits anyone at all.
 */
export interface RoomMembership {
  id: string;
  roomId: string;
  userId: string;
  role: RoomRole;
  joinedAt: Date;
}

/**
 * A long-lived bearer token for automation, presented as
 * `Authorization: Bearer tl_pat_…`.
 *
 * Only the hash is stored. `tokenPrefix` holds the leading characters so the
 * token can be identified in a list without being reconstructible from it.
 */
export interface PersonalAccessToken {
  id: string;
  userId: string;
  label: string;
  tokenHash: string;
  /** Leading characters of the token, for display only. Not sufficient to authenticate. */
  tokenPrefix: string;
  scopes: Scope[];
  expiresAt?: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
}

/**
 * A registered OIDC/OAuth client.
 *
 * `isFirstParty` is not decoration: there is deliberately no public client
 * registration, and the authorization flow refuses anything else. See
 * [ADR 0004](../../../docs/decisions/0004-three-auth-surfaces.md).
 */
export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  allowedScopes: Scope[];
  isFirstParty: boolean;
  createdAt: Date;
}

/**
 * A pending Authorization Code grant.
 *
 * Single-use — `consumeAuthorizationCode` on {@link repository.Repository} both reads and
 * invalidates it, so replay is prevented by the storage layer rather than by a
 * check a caller could forget. `codeChallenge` makes PKCE mandatory; there is
 * no implicit grant.
 */
export interface AuthorizationCode {
  codeHash: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  scopes: Scope[];
  codeChallenge: string;
  nonce?: string;
  expiresAt: Date;
}

/** An OAuth refresh token. Single-use in the same sense as {@link AuthorizationCode}. */
export interface RefreshToken {
  tokenHash: string;
  clientId: string;
  userId: string;
  scopes: Scope[];
  expiresAt: Date;
  revokedAt?: Date;
  createdAt: Date;
}

/**
 * A single-use token for an out-of-band account action.
 *
 * Only reaches a user where an operator has configured
 * `AUTH_DELIVERY_WEBHOOK`; with no mail provider the link-based reset path
 * simply never completes, which is why {@link RecoveryCode} exists alongside
 * it. Expiry is enforced by a TTL index created in `MongoRepository.connect`.
 */
export interface AccountActionToken {
  tokenHash: string;
  userId: string;
  type: "password_reset";
  expiresAt: Date;
  createdAt: Date;
}

/**
 * A single-use account recovery code.
 *
 * Threadline has no transactional email provider, so a mailed reset link is not a
 * mechanism it can offer. These are the substitute: high-entropy secrets issued at
 * registration, shown exactly once, and stored only as hashes. Recovery therefore
 * proves possession of a secret rather than knowledge of account facts — which
 * matters here because `publicUser` hands a member's email, username, and display
 * name to every other member of their workspace, so any check built on those would
 * let a coworker take the account over.
 */
export interface RecoveryCode {
  id: string;
  userId: string;
  /** SHA-256 of the normalized code. The plaintext is never stored. */
  codeHash: string;
  createdAt: Date;
  usedAt?: Date;
}

/** An append-only record of a security-relevant action. Never updated or deleted. */
export interface AuditLog {
  id: string;
  actorId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

/**
 * One durable event in a room's history — a whiteboard stroke, a message, a
 * note edit.
 *
 * Written by the realtime tier through the authenticated internal ingest path,
 * never directly by a client. History is bounded in the database rather than in
 * memory, so a long-lived room cannot grow a Durable Object's heap without
 * limit; see [`docs/realtime.md`](../../../docs/realtime.md).
 *
 * `payload` is `unknown` on purpose: the shape is the realtime protocol's
 * concern, and narrowing it here would put the protocol's version story in the
 * wrong tier.
 */
export interface RoomEvent {
  id: string;
  roomId: string;
  type: string;
  payload: unknown;
  actorId?: string;
  createdAt: Date;
}

/**
 * One fixed-window rate limit bucket.
 *
 * Incremented through `incrementRateLimit` on {@link repository.Repository}, which is
 * atomic in `MongoRepository` — a read-then-write in the route would race under
 * exactly the concurrent load the limiter exists to handle.
 */
export interface RateLimitEntry {
  key: string;
  count: number;
  resetAt: Date;
}
