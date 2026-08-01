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
  createdAt: Date;
}

export interface Membership {
  id: string;
  orgId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  createdAt: Date;
}

export interface Room {
  id: string;
  orgId: string;
  name: string;
  description?: string;
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
  type: "password_reset" | "email_verification";
  expiresAt: Date;
  createdAt: Date;
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
