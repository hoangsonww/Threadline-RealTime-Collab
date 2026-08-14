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

export type Scope = (typeof scopes)[number];
export type RoomRole = "owner" | "host" | "member" | "viewer";

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Credential {
  userId: string;
  passwordHash: string;
  passwordUpdatedAt: Date;
  emailVerifiedAt?: Date;
}

export interface Session {
  id: string;
  userId: string;
  refreshTokenHash: string;
  userAgent?: string;
  ipHash?: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date;
  revokedAt?: Date;
}

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

export type RoomVisibility = "organization" | "restricted";
export type RoomClassification = "internal" | "confidential";

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

export interface RoomMembership {
  id: string;
  roomId: string;
  userId: string;
  role: RoomRole;
  joinedAt: Date;
}

export interface PersonalAccessToken {
  id: string;
  userId: string;
  label: string;
  tokenHash: string;
  tokenPrefix: string;
  scopes: Scope[];
  expiresAt?: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
}

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  allowedScopes: Scope[];
  isFirstParty: boolean;
  createdAt: Date;
}

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

export interface RefreshToken {
  tokenHash: string;
  clientId: string;
  userId: string;
  scopes: Scope[];
  expiresAt: Date;
  revokedAt?: Date;
  createdAt: Date;
}

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

export interface AuditLog {
  id: string;
  actorId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface RoomEvent {
  id: string;
  roomId: string;
  type: string;
  payload: unknown;
  actorId?: string;
  createdAt: Date;
}

export interface RateLimitEntry {
  key: string;
  count: number;
  resetAt: Date;
}
