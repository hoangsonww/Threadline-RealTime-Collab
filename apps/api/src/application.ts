import { createHash } from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { z } from "zod";
import { apiDocsCsp, renderRedocDocs, renderSwaggerDocs } from "./api-docs.js";
import { scopes, type Organization, type Scope, type Session, type User } from "./domain.js";
import { createOpenApiDocument } from "./openapi.js";
import { canInviteToOrganization, canOrganization, canRoom, effectiveRoomRole } from "./policy.js";
import type { Repository } from "./repository.js";
import {
  digest,
  generateJoinCode,
  hashPassword,
  id,
  now,
  opaqueToken,
  pkceChallenge,
  publicUser,
  verifyPassword,
} from "./security.js";
import type { OidcSigner } from "./security.js";

const sessionCookie = "threadline_session";
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const refreshLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const passwordSchema = z.string().min(10, "Password must contain at least 10 characters.").max(128);
const emailSchema = z
  .string()
  .email()
  .transform((value) => value.toLowerCase());
const scopeSchema = z.array(z.enum(scopes)).min(1).max(scopes.length);

type AppOptions = {
  repository: Repository;
  issuer: string;
  webOrigin: string;
  additionalWebOrigins?: string[];
  secureCookies: boolean;
  ticketSecret: string;
  ingestSecret: string;
  signer: OidcSigner;
  actionUrl: (type: "password_reset" | "email_verification", token: string) => string;
  deliverAccountAction?: (input: {
    type: "password_reset" | "email_verification";
    recipient: string;
    displayName: string;
    actionUrl: string;
  }) => Promise<void>;
  enableHttpLogs?: boolean;
};

type SessionAuthContext = { kind: "session"; user: User; session: Session };
type PatAuthContext = { kind: "pat"; user: User; token: { id: string; scopes: Scope[] } };
type AuthContext = SessionAuthContext | PatAuthContext;

const ipHash = (request: Request) =>
  createHash("sha256")
    .update(request.ip || "")
    .digest("hex")
    .slice(0, 24);

function clientError(response: Response, status: number, error: string, message: string) {
  return response.status(status).json({ error, message });
}

function isLoopbackHttpOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

/** Build the configured Express application without starting a network listener. */
export function createApp(options: AppOptions, app = express()) {
  const allowedWebOrigins = new Set([options.webOrigin, ...(options.additionalWebOrigins ?? [])]);
  const insecureLoopbackOrigins = new Set([...allowedWebOrigins].filter(isLoopbackHttpOrigin));
  app.set("trust proxy", 1);
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || allowedWebOrigins.has(origin)),
      credentials: true,
    }),
  );
  app.use(
    pinoHttp({
      enabled: options.enableHttpLogs ?? true,
      redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Backed by the repository (not local memory) because serverless deployments run
  // many concurrent, short-lived instances that would otherwise each keep their own
  // uncoordinated counters, making an in-process Map an unreliable, easily-bypassed limit.
  const rateLimit =
    (limit: number, windowMs: number) => async (request: Request, response: Response, next: NextFunction) => {
      try {
        // request.path is relative to this middleware's mount point (Express rebases
        // it inside app.use), so an exact-path mount always sees "/" here regardless
        // of which route matched — baseUrl is the literal mounted path instead, which
        // is what actually distinguishes one rate-limited route from another.
        const key = `${request.baseUrl}:${ipHash(request)}`;
        const bucket = await options.repository.incrementRateLimit(key, windowMs);
        if (bucket.count > limit) {
          response.set("Retry-After", String(Math.ceil((bucket.resetAt.getTime() - Date.now()) / 1000)));
          return clientError(response, 429, "rate_limited", "Too many attempts. Please try again shortly.");
        }
        next();
      } catch (error) {
        next(error);
      }
    };
  app.use("/v1/auth/login", rateLimit(12, 15 * 60 * 1000));
  app.use("/v1/auth/register", rateLimit(8, 60 * 60 * 1000));
  app.use("/v1/auth/password-reset/request", rateLimit(5, 60 * 60 * 1000));
  app.use("/v1/auth/email-verification/request", rateLimit(5, 60 * 60 * 1000));
  app.use((request, response, next) => {
    const isUnsafe = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    const origin = request.get("origin");
    if (isUnsafe && request.cookies[sessionCookie] && origin && !allowedWebOrigins.has(origin))
      return clientError(response, 403, "csrf_rejected", "This browser request did not originate from Threadline.");
    next();
  });

  const authenticate = async (request: Request): Promise<SessionAuthContext | undefined> => {
    const token = request.cookies[sessionCookie] as string | undefined;
    if (!token) return undefined;
    const session = await options.repository.getSessionByTokenHash(digest(token));
    if (!session || session.revokedAt || session.expiresAt <= now()) return undefined;
    const user = await options.repository.getUserById(session.userId);
    if (!user) return undefined;
    session.lastUsedAt = now();
    await options.repository.updateSession(session);
    return { kind: "session", user, session };
  };

  const authenticatePat = async (request: Request): Promise<PatAuthContext | undefined> => {
    const [scheme, rawToken] = request.get("authorization")?.split(" ") ?? [];
    if (scheme !== "Bearer" || !rawToken?.startsWith("tl_pat_")) return undefined;
    const token = await options.repository.getPatByHash(digest(rawToken));
    if (!token || token.revokedAt || (token.expiresAt && token.expiresAt <= now())) return undefined;
    const user = await options.repository.getUserById(token.userId);
    if (!user) return undefined;
    token.lastUsedAt = now();
    await options.repository.updatePat(token);
    return { kind: "pat", user, token: { id: token.id, scopes: token.scopes } };
  };

  const requireUser = async (request: Request, response: Response): Promise<SessionAuthContext | undefined> => {
    const context = await authenticate(request);
    if (!context) clientError(response, 401, "unauthorized", "A valid session is required.");
    return context;
  };

  const requireScope = async (request: Request, response: Response, scope: Scope): Promise<AuthContext | undefined> => {
    const context = (await authenticate(request)) ?? (await authenticatePat(request));
    if (!context) {
      clientError(response, 401, "unauthorized", "A valid session or personal access token is required.");
      return undefined;
    }
    if (context.kind === "pat" && !context.token.scopes.includes(scope) && !context.token.scopes.includes("admin:*")) {
      clientError(response, 403, "insufficient_scope", `The ${scope} scope is required for this action.`);
      return undefined;
    }
    return context;
  };

  const shouldUseSecureCookie = (request: Request) =>
    options.secureCookies && !insecureLoopbackOrigins.has(request.get("origin") ?? "");

  const sessionCookieOptions = (request: Request) => ({
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax" as const,
    path: "/",
  });

  const setSessionCookie = (request: Request, response: Response, token: string) =>
    response.cookie(sessionCookie, token, {
      ...sessionCookieOptions(request),
      maxAge: sessionLifetimeMs,
    });

  const createSession = async (user: User, request: Request) => {
    const rawToken = opaqueToken();
    const session: Session = {
      id: id(),
      userId: user.id,
      refreshTokenHash: digest(rawToken),
      userAgent: request.get("user-agent")?.slice(0, 512),
      ipHash: ipHash(request),
      createdAt: now(),
      expiresAt: new Date(Date.now() + sessionLifetimeMs),
      lastUsedAt: now(),
    };
    await options.repository.createSession(session);
    return rawToken;
  };

  const issueAccountAction = async (type: "password_reset" | "email_verification", user: User) => {
    const rawToken = opaqueToken(36);
    await options.repository.createAccountActionToken({
      tokenHash: digest(rawToken),
      userId: user.id,
      type,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdAt: now(),
    });
    if (options.deliverAccountAction)
      await options.deliverAccountAction({
        type,
        recipient: user.email,
        displayName: user.displayName,
        actionUrl: options.actionUrl(type, rawToken),
      });
  };

  const roomAccess = async (roomId: string, userId: string) => {
    const room = await options.repository.getRoom(roomId);
    if (!room) return undefined;
    const [membership, roomMembership] = await Promise.all([
      options.repository.getMembership(room.orgId, userId),
      options.repository.getRoomMembership(room.id, userId),
    ]);
    return { room, membership, roomMembership };
  };

  // The join code is deliberately never included here — it's only ever returned by
  // the dedicated, permission-checked GET /v1/orgs/:orgId/invite endpoint, so a
  // member without invite permission can never read it off /v1/auth/me or GET /v1/orgs.
  const organizationsForUser = async (userId: string) => {
    const organizations = await options.repository.getOrganizationsForUser(userId);
    return Promise.all(
      organizations.map(async (organization) => {
        const { joinCode: _joinCode, ...publicOrg } = organization;
        const membership = await options.repository.getMembership(organization.id, userId);
        return membership ? { ...publicOrg, role: membership.role, attributes: membership.attributes } : publicOrg;
      }),
    );
  };

  // Collisions are astronomically unlikely at 8 characters from a 32-symbol alphabet
  // (~1.1 trillion combinations), but the check costs one indexed lookup and turns
  // "astronomically unlikely" into "provably impossible," so it's cheap to just do.
  const uniqueJoinCode = async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = generateJoinCode();
      if (!(await options.repository.getOrganizationByJoinCode(candidate))) return candidate;
    }
    throw new Error("Could not generate a unique join code.");
  };

  const apiOrigin = (request: Request) => `${request.protocol}://${request.get("host")}`;
  const sendDocs = (response: Response, html: string) =>
    response
      .set("Content-Security-Policy", apiDocsCsp)
      .set("Cache-Control", "public, max-age=300")
      .type("html")
      .send(html);

  app.get("/", (_request, response) => response.redirect(302, "/api-docs"));
  app.get("/api-docs", (_request, response) => sendDocs(response, renderSwaggerDocs()));
  app.get("/api-docs/redoc", (_request, response) => sendDocs(response, renderRedocDocs()));
  app.get("/openapi.json", (request, response) =>
    response
      .set("Cache-Control", "no-store")
      .json(createOpenApiDocument({ serverUrl: apiOrigin(request), issuer: options.issuer })),
  );
  app.get("/health", (_request, response) => response.json({ status: "ok", service: "threadline-api" }));

  app.post("/v1/auth/register", async (request, response, next) => {
    try {
      const input = z
        .object({
          email: emailSchema,
          username: z
            .string()
            .trim()
            .min(3)
            .max(32)
            .regex(/^[a-z0-9-]+$/i),
          displayName: z.string().trim().min(2).max(80),
          password: passwordSchema,
        })
        .parse(request.body);
      if (await options.repository.getUserByEmail(input.email))
        return clientError(response, 409, "email_in_use", "An account already exists for this email.");
      const user: User = {
        id: id(),
        email: input.email,
        username: input.username.toLowerCase(),
        displayName: input.displayName,
        createdAt: now(),
        updatedAt: now(),
      };
      await options.repository.createUser(user, {
        userId: user.id,
        passwordHash: await hashPassword(input.password),
        passwordUpdatedAt: now(),
      });
      // Deliberately does not create an organization here. A brand-new account
      // belongs to nothing until the person explicitly creates or joins one on
      // /onboarding — see POST /v1/orgs and POST /v1/join below.
      const rawToken = await createSession(user, request);
      await options.repository.writeAudit({
        id: id(),
        actorId: user.id,
        action: "auth.register",
        targetType: "user",
        targetId: user.id,
        createdAt: now(),
      });
      await issueAccountAction("email_verification", user);
      setSessionCookie(request, response, rawToken)
        .status(201)
        .json({ user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/orgs", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "orgs:write");
      if (!context) return;
      const input = z.object({ name: z.string().trim().min(2).max(80) }).parse(request.body);
      const org: Organization = {
        id: id(),
        name: input.name,
        slug: `${input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}-${context.user.id.slice(0, 6)}`,
        joinCode: await uniqueJoinCode(),
        allowMemberInvites: false,
        createdAt: now(),
      };
      await options.repository.createOrganization(org, {
        id: id(),
        orgId: org.id,
        userId: context.user.id,
        role: "owner",
        createdAt: now(),
      });
      await options.repository.writeAudit({
        id: id(),
        actorId: context.user.id,
        action: "org.create",
        targetType: "organization",
        targetId: org.id,
        createdAt: now(),
      });
      const { joinCode: _joinCode, ...publicOrg } = org;
      response.status(201).json({ organization: { ...publicOrg, role: "owner" as const } });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/join", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "orgs:write");
      if (!context) return;
      const input = z
        .object({
          code: z
            .string()
            .trim()
            .transform((value) => value.toUpperCase().replace(/\s+/g, "")),
        })
        .parse(request.body);
      const org = await options.repository.getOrganizationByJoinCode(input.code);
      if (!org) return clientError(response, 404, "invalid_code", "That invite code doesn't match any workspace.");
      if (await options.repository.getMembership(org.id, context.user.id))
        return clientError(response, 409, "already_member", "You already belong to this workspace.");
      const membership = {
        id: id(),
        orgId: org.id,
        userId: context.user.id,
        role: "member" as const,
        createdAt: now(),
      };
      await options.repository.createMembership(membership);
      await options.repository.writeAudit({
        id: id(),
        actorId: context.user.id,
        action: "org.member_joined",
        targetType: "membership",
        targetId: membership.id,
        metadata: { orgId: org.id, via: "join_code" },
        createdAt: now(),
      });
      const { joinCode: _joinCode, ...publicOrg } = org;
      response.status(201).json({ organization: { ...publicOrg, role: membership.role } });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/login", async (request, response, next) => {
    try {
      const input = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).parse(request.body);
      const user = await options.repository.getUserByEmail(input.email);
      const credential = user ? await options.repository.getCredential(user.id) : undefined;
      if (!user || !credential || !(await verifyPassword(credential.passwordHash, input.password)))
        return clientError(response, 401, "invalid_credentials", "Email or password is incorrect.");
      const rawToken = await createSession(user, request);
      await options.repository.writeAudit({
        id: id(),
        actorId: user.id,
        action: "auth.login",
        targetType: "session",
        createdAt: now(),
      });
      setSessionCookie(request, response, rawToken).json({ user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/logout", async (request, response, next) => {
    try {
      const context = await authenticate(request);
      if (context) {
        context.session.revokedAt = now();
        await options.repository.updateSession(context.session);
      }
      response.clearCookie(sessionCookie, sessionCookieOptions(request)).status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/password", async (request, response, next) => {
    try {
      const context = await requireUser(request, response);
      if (!context) return;
      const input = z
        .object({ currentPassword: z.string().min(1).max(128), password: passwordSchema })
        .parse(request.body);
      const credential = await options.repository.getCredential(context.user.id);
      if (!credential || !(await verifyPassword(credential.passwordHash, input.currentPassword)))
        return clientError(response, 401, "invalid_credentials", "Your current password is incorrect.");
      credential.passwordHash = await hashPassword(input.password);
      credential.passwordUpdatedAt = now();
      await options.repository.updateCredential(credential);
      const sessions = await options.repository.listSessions(context.user.id);
      await Promise.all(
        sessions
          .filter((session) => session.id !== context.session.id && !session.revokedAt)
          .map(async (session) => {
            session.revokedAt = now();
            await options.repository.updateSession(session);
          }),
      );
      await options.repository.writeAudit({
        id: id(),
        actorId: context.user.id,
        action: "auth.password_change",
        targetType: "user",
        targetId: context.user.id,
        createdAt: now(),
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/password-reset/request", async (request, response, next) => {
    try {
      const input = z.object({ email: emailSchema }).parse(request.body);
      const user = await options.repository.getUserByEmail(input.email);
      if (user) {
        await issueAccountAction("password_reset", user);
        await options.repository.writeAudit({
          id: id(),
          actorId: user.id,
          action: "auth.password_reset_requested",
          targetType: "user",
          targetId: user.id,
          createdAt: now(),
        });
      }
      response.status(202).json({ message: "If an account exists for that email, a recovery link is on its way." });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/password-reset/confirm", async (request, response, next) => {
    try {
      const input = z.object({ token: z.string().min(20), password: passwordSchema }).parse(request.body);
      const action = await options.repository.consumeAccountActionToken(digest(input.token), "password_reset");
      if (!action || action.expiresAt <= now())
        return clientError(response, 400, "invalid_token", "This recovery link is invalid or has expired.");
      const credential = await options.repository.getCredential(action.userId);
      if (!credential)
        return clientError(response, 400, "invalid_token", "This recovery link is invalid or has expired.");
      credential.passwordHash = await hashPassword(input.password);
      credential.passwordUpdatedAt = now();
      await options.repository.updateCredential(credential);
      const sessions = await options.repository.listSessions(action.userId);
      await Promise.all(
        sessions.map(async (session) => {
          session.revokedAt = now();
          await options.repository.updateSession(session);
        }),
      );
      await options.repository.writeAudit({
        id: id(),
        actorId: action.userId,
        action: "auth.password_reset_completed",
        targetType: "user",
        targetId: action.userId,
        createdAt: now(),
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/email-verification/request", async (request, response, next) => {
    try {
      const context = await requireUser(request, response);
      if (!context) return;
      const credential = await options.repository.getCredential(context.user.id);
      if (!credential?.emailVerifiedAt) await issueAccountAction("email_verification", context.user);
      response.status(202).json({ message: "If needed, a verification link is on its way." });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/email-verification/confirm", async (request, response, next) => {
    try {
      const input = z.object({ token: z.string().min(20) }).parse(request.body);
      const action = await options.repository.consumeAccountActionToken(digest(input.token), "email_verification");
      if (!action || action.expiresAt <= now())
        return clientError(response, 400, "invalid_token", "This verification link is invalid or has expired.");
      const credential = await options.repository.getCredential(action.userId);
      if (!credential)
        return clientError(response, 400, "invalid_token", "This verification link is invalid or has expired.");
      credential.emailVerifiedAt = now();
      await options.repository.updateCredential(credential);
      await options.repository.writeAudit({
        id: id(),
        actorId: action.userId,
        action: "auth.email_verified",
        targetType: "user",
        targetId: action.userId,
        createdAt: now(),
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/auth/me", async (request, response, next) => {
    try {
      const context = await requireUser(request, response);
      if (!context) return;
      const credential = await options.repository.getCredential(context.user.id);
      response.json({
        user: { ...publicUser(context.user), emailVerified: Boolean(credential?.emailVerifiedAt) },
        organizations: await organizationsForUser(context.user.id),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/sessions", async (request, response, next) => {
    try {
      const context = await requireUser(request, response);
      if (!context) return;
      const sessions = await options.repository.listSessions(context.user.id);
      response.json({
        sessions: sessions.map(({ refreshTokenHash: _token, ipHash: _ip, ...session }) => ({
          ...session,
          isCurrent: session.id === context.session.id,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/v1/sessions/:sessionId", async (request, response, next) => {
    try {
      const context = await requireUser(request, response);
      if (!context) return;
      const session = await options.repository.getSession(request.params.sessionId);
      if (!session || session.userId !== context.user.id)
        return clientError(response, 404, "not_found", "Session was not found.");
      session.revokedAt = now();
      await options.repository.updateSession(session);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/orgs", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "orgs:read");
      if (context) response.json({ organizations: await organizationsForUser(context.user.id) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/orgs/:orgId/rooms", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "rooms:read");
      if (!context) return;
      const membership = await options.repository.getMembership(request.params.orgId, context.user.id);
      if (!canOrganization(membership, "read"))
        return clientError(response, 403, "forbidden", "You do not belong to this organization.");
      const rooms = await options.repository.listRooms(request.params.orgId);
      const visible = await Promise.all(
        rooms.map(async (room) => {
          const roomMembership = await options.repository.getRoomMembership(room.id, context.user.id);
          return canRoom(membership, room, roomMembership, "read") ? room : undefined;
        }),
      );
      response.json({ rooms: visible.filter((room): room is NonNullable<typeof room> => Boolean(room)) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/orgs/:orgId/rooms", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "rooms:write");
      if (!context) return;
      const membership = await options.repository.getMembership(request.params.orgId, context.user.id);
      if (!canOrganization(membership, "create_room"))
        return clientError(response, 403, "forbidden", "You do not have permission to create rooms.");
      const input = z
        .object({
          name: z.string().trim().min(2).max(100),
          description: z.string().trim().max(300).optional(),
          visibility: z.enum(["organization", "restricted"]).default("organization"),
          classification: z.enum(["internal", "confidential"]).default("internal"),
        })
        .parse(request.body);
      const room = {
        id: id(),
        orgId: request.params.orgId,
        name: input.name,
        description: input.description,
        visibility: input.visibility,
        classification: input.classification,
        createdBy: context.user.id,
        createdAt: now(),
        updatedAt: now(),
      };
      await options.repository.createRoom(room, {
        id: id(),
        roomId: room.id,
        userId: context.user.id,
        role: "owner",
        joinedAt: now(),
      });
      await options.repository.writeAudit({
        id: id(),
        actorId: context.user.id,
        action: "room.create",
        targetType: "room",
        targetId: room.id,
        metadata: { orgId: room.orgId, visibility: room.visibility, classification: room.classification },
        createdAt: now(),
      });
      await options.repository.writeRoomEvent({
        id: id(),
        roomId: room.id,
        type: "room.created",
        payload: { name: room.name, visibility: room.visibility },
        actorId: context.user.id,
        createdAt: now(),
      });
      response.status(201).json({ room });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/rooms/:roomId/ticket", async (request, response, next) => {
    try {
      const context = await requireUser(request, response);
      if (!context) return;
      const access = await roomAccess(request.params.roomId, context.user.id);
      if (!access) return clientError(response, 404, "not_found", "Room was not found.");
      if (!canRoom(access.membership, access.room, access.roomMembership, "join_live"))
        return clientError(response, 403, "forbidden", "You do not have access to this room.");
      const ticket = await options.signer.signRoomTicket({
        issuer: options.issuer,
        secret: new TextEncoder().encode(options.ticketSecret),
        user: context.user,
        roomId: access.room.id,
        role: effectiveRoomRole(access.membership, access.room, access.roomMembership) ?? "viewer",
      });
      response.json({ ticket, roomId: access.room.id, expiresIn: 120 });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/rooms/:roomId", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "rooms:read");
      if (!context) return;
      const access = await roomAccess(request.params.roomId, context.user.id);
      if (!access) return clientError(response, 404, "not_found", "Room was not found.");
      if (!canRoom(access.membership, access.room, access.roomMembership, "read"))
        return clientError(response, 403, "forbidden", "You do not have access to this room.");
      response.json({
        room: access.room,
        role: effectiveRoomRole(access.membership, access.room, access.roomMembership),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/rooms/:roomId/events", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "rooms:read");
      if (!context) return;
      const access = await roomAccess(request.params.roomId, context.user.id);
      if (!access) return clientError(response, 404, "not_found", "Room was not found.");
      if (!canRoom(access.membership, access.room, access.roomMembership, "read"))
        return clientError(response, 403, "forbidden", "You do not have access to this room.");
      response.json({ events: await options.repository.listRoomEvents(access.room.id) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/internal/room-events", async (request, response, next) => {
    try {
      if (request.get("x-threadline-ingest") !== options.ingestSecret)
        return clientError(response, 401, "unauthorized", "Invalid room event ingress credential.");
      const input = z
        .object({
          roomId: z.string().uuid(),
          event: z.object({
            type: z.string().min(1).max(100),
            payload: z.unknown(),
            from: z.string().uuid().optional(),
            at: z.string().datetime(),
          }),
        })
        .parse(request.body);
      const access = input.event.from ? await roomAccess(input.roomId, input.event.from) : undefined;
      if (!access || !canRoom(access.membership, access.room, access.roomMembership, "write"))
        return clientError(response, 403, "forbidden", "The event actor cannot write to this room.");
      await options.repository.writeRoomEvent({
        id: id(),
        roomId: input.roomId,
        type: input.event.type,
        payload: input.event.payload,
        actorId: input.event.from,
        createdAt: new Date(input.event.at),
      });
      response.status(202).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/orgs/:orgId/members", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "orgs:read");
      if (!context) return;
      const caller = await options.repository.getMembership(request.params.orgId, context.user.id);
      if (!canOrganization(caller, "read"))
        return clientError(response, 403, "forbidden", "You do not belong to this organization.");
      const memberships = await options.repository.listMemberships(request.params.orgId);
      const members = await Promise.all(
        memberships.map(async (membership) => {
          const user = await options.repository.getUserById(membership.userId);
          return user
            ? {
                ...publicUser(user),
                role: membership.role,
                attributes: membership.attributes,
                joinedAt: membership.createdAt,
              }
            : undefined;
        }),
      );
      response.json({ members: members.filter(Boolean) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/orgs/:orgId/members", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "orgs:write");
      if (!context) return;
      const caller = await options.repository.getMembership(request.params.orgId, context.user.id);
      if (!canOrganization(caller, "manage_members"))
        return clientError(response, 403, "forbidden", "You do not have permission to manage members.");
      const input = z
        .object({
          email: emailSchema,
          role: z.enum(["admin", "member"]).default("member"),
          attributes: z
            .object({
              canCreateRooms: z.boolean().optional(),
              canManageMembers: z.boolean().optional(),
              canSchedule: z.boolean().optional(),
            })
            .optional(),
        })
        .parse(request.body);
      if (input.role === "admin" && caller?.role !== "owner")
        return clientError(response, 403, "forbidden", "Only an organization owner can assign administrator access.");
      const user = await options.repository.getUserByEmail(input.email);
      if (!user)
        return clientError(
          response,
          404,
          "not_found",
          "That person needs a Threadline account before they can be added.",
        );
      if (await options.repository.getMembership(request.params.orgId, user.id))
        return clientError(response, 409, "already_member", "That person already belongs to this organization.");
      const membership = {
        id: id(),
        orgId: request.params.orgId,
        userId: user.id,
        role: input.role,
        attributes: input.attributes,
        createdAt: now(),
      };
      await options.repository.createMembership(membership);
      await options.repository.writeAudit({
        id: id(),
        actorId: context.user.id,
        action: "org.member_add",
        targetType: "membership",
        targetId: membership.id,
        metadata: { orgId: membership.orgId, userId: user.id, role: membership.role },
        createdAt: now(),
      });
      response.status(201).json({
        member: {
          ...publicUser(user),
          role: membership.role,
          attributes: membership.attributes,
          joinedAt: membership.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/orgs/:orgId/invite", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "orgs:read");
      if (!context) return;
      const org = await options.repository.getOrganization(request.params.orgId);
      if (!org) return clientError(response, 404, "not_found", "Organization was not found.");
      const caller = await options.repository.getMembership(request.params.orgId, context.user.id);
      if (!canInviteToOrganization(caller, org))
        return clientError(response, 403, "forbidden", "You do not have permission to view this invite code.");
      response.json({ joinCode: org.joinCode, allowMemberInvites: org.allowMemberInvites });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/orgs/:orgId/invite/regenerate", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "orgs:write");
      if (!context) return;
      const org = await options.repository.getOrganization(request.params.orgId);
      if (!org) return clientError(response, 404, "not_found", "Organization was not found.");
      const caller = await options.repository.getMembership(request.params.orgId, context.user.id);
      if (!canInviteToOrganization(caller, org))
        return clientError(response, 403, "forbidden", "You do not have permission to regenerate this invite code.");
      const updated = { ...org, joinCode: await uniqueJoinCode() };
      await options.repository.updateOrganization(updated);
      await options.repository.writeAudit({
        id: id(),
        actorId: context.user.id,
        action: "org.invite_regenerate",
        targetType: "organization",
        targetId: org.id,
        createdAt: now(),
      });
      response.json({ joinCode: updated.joinCode, allowMemberInvites: updated.allowMemberInvites });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/v1/orgs/:orgId/settings", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "orgs:write");
      if (!context) return;
      const caller = await options.repository.getMembership(request.params.orgId, context.user.id);
      if (!canOrganization(caller, "manage_members"))
        return clientError(response, 403, "forbidden", "You do not have permission to manage this organization.");
      const org = await options.repository.getOrganization(request.params.orgId);
      if (!org) return clientError(response, 404, "not_found", "Organization was not found.");
      const input = z.object({ allowMemberInvites: z.boolean() }).parse(request.body);
      const updated = { ...org, allowMemberInvites: input.allowMemberInvites };
      await options.repository.updateOrganization(updated);
      await options.repository.writeAudit({
        id: id(),
        actorId: context.user.id,
        action: "org.settings_update",
        targetType: "organization",
        targetId: org.id,
        metadata: { allowMemberInvites: input.allowMemberInvites },
        createdAt: now(),
      });
      response.json({ allowMemberInvites: updated.allowMemberInvites });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/v1/orgs/:orgId/members/:userId", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "orgs:write");
      if (!context) return;
      const caller = await options.repository.getMembership(request.params.orgId, context.user.id);
      if (!canOrganization(caller, "manage_members"))
        return clientError(response, 403, "forbidden", "You do not have permission to manage members.");
      const input = z.object({ role: z.enum(["admin", "member"]) }).parse(request.body);
      const targetUserId = z.string().uuid().parse(request.params.userId);
      const target = await options.repository.getMembership(request.params.orgId, targetUserId);
      if (!target) return clientError(response, 404, "not_found", "That person is not a member of this organization.");
      if (target.role === "owner")
        return clientError(response, 400, "cannot_change_owner", "The organization owner's role cannot be changed.");
      if (input.role === "admin" && caller?.role !== "owner")
        return clientError(response, 403, "forbidden", "Only an organization owner can assign administrator access.");
      if (context.user.id === targetUserId && target.role === "admin" && input.role === "member") {
        const memberships = await options.repository.listMemberships(request.params.orgId);
        const otherAdmins = memberships.filter((m) => m.userId !== targetUserId && m.role === "admin");
        if (otherAdmins.length === 0)
          return clientError(
            response,
            400,
            "last_admin",
            "You're the only administrator. Assign another admin before stepping down to member.",
          );
      }
      const updated = { ...target, role: input.role };
      await options.repository.updateMembership(updated);
      await options.repository.writeAudit({
        id: id(),
        actorId: context.user.id,
        action: "org.member_role_changed",
        targetType: "membership",
        targetId: updated.id,
        metadata: { orgId: updated.orgId, userId: targetUserId, role: updated.role, previousRole: target.role },
        createdAt: now(),
      });
      const user = await options.repository.getUserById(targetUserId);
      response.json({
        member: user
          ? { ...publicUser(user), role: updated.role, attributes: updated.attributes, joinedAt: updated.createdAt }
          : undefined,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/rooms/:roomId/members", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "rooms:read");
      if (!context) return;
      const access = await roomAccess(request.params.roomId, context.user.id);
      if (!access) return clientError(response, 404, "not_found", "Room was not found.");
      if (!canRoom(access.membership, access.room, access.roomMembership, "read"))
        return clientError(response, 403, "forbidden", "You do not have access to this room.");
      const memberships = await options.repository.listRoomMemberships(access.room.id);
      const members = await Promise.all(
        memberships.map(async (membership) => {
          const user = await options.repository.getUserById(membership.userId);
          return user ? { ...publicUser(user), role: membership.role, joinedAt: membership.joinedAt } : undefined;
        }),
      );
      response.json({ members: members.filter(Boolean) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/rooms/:roomId/members", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "rooms:write");
      if (!context) return;
      const access = await roomAccess(request.params.roomId, context.user.id);
      if (!access) return clientError(response, 404, "not_found", "Room was not found.");
      if (!canRoom(access.membership, access.room, access.roomMembership, "manage"))
        return clientError(response, 403, "forbidden", "You do not have permission to manage this room.");
      const input = z
        .object({ userId: z.string().uuid(), role: z.enum(["host", "member", "viewer"]).default("member") })
        .parse(request.body);
      const targetOrgMembership = await options.repository.getMembership(access.room.orgId, input.userId);
      if (!targetOrgMembership)
        return clientError(response, 403, "forbidden", "Only organization members can be added to a room.");
      if (await options.repository.getRoomMembership(access.room.id, input.userId))
        return clientError(response, 409, "already_member", "That person already belongs to this room.");
      const membership = { id: id(), roomId: access.room.id, userId: input.userId, role: input.role, joinedAt: now() };
      await options.repository.createRoomMembership(membership);
      response.status(201).json({ membership });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/v1/rooms/:roomId/members/:userId", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "rooms:write");
      if (!context) return;
      const access = await roomAccess(request.params.roomId, context.user.id);
      if (!access) return clientError(response, 404, "not_found", "Room was not found.");
      if (!canRoom(access.membership, access.room, access.roomMembership, "manage"))
        return clientError(response, 403, "forbidden", "You do not have permission to manage this room.");
      const targetUserId = z.string().uuid().parse(request.params.userId);
      const targetMembership = await options.repository.getRoomMembership(access.room.id, targetUserId);
      if (!targetMembership)
        return clientError(response, 404, "not_found", "That person is not a member of this room.");
      if (targetMembership.role === "owner")
        return clientError(response, 400, "cannot_remove_owner", "The room owner cannot be removed this way.");
      await options.repository.deleteRoomMembership(access.room.id, targetUserId);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/orgs/:orgId/calendar", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "orgs:read");
      if (!context) return;
      const membership = await options.repository.getMembership(request.params.orgId, context.user.id);
      if (!canOrganization(membership, "read"))
        return clientError(response, 403, "forbidden", "You do not belong to this organization.");
      const query = z
        .object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() })
        .parse(request.query);
      const events = await options.repository.listCalendarEvents(
        request.params.orgId,
        query.from ? new Date(query.from) : undefined,
        query.to ? new Date(query.to) : undefined,
      );
      const visible = await Promise.all(
        events.map(async (event) => {
          if (!event.roomId) return event;
          const room = await options.repository.getRoom(event.roomId);
          const roomMembership = room
            ? await options.repository.getRoomMembership(room.id, context.user.id)
            : undefined;
          return room && canRoom(membership, room, roomMembership, "read") ? event : undefined;
        }),
      );
      response.json({ events: visible.filter((event): event is NonNullable<typeof event> => Boolean(event)) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/orgs/:orgId/calendar", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "orgs:write");
      if (!context) return;
      const membership = await options.repository.getMembership(request.params.orgId, context.user.id);
      if (!canOrganization(membership, "schedule"))
        return clientError(response, 403, "forbidden", "You do not have permission to schedule this event.");
      const input = z
        .object({
          title: z.string().trim().min(2).max(160),
          description: z.string().trim().max(1000).optional(),
          startsAt: z.string().datetime(),
          endsAt: z.string().datetime(),
          roomId: z.string().uuid().optional(),
        })
        .parse(request.body);
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      if (endsAt <= startsAt)
        return clientError(response, 400, "invalid_schedule", "The event must end after it starts.");
      if (input.roomId) {
        const access = await roomAccess(input.roomId, context.user.id);
        if (
          !access ||
          access.room.orgId !== request.params.orgId ||
          !canRoom(access.membership, access.room, access.roomMembership, "read")
        )
          return clientError(response, 403, "forbidden", "You cannot schedule an event in that room.");
      }
      const event = {
        id: id(),
        orgId: request.params.orgId,
        roomId: input.roomId,
        title: input.title,
        description: input.description,
        startsAt,
        endsAt,
        createdBy: context.user.id,
        createdAt: now(),
        updatedAt: now(),
      };
      await options.repository.createCalendarEvent(event);
      await options.repository.writeAudit({
        id: id(),
        actorId: context.user.id,
        action: "calendar.create",
        targetType: "calendar_event",
        targetId: event.id,
        metadata: { orgId: event.orgId, roomId: event.roomId },
        createdAt: now(),
      });
      response.status(201).json({ event });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/orgs/:orgId/activity", async (request, response, next) => {
    try {
      const context = await requireScope(request, response, "rooms:read");
      if (!context) return;
      const membership = await options.repository.getMembership(request.params.orgId, context.user.id);
      if (!canOrganization(membership, "read"))
        return clientError(response, 403, "forbidden", "You do not belong to this organization.");
      const rooms = await options.repository.listRooms(request.params.orgId);
      const visibleRooms = (
        await Promise.all(
          rooms.map(async (room) => {
            const roomMembership = await options.repository.getRoomMembership(room.id, context.user.id);
            return canRoom(membership, room, roomMembership, "read") ? room : undefined;
          }),
        )
      ).filter((room): room is NonNullable<typeof room> => Boolean(room));
      const events = (await options.repository.listRoomEventsForRooms(visibleRooms.map((room) => room.id))).slice(
        0,
        100,
      );
      response.json({ events, rooms: visibleRooms.map((room) => ({ id: room.id, name: room.name })) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/pats", async (request, response, next) => {
    try {
      const context = await requireUser(request, response);
      if (!context) return;
      const tokens = await options.repository.listPats(context.user.id);
      response.json({ tokens: tokens.map(({ tokenHash: _hash, ...token }) => token) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/pats", async (request, response, next) => {
    try {
      const context = await requireUser(request, response);
      if (!context) return;
      const input = z
        .object({
          label: z.string().trim().min(2).max(80),
          scopes: scopeSchema,
          expiresAt: z.string().datetime().optional(),
        })
        .parse(request.body);
      const raw = `tl_pat_${opaqueToken(30)}`;
      const token = {
        id: id(),
        userId: context.user.id,
        label: input.label,
        tokenHash: digest(raw),
        tokenPrefix: raw.slice(0, 15),
        scopes: input.scopes,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        createdAt: now(),
      };
      await options.repository.createPat(token);
      await options.repository.writeAudit({
        id: id(),
        actorId: context.user.id,
        action: "pat.create",
        targetType: "personal_access_token",
        targetId: token.id,
        createdAt: now(),
      });
      response.status(201).json({ token: { ...token, tokenHash: undefined }, secret: raw });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/v1/pats/:tokenId", async (request, response, next) => {
    try {
      const context = await requireUser(request, response);
      if (!context) return;
      const token = (await options.repository.listPats(context.user.id)).find(
        (item) => item.id === request.params.tokenId,
      );
      if (!token) return clientError(response, 404, "not_found", "Token was not found.");
      token.revokedAt = now();
      await options.repository.updatePat(token);
      await options.repository.writeAudit({
        id: id(),
        actorId: context.user.id,
        action: "pat.revoke",
        targetType: "personal_access_token",
        targetId: token.id,
        createdAt: now(),
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/oidc/clients", async (request, response, next) => {
    try {
      const context = await requireUser(request, response);
      if (!context) return;
      const clients = await options.repository.listOAuthClients();
      response.json({
        clients: clients.map(({ id: clientId, name, redirectUris, allowedScopes, isFirstParty, createdAt }) => ({
          id: clientId,
          name,
          redirectUris,
          allowedScopes,
          isFirstParty,
          createdAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/.well-known/openid-configuration", (_request, response) =>
    response.json({
      issuer: options.issuer,
      authorization_endpoint: `${options.issuer}/oauth/authorize`,
      token_endpoint: `${options.issuer}/oauth/token`,
      revocation_endpoint: `${options.issuer}/oauth/revoke`,
      introspection_endpoint: `${options.issuer}/oauth/introspect`,
      userinfo_endpoint: `${options.issuer}/oauth/userinfo`,
      jwks_uri: `${options.issuer}/oauth/jwks.json`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["openid", "profile", "email", ...scopes],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
    }),
  );
  app.get("/oauth/jwks.json", (_request, response) => response.json(options.signer.getJwks()));

  app.get("/oauth/authorize", async (request, response, next) => {
    try {
      const input = z
        .object({
          response_type: z.literal("code"),
          client_id: z.string().min(1),
          redirect_uri: z.string().url(),
          scope: z.string().min(1),
          state: z.string().min(8).max(2048),
          code_challenge: z.string().min(43).max(128),
          code_challenge_method: z.literal("S256"),
          nonce: z.string().min(8).max(2048).optional(),
        })
        .parse(request.query);
      const client = await options.repository.getOAuthClient(input.client_id);
      if (!client || !client.isFirstParty || !client.redirectUris.includes(input.redirect_uri))
        return clientError(response, 400, "invalid_client", "The OIDC client or redirect URI is not registered.");
      const requestedScopes = input.scope.split(" ").filter(Boolean);
      if (
        !requestedScopes.includes("openid") ||
        requestedScopes.some(
          (scope) => !["openid", "profile", "email"].includes(scope) && !client.allowedScopes.includes(scope as Scope),
        )
      )
        return clientError(response, 400, "invalid_scope", "The requested scopes are not permitted for this client.");
      const context = await authenticate(request);
      if (!context)
        return response.redirect(`${options.webOrigin}/login?returnTo=${encodeURIComponent(request.originalUrl)}`);
      const rawCode = opaqueToken(36);
      const resourceScopes = requestedScopes.filter((scope): scope is Scope => scopes.includes(scope as Scope));
      await options.repository.createAuthorizationCode({
        codeHash: digest(rawCode),
        clientId: client.id,
        userId: context.user.id,
        redirectUri: input.redirect_uri,
        scopes: resourceScopes,
        codeChallenge: input.code_challenge,
        nonce: input.nonce,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });
      await options.repository.writeAudit({
        id: id(),
        actorId: context.user.id,
        action: "oidc.authorize",
        targetType: "oauth_client",
        targetId: client.id,
        metadata: { scopes: requestedScopes },
        createdAt: now(),
      });
      const redirect = new URL(input.redirect_uri);
      redirect.searchParams.set("code", rawCode);
      redirect.searchParams.set("state", input.state);
      response.redirect(redirect.toString());
    } catch (error) {
      next(error);
    }
  });

  app.post("/oauth/token", async (request, response, next) => {
    try {
      const grant = z.string().parse(request.body.grant_type);
      if (grant === "authorization_code") {
        const input = z
          .object({
            grant_type: z.literal("authorization_code"),
            code: z.string().min(20),
            client_id: z.string(),
            redirect_uri: z.string().url(),
            code_verifier: z.string().min(43).max(128),
          })
          .parse(request.body);
        const code = await options.repository.consumeAuthorizationCode(digest(input.code));
        if (
          !code ||
          code.expiresAt <= now() ||
          code.clientId !== input.client_id ||
          code.redirectUri !== input.redirect_uri ||
          code.codeChallenge !== pkceChallenge(input.code_verifier)
        )
          return clientError(response, 400, "invalid_grant", "The authorization code is invalid or expired.");
        const user = await options.repository.getUserById(code.userId);
        if (!user) return clientError(response, 400, "invalid_grant", "The subject no longer exists.");
        const credential = await options.repository.getCredential(user.id);
        const refresh = opaqueToken(36);
        await options.repository.createRefreshToken({
          tokenHash: digest(refresh),
          clientId: code.clientId,
          userId: user.id,
          scopes: code.scopes,
          expiresAt: new Date(Date.now() + refreshLifetimeMs),
          createdAt: now(),
        });
        return response.json({
          token_type: "Bearer",
          access_token: await options.signer.signAccessToken({
            issuer: options.issuer,
            audience: code.clientId,
            user,
            scopes: code.scopes,
          }),
          id_token: await options.signer.signIdToken({
            issuer: options.issuer,
            audience: code.clientId,
            user,
            emailVerified: Boolean(credential?.emailVerifiedAt),
            nonce: code.nonce,
          }),
          refresh_token: refresh,
          expires_in: 900,
          scope: ["openid", "profile", "email", ...code.scopes].join(" "),
        });
      }
      if (grant === "refresh_token") {
        const input = z
          .object({ grant_type: z.literal("refresh_token"), refresh_token: z.string().min(20), client_id: z.string() })
          .parse(request.body);
        const refresh = await options.repository.consumeRefreshToken(digest(input.refresh_token));
        if (!refresh || refresh.expiresAt <= now() || refresh.revokedAt || refresh.clientId !== input.client_id)
          return clientError(response, 400, "invalid_grant", "The refresh token is invalid or expired.");
        const user = await options.repository.getUserById(refresh.userId);
        if (!user) return clientError(response, 400, "invalid_grant", "The subject no longer exists.");
        const rotated = opaqueToken(36);
        await options.repository.createRefreshToken({
          ...refresh,
          tokenHash: digest(rotated),
          createdAt: now(),
          expiresAt: new Date(Date.now() + refreshLifetimeMs),
        });
        return response.json({
          token_type: "Bearer",
          access_token: await options.signer.signAccessToken({
            issuer: options.issuer,
            audience: refresh.clientId,
            user,
            scopes: refresh.scopes,
          }),
          refresh_token: rotated,
          expires_in: 900,
          scope: refresh.scopes.join(" "),
        });
      }
      return clientError(response, 400, "unsupported_grant_type", "This grant type is not enabled.");
    } catch (error) {
      next(error);
    }
  });

  app.post("/oauth/revoke", async (request, response, next) => {
    try {
      const token = z.string().min(20).safeParse(request.body.token);
      if (token.success) await options.repository.consumeRefreshToken(digest(token.data));
      response.status(200).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/oauth/introspect", async (request, response) => {
    const parsed = z.string().min(20).safeParse(request.body.token);
    if (!parsed.success) return response.json({ active: false });
    try {
      const claims = await options.signer.verifyAccessToken(parsed.data, options.issuer);
      return response.json({
        active: true,
        sub: claims.sub,
        scope: claims.scope,
        client_id: claims.aud,
        iss: claims.iss,
        exp: claims.exp,
        iat: claims.iat,
      });
    } catch {
      return response.json({ active: false });
    }
  });

  app.get("/oauth/userinfo", async (request, response) => {
    const [scheme, token] = request.get("authorization")?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token) return response.status(401).json({ error: "invalid_token" });
    try {
      const claims = await options.signer.verifyAccessToken(token, options.issuer);
      const user = claims.sub ? await options.repository.getUserById(claims.sub) : undefined;
      if (!user) return response.status(401).json({ error: "invalid_token" });
      const credential = await options.repository.getCredential(user.id);
      return response.json({
        sub: user.id,
        email: user.email,
        email_verified: Boolean(credential?.emailVerifiedAt),
        preferred_username: user.username,
        name: user.displayName,
      });
    } catch {
      return response.status(401).json({ error: "invalid_token" });
    }
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError)
      return clientError(response, 422, "validation_error", error.issues[0]?.message ?? "Request validation failed.");
    response.status(500).json({ error: "internal_error", message: "An unexpected error occurred." });
  });
  return app;
}
