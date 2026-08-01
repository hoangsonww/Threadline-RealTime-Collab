import { MongoClient, type Collection } from "mongodb";
import type {
  AuditLog,
  AuthorizationCode,
  AccountActionToken,
  Credential,
  Membership,
  OAuthClient,
  Organization,
  PersonalAccessToken,
  RefreshToken,
  Room,
  RoomEvent,
  RoomMembership,
  Session,
  User,
} from "./domain";

function firstPartyWebClient(redirectUri = "http://localhost:3000/oidc/callback"): OAuthClient {
  return {
    id: "threadline-web",
    name: "Threadline web",
    redirectUris: [redirectUri],
    allowedScopes: [
      "rooms:read",
      "rooms:write",
      "messages:read",
      "messages:write",
      "artifacts:read",
      "artifacts:write",
      "orgs:read",
    ],
    isFirstParty: true,
    createdAt: new Date(),
  };
}

export interface Repository {
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  createUser(user: User, credential: Credential): Promise<void>;
  getCredential(userId: string): Promise<Credential | undefined>;
  updateCredential(credential: Credential): Promise<void>;
  getSessionByTokenHash(tokenHash: string): Promise<Session | undefined>;
  getSession(sessionId: string): Promise<Session | undefined>;
  createSession(session: Session): Promise<void>;
  updateSession(session: Session): Promise<void>;
  listSessions(userId: string): Promise<Session[]>;
  getOrganizationsForUser(userId: string): Promise<Organization[]>;
  createOrganization(org: Organization, owner: Membership): Promise<void>;
  getMembership(orgId: string, userId: string): Promise<Membership | undefined>;
  getRoom(roomId: string): Promise<Room | undefined>;
  listRooms(orgId: string): Promise<Room[]>;
  createRoom(room: Room, member: RoomMembership): Promise<void>;
  getRoomMembership(roomId: string, userId: string): Promise<RoomMembership | undefined>;
  createPat(token: PersonalAccessToken): Promise<void>;
  listPats(userId: string): Promise<PersonalAccessToken[]>;
  getPatByHash(hash: string): Promise<PersonalAccessToken | undefined>;
  updatePat(token: PersonalAccessToken): Promise<void>;
  getOAuthClient(clientId: string): Promise<OAuthClient | undefined>;
  createAuthorizationCode(code: AuthorizationCode): Promise<void>;
  consumeAuthorizationCode(codeHash: string): Promise<AuthorizationCode | undefined>;
  createRefreshToken(token: RefreshToken): Promise<void>;
  consumeRefreshToken(hash: string): Promise<RefreshToken | undefined>;
  createAccountActionToken(token: AccountActionToken): Promise<void>;
  consumeAccountActionToken(hash: string, type: AccountActionToken["type"]): Promise<AccountActionToken | undefined>;
  writeRoomEvent(event: RoomEvent): Promise<void>;
  listRoomEvents(roomId: string): Promise<RoomEvent[]>;
  writeAudit(log: AuditLog): Promise<void>;
}

export class MemoryRepository implements Repository {
  private users = new Map<string, User>();
  private credentials = new Map<string, Credential>();
  private accountActionTokens = new Map<string, AccountActionToken>();
  private sessions = new Map<string, Session>();
  private orgs = new Map<string, Organization>();
  private memberships = new Map<string, Membership>();
  private rooms = new Map<string, Room>();
  private roomMemberships = new Map<string, RoomMembership>();
  private pats = new Map<string, PersonalAccessToken>();
  private clients = new Map<string, OAuthClient>();
  private authCodes = new Map<string, AuthorizationCode>();
  private refreshTokens = new Map<string, RefreshToken>();
  private roomEvents: RoomEvent[] = [];
  private audits: AuditLog[] = [];

  constructor() {
    this.clients.set("threadline-web", firstPartyWebClient());
  }

  async getUserByEmail(email: string) {
    return [...this.users.values()].find((user) => user.email === email);
  }
  async getUserById(id: string) {
    return this.users.get(id);
  }
  async createUser(user: User, credential: Credential) {
    this.users.set(user.id, user);
    this.credentials.set(user.id, credential);
  }
  async getCredential(userId: string) {
    return this.credentials.get(userId);
  }
  async updateCredential(credential: Credential) {
    this.credentials.set(credential.userId, credential);
  }
  async getSessionByTokenHash(tokenHash: string) {
    return [...this.sessions.values()].find((session) => session.refreshTokenHash === tokenHash);
  }
  async getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }
  async createSession(session: Session) {
    this.sessions.set(session.id, session);
  }
  async updateSession(session: Session) {
    this.sessions.set(session.id, session);
  }
  async listSessions(userId: string) {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId)
      .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime());
  }
  async getOrganizationsForUser(userId: string) {
    const ids = [...this.memberships.values()]
      .filter((membership) => membership.userId === userId)
      .map((membership) => membership.orgId);
    return ids.map((id) => this.orgs.get(id)).filter((org): org is Organization => Boolean(org));
  }
  async createOrganization(org: Organization, owner: Membership) {
    this.orgs.set(org.id, org);
    this.memberships.set(owner.id, owner);
  }
  async getMembership(orgId: string, userId: string) {
    return [...this.memberships.values()].find(
      (membership) => membership.orgId === orgId && membership.userId === userId,
    );
  }
  async getRoom(roomId: string) {
    return this.rooms.get(roomId);
  }
  async listRooms(orgId: string) {
    return [...this.rooms.values()]
      .filter((room) => room.orgId === orgId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }
  async createRoom(room: Room, member: RoomMembership) {
    this.rooms.set(room.id, room);
    this.roomMemberships.set(member.id, member);
  }
  async getRoomMembership(roomId: string, userId: string) {
    return [...this.roomMemberships.values()].find(
      (membership) => membership.roomId === roomId && membership.userId === userId,
    );
  }
  async createPat(token: PersonalAccessToken) {
    this.pats.set(token.id, token);
  }
  async listPats(userId: string) {
    return [...this.pats.values()]
      .filter((token) => token.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async getPatByHash(hash: string) {
    return [...this.pats.values()].find((token) => token.tokenHash === hash);
  }
  async updatePat(token: PersonalAccessToken) {
    this.pats.set(token.id, token);
  }
  async getOAuthClient(clientId: string) {
    return this.clients.get(clientId);
  }
  async createAuthorizationCode(code: AuthorizationCode) {
    this.authCodes.set(code.codeHash, code);
  }
  async consumeAuthorizationCode(codeHash: string) {
    const code = this.authCodes.get(codeHash);
    this.authCodes.delete(codeHash);
    return code;
  }
  async createRefreshToken(token: RefreshToken) {
    this.refreshTokens.set(token.tokenHash, token);
  }
  async consumeRefreshToken(hash: string) {
    const token = this.refreshTokens.get(hash);
    this.refreshTokens.delete(hash);
    return token;
  }
  async createAccountActionToken(token: AccountActionToken) {
    this.accountActionTokens.set(token.tokenHash, token);
  }
  async consumeAccountActionToken(hash: string, type: AccountActionToken["type"]) {
    const token = this.accountActionTokens.get(hash);
    this.accountActionTokens.delete(hash);
    return token?.type === type ? token : undefined;
  }
  async writeRoomEvent(event: RoomEvent) {
    this.roomEvents.push(event);
  }
  async listRoomEvents(roomId: string) {
    return this.roomEvents
      .filter((event) => event.roomId === roomId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  async writeAudit(log: AuditLog) {
    this.audits.push(log);
  }
}

/** Atlas adapter. Its collections mirror the identity-plane collection names in the architecture. */
export class MongoRepository implements Repository {
  private constructor(
    private client: MongoClient,
    private users: Collection<User>,
    private credentials: Collection<Credential>,
    private accountActionTokens: Collection<AccountActionToken>,
    private sessions: Collection<Session>,
    private orgs: Collection<Organization>,
    private memberships: Collection<Membership>,
    private rooms: Collection<Room>,
    private roomMemberships: Collection<RoomMembership>,
    private pats: Collection<PersonalAccessToken>,
    private clients: Collection<OAuthClient>,
    private authCodes: Collection<AuthorizationCode>,
    private refreshTokens: Collection<RefreshToken>,
    private roomEvents: Collection<RoomEvent>,
    private audits: Collection<AuditLog>,
  ) {}

  static async connect(uri: string, webRedirectUri?: string) {
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db();
    await Promise.all([
      db.collection<Session>("sessions").createIndex({ refreshTokenHash: 1 }, { unique: true }),
      db.collection<User>("users").createIndex({ email: 1 }, { unique: true }),
      db.collection<PersonalAccessToken>("personal_access_tokens").createIndex({ tokenHash: 1 }, { unique: true }),
      db.collection<AuthorizationCode>("auth_codes").createIndex({ codeHash: 1 }, { unique: true }),
      db.collection<AccountActionToken>("account_action_tokens").createIndex({ tokenHash: 1 }, { unique: true }),
      db
        .collection<AccountActionToken>("account_action_tokens")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection<RoomEvent>("room_events").createIndex({ roomId: 1, createdAt: -1 }),
      db
        .collection<OAuthClient>("oauth_clients")
        .updateOne({ id: "threadline-web" }, { $setOnInsert: firstPartyWebClient(webRedirectUri) }, { upsert: true }),
    ]);
    return new MongoRepository(
      client,
      db.collection("users"),
      db.collection("credentials"),
      db.collection("account_action_tokens"),
      db.collection("sessions"),
      db.collection("orgs"),
      db.collection("memberships"),
      db.collection("rooms"),
      db.collection("room_members"),
      db.collection("personal_access_tokens"),
      db.collection("oauth_clients"),
      db.collection("auth_codes"),
      db.collection("refresh_tokens"),
      db.collection("room_events"),
      db.collection("audit_logs"),
    );
  }

  async getUserByEmail(email: string) {
    return (await this.users.findOne({ email })) ?? undefined;
  }
  async getUserById(id: string) {
    return (await this.users.findOne({ id })) ?? undefined;
  }
  async createUser(user: User, credential: Credential) {
    await this.users.insertOne(user);
    await this.credentials.insertOne(credential);
  }
  async getCredential(userId: string) {
    return (await this.credentials.findOne({ userId })) ?? undefined;
  }
  async updateCredential(credential: Credential) {
    await this.credentials.replaceOne({ userId: credential.userId }, credential);
  }
  async getSessionByTokenHash(refreshTokenHash: string) {
    return (await this.sessions.findOne({ refreshTokenHash })) ?? undefined;
  }
  async getSession(id: string) {
    return (await this.sessions.findOne({ id })) ?? undefined;
  }
  async createSession(session: Session) {
    await this.sessions.insertOne(session);
  }
  async updateSession(session: Session) {
    await this.sessions.replaceOne({ id: session.id }, session);
  }
  async listSessions(userId: string) {
    return this.sessions.find({ userId }).sort({ lastUsedAt: -1 }).toArray();
  }
  async getOrganizationsForUser(userId: string) {
    const memberships = await this.memberships.find({ userId }).toArray();
    return this.orgs.find({ id: { $in: memberships.map((item) => item.orgId) } }).toArray();
  }
  async createOrganization(org: Organization, owner: Membership) {
    await this.orgs.insertOne(org);
    await this.memberships.insertOne(owner);
  }
  async getMembership(orgId: string, userId: string) {
    return (await this.memberships.findOne({ orgId, userId })) ?? undefined;
  }
  async getRoom(roomId: string) {
    return (await this.rooms.findOne({ id: roomId })) ?? undefined;
  }
  async listRooms(orgId: string) {
    return this.rooms.find({ orgId }).sort({ updatedAt: -1 }).toArray();
  }
  async createRoom(room: Room, member: RoomMembership) {
    await this.rooms.insertOne(room);
    await this.roomMemberships.insertOne(member);
  }
  async getRoomMembership(roomId: string, userId: string) {
    return (await this.roomMemberships.findOne({ roomId, userId })) ?? undefined;
  }
  async createPat(token: PersonalAccessToken) {
    await this.pats.insertOne(token);
  }
  async listPats(userId: string) {
    return this.pats.find({ userId }).sort({ createdAt: -1 }).toArray();
  }
  async getPatByHash(tokenHash: string) {
    return (await this.pats.findOne({ tokenHash })) ?? undefined;
  }
  async updatePat(token: PersonalAccessToken) {
    await this.pats.replaceOne({ id: token.id }, token);
  }
  async getOAuthClient(id: string) {
    return (await this.clients.findOne({ id })) ?? undefined;
  }
  async createAuthorizationCode(code: AuthorizationCode) {
    await this.authCodes.insertOne(code);
  }
  async consumeAuthorizationCode(codeHash: string) {
    const result = await this.authCodes.findOneAndDelete({ codeHash });
    return result ?? undefined;
  }
  async createRefreshToken(token: RefreshToken) {
    await this.refreshTokens.insertOne(token);
  }
  async consumeRefreshToken(tokenHash: string) {
    const result = await this.refreshTokens.findOneAndDelete({ tokenHash });
    return result ?? undefined;
  }
  async createAccountActionToken(token: AccountActionToken) {
    await this.accountActionTokens.insertOne(token);
  }
  async consumeAccountActionToken(tokenHash: string, type: AccountActionToken["type"]) {
    const result = await this.accountActionTokens.findOneAndDelete({ tokenHash, type });
    return result ?? undefined;
  }
  async writeRoomEvent(event: RoomEvent) {
    await this.roomEvents.insertOne(event);
  }
  async listRoomEvents(roomId: string) {
    return this.roomEvents.find({ roomId }).sort({ createdAt: 1 }).toArray();
  }
  async writeAudit(log: AuditLog) {
    await this.audits.insertOne(log);
  }
  async close() {
    await this.client.close();
  }
}
