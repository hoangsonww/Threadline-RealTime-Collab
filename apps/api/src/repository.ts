import { MongoClient, type Collection, type Db } from "mongodb";
import type {
  AuditLog,
  CalendarEvent,
  AuthorizationCode,
  AccountActionToken,
  Credential,
  Membership,
  OAuthClient,
  Organization,
  PersonalAccessToken,
  RateLimitEntry,
  RefreshToken,
  Room,
  RoomEvent,
  RecoveryCode,
  RoomMembership,
  Session,
  User,
} from "./domain.js";

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

/**
 * Raised when a write would give two accounts the same username.
 *
 * `MongoRepository` raises it from the driver's duplicate-key error, which is the
 * only check that is actually decisive — a read-then-write in the route layer
 * cannot close the window between the two. `MemoryRepository` raises it from an
 * explicit scan so both implementations behave identically under test.
 */
export class UsernameTakenError extends Error {
  constructor(readonly username: string) {
    super(`The username ${username} is already taken.`);
    this.name = "UsernameTakenError";
  }
}

/** MongoDB's duplicate-key error code. */
const duplicateKeyErrorCode = 11000;

const isDuplicateUsernameError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === duplicateKeyErrorCode &&
  JSON.stringify((error as { keyPattern?: unknown }).keyPattern ?? {}).includes("username");

export interface Repository {
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: User, credential: Credential): Promise<void>;
  updateUser(user: User): Promise<void>;
  getCredential(userId: string): Promise<Credential | undefined>;
  updateCredential(credential: Credential): Promise<void>;
  getSessionByTokenHash(tokenHash: string): Promise<Session | undefined>;
  getSession(sessionId: string): Promise<Session | undefined>;
  createSession(session: Session): Promise<void>;
  updateSession(session: Session): Promise<void>;
  listSessions(userId: string): Promise<Session[]>;
  getOrganizationsForUser(userId: string): Promise<Organization[]>;
  getOrganization(orgId: string): Promise<Organization | undefined>;
  getOrganizationByJoinCode(joinCode: string): Promise<Organization | undefined>;
  createOrganization(org: Organization, owner: Membership): Promise<void>;
  updateOrganization(org: Organization): Promise<void>;
  getMembership(orgId: string, userId: string): Promise<Membership | undefined>;
  listMemberships(orgId: string): Promise<Membership[]>;
  createMembership(membership: Membership): Promise<void>;
  updateMembership(membership: Membership): Promise<void>;
  getRoom(roomId: string): Promise<Room | undefined>;
  listRooms(orgId: string): Promise<Room[]>;
  createRoom(room: Room, member: RoomMembership): Promise<void>;
  getRoomMembership(roomId: string, userId: string): Promise<RoomMembership | undefined>;
  listRoomMemberships(roomId: string): Promise<RoomMembership[]>;
  createRoomMembership(membership: RoomMembership): Promise<void>;
  deleteRoomMembership(roomId: string, userId: string): Promise<void>;
  createCalendarEvent(event: CalendarEvent): Promise<void>;
  listCalendarEvents(orgId: string, from?: Date, to?: Date): Promise<CalendarEvent[]>;
  createPat(token: PersonalAccessToken): Promise<void>;
  listPats(userId: string): Promise<PersonalAccessToken[]>;
  getPatByHash(hash: string): Promise<PersonalAccessToken | undefined>;
  updatePat(token: PersonalAccessToken): Promise<void>;
  getOAuthClient(clientId: string): Promise<OAuthClient | undefined>;
  listOAuthClients(): Promise<OAuthClient[]>;
  createAuthorizationCode(code: AuthorizationCode): Promise<void>;
  consumeAuthorizationCode(codeHash: string): Promise<AuthorizationCode | undefined>;
  createRefreshToken(token: RefreshToken): Promise<void>;
  consumeRefreshToken(hash: string): Promise<RefreshToken | undefined>;
  createAccountActionToken(token: AccountActionToken): Promise<void>;
  consumeAccountActionToken(hash: string, type: AccountActionToken["type"]): Promise<AccountActionToken | undefined>;
  writeRoomEvent(event: RoomEvent): Promise<void>;
  /**
   * Most recent events for a room, returned oldest-first.
   *
   * `limit` is applied by the store, not the caller. A room's durable log grows
   * without bound, so selecting in the database is the difference between reading
   * one page and reading every event the room has ever recorded.
   */
  listRoomEvents(roomId: string, options?: { limit: number; before?: Date }): Promise<RoomEvent[]>;
  /** Most recent events across several rooms, newest-first, bounded by `limit`. */
  listRoomEventsForRooms(roomIds: string[], options?: { limit: number }): Promise<RoomEvent[]>;
  replaceRecoveryCodes(userId: string, codes: RecoveryCode[]): Promise<void>;
  listRecoveryCodes(userId: string): Promise<RecoveryCode[]>;
  /** Marks the matching unused code used and returns it, or undefined. Must be atomic. */
  consumeRecoveryCode(userId: string, codeHash: string): Promise<RecoveryCode | undefined>;
  writeAudit(log: AuditLog): Promise<void>;
  /** Atomically increments the counter for `key`, resetting it if the window has elapsed. */
  incrementRateLimit(key: string, windowMs: number): Promise<RateLimitEntry>;
}

/**
 * Build the unique index that makes username uniqueness actually decisive.
 *
 * Kept out of the boot-time `Promise.all` and non-fatal on purpose. Registration
 * accepted duplicate usernames for most of this service's life, so an existing
 * deployment may still hold some — and a unique index that cannot build against a
 * populated collection is exactly what took every request down once before (see
 * docs/operations.md). Failing the boot here would repeat that outage to fix a
 * lesser problem.
 *
 * So: build it where it can be built, and where it cannot, log loudly enough that
 * the duplicates get cleaned up (`npm run dedupe:usernames --workspace=@threadline/api`)
 * rather than silently degrade. The application-level check still runs either way;
 * it just cannot close the race on its own.
 */
async function ensureUniqueUsernameIndex(db: Db) {
  try {
    await db.collection<User>("users").createIndex({ username: 1 }, { unique: true, name: "username_unique" });
  } catch (error) {
    const duplicates = await db
      .collection<User>("users")
      .aggregate([{ $group: { _id: "$username", count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }])
      .toArray()
      .catch(() => []);
    console.error(
      "[threadline] Could not create the unique index on users.username. Usernames are NOT being enforced " +
        "atomically; concurrent requests can still create duplicates. Resolve the duplicates below and restart.\n" +
        `  duplicate usernames: ${duplicates.map((entry) => `${String(entry._id)} (${entry.count})`).join(", ") || "unknown"}\n` +
        `  underlying error: ${error instanceof Error ? error.message : String(error)}`,
    );
    // Fall back to the non-unique index so lookups stay indexed either way.
    await db
      .collection<User>("users")
      .createIndex({ username: 1 })
      .catch(() => undefined);
  }
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
  private calendarEvents = new Map<string, CalendarEvent>();
  private audits: AuditLog[] = [];
  private rateLimits = new Map<string, RateLimitEntry>();
  private recoveryCodes = new Map<string, RecoveryCode>();

  constructor() {
    this.clients.set("threadline-web", firstPartyWebClient());
  }

  async getUserByEmail(email: string) {
    return [...this.users.values()].find((user) => user.email === email);
  }
  async getUserById(id: string) {
    return this.users.get(id);
  }
  async getUserByUsername(username: string) {
    return [...this.users.values()].find((user) => user.username === username);
  }
  async createUser(user: User, credential: Credential) {
    this.assertUsernameFree(user);
    this.users.set(user.id, user);
    this.credentials.set(user.id, credential);
  }
  async updateUser(user: User) {
    this.assertUsernameFree(user);
    this.users.set(user.id, user);
  }
  /** Stands in for the unique index MongoRepository relies on. */
  private assertUsernameFree(user: User) {
    for (const existing of this.users.values())
      if (existing.username === user.username && existing.id !== user.id) throw new UsernameTakenError(user.username);
  }
  async replaceRecoveryCodes(userId: string, codes: RecoveryCode[]) {
    for (const [key, code] of this.recoveryCodes) if (code.userId === userId) this.recoveryCodes.delete(key);
    for (const code of codes) this.recoveryCodes.set(code.id, code);
  }
  async listRecoveryCodes(userId: string) {
    return [...this.recoveryCodes.values()].filter((code) => code.userId === userId);
  }
  async consumeRecoveryCode(userId: string, codeHash: string) {
    const match = [...this.recoveryCodes.values()].find(
      (code) => code.userId === userId && code.codeHash === codeHash && !code.usedAt,
    );
    if (!match) return undefined;
    const used = { ...match, usedAt: new Date() };
    this.recoveryCodes.set(match.id, used);
    return used;
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
  async getOrganization(orgId: string) {
    return this.orgs.get(orgId);
  }
  async getOrganizationByJoinCode(joinCode: string) {
    return [...this.orgs.values()].find((org) => org.joinCode === joinCode);
  }
  async createOrganization(org: Organization, owner: Membership) {
    this.orgs.set(org.id, org);
    this.memberships.set(owner.id, owner);
  }
  async updateOrganization(org: Organization) {
    this.orgs.set(org.id, org);
  }
  async getMembership(orgId: string, userId: string) {
    return [...this.memberships.values()].find(
      (membership) => membership.orgId === orgId && membership.userId === userId,
    );
  }
  async updateMembership(membership: Membership) {
    this.memberships.set(membership.id, membership);
  }
  async listMemberships(orgId: string) {
    return [...this.memberships.values()]
      .filter((membership) => membership.orgId === orgId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  async createMembership(membership: Membership) {
    this.memberships.set(membership.id, membership);
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
  async listRoomMemberships(roomId: string) {
    return [...this.roomMemberships.values()]
      .filter((membership) => membership.roomId === roomId)
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  }
  async createRoomMembership(membership: RoomMembership) {
    this.roomMemberships.set(membership.id, membership);
  }
  async deleteRoomMembership(roomId: string, userId: string) {
    const existing = [...this.roomMemberships.values()].find(
      (membership) => membership.roomId === roomId && membership.userId === userId,
    );
    if (existing) this.roomMemberships.delete(existing.id);
  }
  async createCalendarEvent(event: CalendarEvent) {
    this.calendarEvents.set(event.id, event);
  }
  async listCalendarEvents(orgId: string, from?: Date, to?: Date) {
    return [...this.calendarEvents.values()]
      .filter((event) => event.orgId === orgId && (!from || event.endsAt >= from) && (!to || event.startsAt <= to))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
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
  async listOAuthClients() {
    return [...this.clients.values()]
      .filter((client) => client.isFirstParty)
      .sort((a, b) => a.name.localeCompare(b.name));
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
    if (this.roomEvents.some((existing) => existing.id === event.id)) return;
    this.roomEvents.push(event);
  }
  async listRoomEvents(roomId: string, options?: { limit: number; before?: Date }) {
    const matching = this.roomEvents
      .filter((event) => event.roomId === roomId && (!options?.before || event.createdAt < options.before))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    // Take from the end: the newest page, still handed back oldest-first.
    return options?.limit === undefined ? matching : matching.slice(-options.limit);
  }
  async listRoomEventsForRooms(roomIds: string[], options?: { limit: number }) {
    const allowed = new Set(roomIds);
    const matching = this.roomEvents
      .filter((event) => allowed.has(event.roomId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return options?.limit === undefined ? matching : matching.slice(0, options.limit);
  }
  async writeAudit(log: AuditLog) {
    this.audits.push(log);
  }
  async incrementRateLimit(key: string, windowMs: number) {
    const current = this.rateLimits.get(key);
    const timestamp = Date.now();
    const entry =
      !current || current.resetAt.getTime() <= timestamp
        ? { key, count: 0, resetAt: new Date(timestamp + windowMs) }
        : current;
    entry.count += 1;
    this.rateLimits.set(key, entry);
    return entry;
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
    private calendarEvents: Collection<CalendarEvent>,
    private pats: Collection<PersonalAccessToken>,
    private clients: Collection<OAuthClient>,
    private authCodes: Collection<AuthorizationCode>,
    private refreshTokens: Collection<RefreshToken>,
    private roomEvents: Collection<RoomEvent>,
    private audits: Collection<AuditLog>,
    private rateLimits: Collection<RateLimitEntry>,
    private recoveryCodes: Collection<RecoveryCode>,
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
      db.collection<RoomEvent>("room_events").createIndex({ id: 1 }, { unique: true }),
      db.collection<CalendarEvent>("calendar_events").createIndex({ orgId: 1, startsAt: 1 }),
      db.collection<Membership>("memberships").createIndex({ orgId: 1, userId: 1 }, { unique: true }),
      db.collection<Organization>("orgs").createIndex({ joinCode: 1 }, { unique: true }),
      db.collection<RoomMembership>("room_members").createIndex({ roomId: 1, userId: 1 }, { unique: true }),
      db.collection<OAuthClient>("oauth_clients").updateOne(
        { id: "threadline-web" },
        // redirectUris (and the rest) must stay in sync with the current WEB_ORIGIN on
        // every boot — $setOnInsert only writes them once, so a later WEB_ORIGIN change
        // (e.g. moving off a local/staging domain) would silently strand this seeded
        // client on its original, now-wrong, redirect URI forever.
        (({ createdAt, ...rest }) => ({ $set: rest, $setOnInsert: { createdAt } }))(
          firstPartyWebClient(webRedirectUri),
        ),
        { upsert: true },
      ),
      db.collection<RateLimitEntry>("rate_limits").createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection<RecoveryCode>("recovery_codes").createIndex({ userId: 1 }),
      db.collection<RecoveryCode>("recovery_codes").createIndex({ userId: 1, codeHash: 1 }, { unique: true }),
    ]);
    await ensureUniqueUsernameIndex(db);
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
      db.collection("calendar_events"),
      db.collection("personal_access_tokens"),
      db.collection("oauth_clients"),
      db.collection("auth_codes"),
      db.collection("refresh_tokens"),
      db.collection("room_events"),
      db.collection("audit_logs"),
      db.collection("rate_limits"),
      db.collection("recovery_codes"),
    );
  }

  async getUserByEmail(email: string) {
    return (await this.users.findOne({ email })) ?? undefined;
  }
  async getUserById(id: string) {
    return (await this.users.findOne({ id })) ?? undefined;
  }
  async getUserByUsername(username: string) {
    return (await this.users.findOne({ username })) ?? undefined;
  }
  async createUser(user: User, credential: Credential) {
    try {
      await this.users.insertOne(user);
    } catch (error) {
      if (isDuplicateUsernameError(error)) throw new UsernameTakenError(user.username);
      throw error;
    }
    await this.credentials.insertOne(credential);
  }
  async updateUser(user: User) {
    try {
      await this.users.replaceOne({ id: user.id }, user);
    } catch (error) {
      if (isDuplicateUsernameError(error)) throw new UsernameTakenError(user.username);
      throw error;
    }
  }
  async replaceRecoveryCodes(userId: string, codes: RecoveryCode[]) {
    // Regenerating invalidates every previous code, so the delete and the insert
    // belong together — a crash between them must not leave the account with no
    // way back in.
    await this.recoveryCodes.deleteMany({ userId });
    if (codes.length) await this.recoveryCodes.insertMany(codes);
  }
  async listRecoveryCodes(userId: string) {
    return this.recoveryCodes.find({ userId }).toArray();
  }
  async consumeRecoveryCode(userId: string, codeHash: string) {
    // findOneAndUpdate, not find-then-update: two requests presenting the same code
    // must not both succeed, and only the driver's atomic match can guarantee that.
    const consumed = await this.recoveryCodes.findOneAndUpdate(
      { userId, codeHash, usedAt: { $exists: false } },
      { $set: { usedAt: new Date() } },
      { returnDocument: "after" },
    );
    return consumed ?? undefined;
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
  async getOrganization(orgId: string) {
    return (await this.orgs.findOne({ id: orgId })) ?? undefined;
  }
  async getOrganizationByJoinCode(joinCode: string) {
    return (await this.orgs.findOne({ joinCode })) ?? undefined;
  }
  async createOrganization(org: Organization, owner: Membership) {
    await this.orgs.insertOne(org);
    await this.memberships.insertOne(owner);
  }
  async updateOrganization(org: Organization) {
    await this.orgs.replaceOne({ id: org.id }, org);
  }
  async getMembership(orgId: string, userId: string) {
    return (await this.memberships.findOne({ orgId, userId })) ?? undefined;
  }
  async updateMembership(membership: Membership) {
    await this.memberships.replaceOne({ id: membership.id }, membership);
  }
  async listMemberships(orgId: string) {
    return this.memberships.find({ orgId }).sort({ createdAt: 1 }).toArray();
  }
  async createMembership(membership: Membership) {
    await this.memberships.insertOne(membership);
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
  async listRoomMemberships(roomId: string) {
    return this.roomMemberships.find({ roomId }).sort({ joinedAt: 1 }).toArray();
  }
  async createRoomMembership(membership: RoomMembership) {
    await this.roomMemberships.insertOne(membership);
  }
  async deleteRoomMembership(roomId: string, userId: string) {
    await this.roomMemberships.deleteOne({ roomId, userId });
  }
  async createCalendarEvent(event: CalendarEvent) {
    await this.calendarEvents.insertOne(event);
  }
  async listCalendarEvents(orgId: string, from?: Date, to?: Date) {
    const filter: { orgId: string; startsAt?: { $lte: Date }; endsAt?: { $gte: Date } } = { orgId };
    if (to) filter.startsAt = { $lte: to };
    if (from) filter.endsAt = { $gte: from };
    return this.calendarEvents.find(filter).sort({ startsAt: 1 }).toArray();
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
  async listOAuthClients() {
    return this.clients.find({ isFirstParty: true }).sort({ name: 1 }).toArray();
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
    await this.roomEvents.updateOne({ id: event.id }, { $setOnInsert: event }, { upsert: true });
  }
  async listRoomEvents(roomId: string, options?: { limit: number; before?: Date }) {
    if (options?.limit === undefined) return this.roomEvents.find({ roomId }).sort({ createdAt: 1 }).toArray();
    // Sorted descending so the limit selects the newest page, then reversed back to
    // the oldest-first order every caller expects. The { roomId, createdAt } index
    // already covers this, so it is a range scan rather than a full collection read.
    const newestFirst = await this.roomEvents
      .find({ roomId, ...(options.before ? { createdAt: { $lt: options.before } } : {}) })
      .sort({ createdAt: -1 })
      .limit(options.limit)
      .toArray();
    return newestFirst.reverse();
  }
  async listRoomEventsForRooms(roomIds: string[], options?: { limit: number }) {
    if (!roomIds.length) return [];
    const cursor = this.roomEvents.find({ roomId: { $in: roomIds } }).sort({ createdAt: -1 });
    return (options?.limit === undefined ? cursor : cursor.limit(options.limit)).toArray();
  }
  async writeAudit(log: AuditLog) {
    await this.audits.insertOne(log);
  }
  async incrementRateLimit(key: string, windowMs: number): Promise<RateLimitEntry> {
    const timestamp = new Date();
    const freshResetAt = new Date(timestamp.getTime() + windowMs);
    const result = await this.rateLimits.findOneAndUpdate(
      { key },
      [
        {
          $set: {
            resetAt: {
              $cond: [{ $lte: ["$resetAt", timestamp] }, freshResetAt, { $ifNull: ["$resetAt", freshResetAt] }],
            },
            count: { $cond: [{ $lte: ["$resetAt", timestamp] }, 1, { $add: [{ $ifNull: ["$count", 0] }, 1] }] },
          },
        },
      ],
      { upsert: true, returnDocument: "after" },
    );
    // Upsert always returns the post-update document; the fallback is unreachable in
    // practice but keeps this typed without an assertion.
    return result ?? { key, count: 1, resetAt: freshResetAt };
  }
  async close() {
    await this.client.close();
  }
}
