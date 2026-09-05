import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./application.js";
import { MemoryCache, type Cache } from "./cache.js";
import { MemoryRepository } from "./repository.js";
import { OidcSigner } from "./security.js";

async function registerWithOrg(
  app: Parameters<typeof request.agent>[0],
  user: { email: string; username: string; displayName: string; password?: string },
  orgName: string,
) {
  const agent = request.agent(app);
  const registration = await agent.post("/v1/auth/register").send({
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    password: user.password ?? "correct-horse-battery",
  });
  const org = await agent.post("/v1/orgs").send({ name: orgName });
  return { agent, registration, org };
}

async function createTestApp(
  additionalWebOrigins?: string[],
  secureCookies = false,
  getIceServers?: (
    userId: string,
  ) => Promise<Array<{ urls: string | string[]; username?: string; credential?: string }>>,
  cache?: Cache,
) {
  const signer = await OidcSigner.create();
  const delivered: Array<{ type: string; actionUrl: string }> = [];
  const repository = new MemoryRepository();
  const app = createApp({
    repository,
    cache,
    issuer: "https://id.threadline.test",
    webOrigin: "https://app.threadline.test",
    additionalWebOrigins,
    secureCookies,
    ticketSecret: "test-ticket-secret",
    ingestSecret: "test-ingest-secret",
    signer,
    getIceServers,
    actionUrl: (type, token) => `https://app.threadline.test/${type}?token=${token}`,
    deliverAccountAction: async ({ type, actionUrl }) => {
      delivered.push({ type, actionUrl });
    },
    enableHttpLogs: false,
  });
  return { app, delivered, repository };
}

describe("Threadline identity API", () => {
  it("redirects the API root to CDN-backed Swagger and ReDoc documentation", async () => {
    const { app } = await createTestApp();
    const root = await request(app).get("/");
    expect(root.status).toBe(302);
    expect(root.headers.location).toBe("/api-docs");

    const swagger = await request(app).get("/api-docs");
    expect(swagger.status).toBe(200);
    expect(swagger.headers["content-security-policy"]).toContain("https://cdn.jsdelivr.net");
    expect(swagger.text).toContain("swagger-ui-dist@5");
    expect(swagger.text).toContain("twitter/twemoji@14.0.2");

    const redoc = await request(app).get("/api-docs/redoc");
    expect(redoc.status).toBe(200);
    expect(redoc.text).toContain("redoc@2");

    const specification = await request(app).get("/openapi.json");
    expect(specification.status).toBe(200);
    expect(specification.body.openapi).toBe("3.1.1");
    expect(specification.body.servers[0].url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(Object.keys(specification.body.paths)).toEqual(
      expect.arrayContaining([
        "/v1/auth/register",
        "/v1/orgs/{orgId}/rooms",
        "/v1/rooms/{roomId}/ticket",
        "/v1/pats",
        "/oauth/authorize",
        "/oauth/token",
        "/v1/internal/room-events",
      ]),
    );
  });

  it("permits an explicitly configured local development origin and rejects unknown origins", async () => {
    const { app } = await createTestApp(["http://localhost:3000"]);
    const allowed = await request(app).get("/health").set("origin", "http://localhost:3000");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    const rejected = await request(app).get("/health").set("origin", "https://untrusted.example");
    expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("keeps production cookies secure except through an explicitly allowed loopback proxy", async () => {
    const { app } = await createTestApp(["http://localhost:3000"], true);
    const localRegistration = await request(app).post("/v1/auth/register").set("origin", "http://localhost:3000").send({
      email: "local-proxy@example.com",
      username: "local-proxy",
      displayName: "Local Proxy",
      password: "correct-horse-battery",
    });
    expect(localRegistration.status).toBe(201);
    expect(localRegistration.headers["set-cookie"][0]).not.toContain("Secure");

    const productionRegistration = await request(app)
      .post("/v1/auth/register")
      .set("origin", "https://app.threadline.test")
      .send({
        email: "production@example.com",
        username: "production",
        displayName: "Production User",
        password: "correct-horse-battery",
      });
    expect(productionRegistration.status).toBe(201);
    expect(productionRegistration.headers["set-cookie"][0]).toContain("Secure");
  });

  it("creates a session, PAT, room, and short-lived room ticket", async () => {
    const getIceServers = vi.fn(async () => [
      { urls: ["stun:stun.cloudflare.com:3478"] },
      {
        urls: ["turns:turn.cloudflare.com:443?transport=tcp"],
        username: "temporary-user",
        credential: "temporary-credential",
      },
    ]);
    const { app } = await createTestApp(undefined, false, getIceServers);
    const agent = request.agent(app);
    const registration = await agent.post("/v1/auth/register").send({
      email: "avery@example.com",
      username: "avery",
      displayName: "Avery Chen",
      password: "correct-horse-battery",
    });
    expect(registration.status).toBe(201);
    expect(registration.body.user.email).toBe("avery@example.com");

    const createdOrg = await agent.post("/v1/orgs").send({ name: "Northstar Engineering" });
    expect(createdOrg.status).toBe(201);
    expect(createdOrg.body.organization.role).toBe("owner");
    expect(createdOrg.body.organization.joinCode).toBeUndefined();

    const current = await agent.get("/v1/auth/me");
    expect(current.status).toBe(200);
    expect(current.body.organizations).toHaveLength(1);

    const pat = await agent.post("/v1/pats").send({ label: "incident-cli", scopes: ["rooms:read", "messages:write"] });
    expect(pat.status).toBe(201);
    expect(pat.body.secret).toMatch(/^tl_pat_/);

    const room = await agent.post(`/v1/orgs/${current.body.organizations[0].id}/rooms`).send({ name: "incident-42" });
    expect(room.status).toBe(201);
    const patRooms = await request(app)
      .get(`/v1/orgs/${current.body.organizations[0].id}/rooms`)
      .set("authorization", `Bearer ${pat.body.secret}`);
    expect(patRooms.status).toBe(200);
    const patWrite = await request(app)
      .post(`/v1/orgs/${current.body.organizations[0].id}/rooms`)
      .set("authorization", `Bearer ${pat.body.secret}`)
      .send({ name: "should-not-create" });
    expect(patWrite.status).toBe(403);
    const ticket = await agent.post(`/v1/rooms/${room.body.room.id}/ticket`);
    expect(ticket.status).toBe(200);
    expect(ticket.body.ticket.split(".")).toHaveLength(3);
    expect(ticket.body.iceServers).toEqual(await getIceServers.mock.results[0].value);
    expect(getIceServers).toHaveBeenCalledWith(registration.body.user.id);

    const delivery = {
      deliveryId: crypto.randomUUID(),
      roomId: room.body.room.id,
      event: {
        type: "chat",
        payload: { text: "Rollback approved", username: "Avery" },
        from: registration.body.user.id,
        at: new Date().toISOString(),
      },
    };
    const ingestion = await request(app)
      .post("/v1/internal/room-events")
      .set("x-threadline-ingest", "test-ingest-secret")
      .send(delivery);
    expect(ingestion.status).toBe(202);
    const duplicateIngestion = await request(app)
      .post("/v1/internal/room-events")
      .set("x-threadline-ingest", "test-ingest-secret")
      .send(delivery);
    expect(duplicateIngestion.status).toBe(202);
    const events = await agent.get(`/v1/rooms/${room.body.room.id}/events`);
    expect(events.status).toBe(200);
    // room.created plus one idempotently persisted chat event, even though the
    // Worker delivered the same deliveryId twice.
    expect(events.body.events).toHaveLength(2);
    expect(events.body.events.at(-1).type).toBe("chat");
  });

  it("still issues a room ticket when the TURN provider is unavailable", async () => {
    const getIceServers = vi.fn(async () => {
      throw new Error("TURN provider unavailable");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app } = await createTestApp(undefined, false, getIceServers);
    const { agent, org } = await registerWithOrg(
      app,
      { email: "fallback@example.com", username: "fallback", displayName: "Fallback User" },
      "Fallback Organization",
    );
    const room = await agent.post(`/v1/orgs/${org.body.organization.id}/rooms`).send({ name: "fallback-room" });

    const ticket = await agent.post(`/v1/rooms/${room.body.room.id}/ticket`);

    expect(ticket.status).toBe(200);
    expect(ticket.body.ticket.split(".")).toHaveLength(3);
    expect(ticket.body.iceServers).toBeUndefined();
    expect(getIceServers).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "Unable to issue TURN credentials; continuing with STUN only.",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("rejects room-event ingress with an unknown event type", async () => {
    const { app } = await createTestApp();
    const response = await request(app)
      .post("/v1/internal/room-events")
      .set("x-threadline-ingest", "test-ingest-secret")
      .send({
        deliveryId: crypto.randomUUID(),
        roomId: crypto.randomUUID(),
        event: {
          type: "made-up-event",
          payload: {},
          from: crypto.randomUUID(),
          at: new Date().toISOString(),
        },
      });
    expect(response.status).toBe(422);
  });

  it("performs an authorization-code-with-PKCE exchange and serves userinfo", async () => {
    const { app } = await createTestApp();
    const agent = request.agent(app);
    await agent.post("/v1/auth/register").send({
      email: "lina@example.com",
      username: "lina",
      displayName: "Lina Novak",
      password: "correct-horse-battery",
    });
    const verifier = "pkce-verifier-with-more-than-forty-three-characters-1234567890";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorization = await agent.get("/oauth/authorize").query({
      response_type: "code",
      client_id: "threadline-web",
      redirect_uri: "http://localhost:3000/oidc/callback",
      scope: "openid profile email rooms:read",
      state: "test-state-value",
      code_challenge: challenge,
      code_challenge_method: "S256",
      nonce: "test-nonce-value",
    });
    expect(authorization.status).toBe(302);
    const code = new URL(authorization.headers.location).searchParams.get("code");
    expect(code).toBeTruthy();
    const tokens = await request(app).post("/oauth/token").type("form").send({
      grant_type: "authorization_code",
      client_id: "threadline-web",
      code,
      redirect_uri: "http://localhost:3000/oidc/callback",
      code_verifier: verifier,
    });
    expect(tokens.status).toBe(200);
    expect(tokens.body.access_token).toBeTruthy();
    expect(tokens.body.id_token).toBeTruthy();
    const userinfo = await request(app)
      .get("/oauth/userinfo")
      .set("authorization", `Bearer ${tokens.body.access_token}`);
    expect(userinfo.status).toBe(200);
    expect(userinfo.body.email).toBe("lina@example.com");
    expect(userinfo.body.email_verified).toBe(false);
  });

  it("delivers single-use password reset links and invalidates active sessions", async () => {
    const { app, delivered } = await createTestApp();
    const agent = request.agent(app);
    await agent.post("/v1/auth/register").send({
      email: "reset@example.com",
      username: "reset-user",
      displayName: "Reset User",
      password: "correct-horse-battery",
    });
    const requestReset = await request(app)
      .post("/v1/auth/password-reset/request")
      .send({ email: "reset@example.com" });
    expect(requestReset.status).toBe(202);
    const delivery = [...delivered].reverse().find((item) => item.type === "password_reset");
    const token = new URL(delivery?.actionUrl ?? "https://invalid.test").searchParams.get("token");
    expect(token).toBeTruthy();
    const reset = await request(app)
      .post("/v1/auth/password-reset/confirm")
      .send({ token, password: "a-new-correct-horse-battery" });
    expect(reset.status).toBe(204);
    const oldLogin = await request(app)
      .post("/v1/auth/login")
      .send({ email: "reset@example.com", password: "correct-horse-battery" });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post("/v1/auth/login")
      .send({ email: "reset@example.com", password: "a-new-correct-horse-battery" });
    expect(newLogin.status).toBe(200);
    expect((await agent.get("/v1/auth/me")).status).toBe(401);
  });

  it("exposes no email verification flow, and never issues a token nobody can deliver", async () => {
    const { app, delivered } = await createTestApp();
    const agent = request.agent(app);
    const registration = await agent.post("/v1/auth/register").send({
      email: "verify@example.com",
      username: "verify-user",
      displayName: "Verify User",
      password: "correct-horse-battery",
    });
    expect(registration.status).toBe(201);

    // Registration used to mint a verification token and hand it to a delivery
    // callback that is only configured when AUTH_DELIVERY_WEBHOOK is set. With no
    // mail provider that produced a token nobody could ever receive.
    expect(delivered.some((item) => item.type === "email_verification")).toBe(false);

    // Both endpoints are gone rather than answering 202 for mail that is never sent.
    expect((await agent.post("/v1/auth/email-verification/request")).status).toBe(404);
    expect(
      (
        await request(app)
          .post("/v1/auth/email-verification/confirm")
          .send({ token: "x".repeat(24) })
      ).status,
    ).toBe(404);

    // The field survives because the OIDC email_verified claim is derived from it,
    // and reporting it as false is accurate.
    expect((await agent.get("/v1/auth/me")).body.user.emailVerified).toBe(false);
  });

  it("updates a profile from a browser session, keeping usernames unique and lowercased", async () => {
    const { app } = await createTestApp();
    const { agent } = await registerWithOrg(
      app,
      { email: "profile@example.com", username: "profile-user", displayName: "Profile User" },
      "Profile Org",
    );
    await registerWithOrg(
      app,
      { email: "taken@example.com", username: "already-taken", displayName: "Taken User" },
      "Taken Org",
    );

    const renamed = await agent.patch("/v1/auth/me").send({ displayName: "  Renamed Person  " });
    expect(renamed.status).toBe(200);
    expect(renamed.body.user.displayName).toBe("Renamed Person");
    // A partial update must not blank out the field it did not mention.
    expect(renamed.body.user.username).toBe("profile-user");
    expect(renamed.body.organizations).toHaveLength(1);

    const rehandled = await agent.patch("/v1/auth/me").send({ username: "Renamed-Handle" });
    expect(rehandled.status).toBe(200);
    expect(rehandled.body.user.username).toBe("renamed-handle");
    expect((await agent.get("/v1/auth/me")).body.user.username).toBe("renamed-handle");

    // Case-folding means "Already-Taken" collides with the other account's handle.
    const collision = await agent.patch("/v1/auth/me").send({ username: "Already-Taken" });
    expect(collision.status).toBe(409);
    expect(collision.body.error).toBe("username_in_use");

    // Re-submitting your own current username is a no-op, not a conflict with yourself.
    expect((await agent.patch("/v1/auth/me").send({ username: "renamed-handle" })).status).toBe(200);

    expect((await agent.patch("/v1/auth/me").send({})).status).toBe(422);
    expect((await agent.patch("/v1/auth/me").send({ username: "no spaces" })).status).toBe(422);
    expect((await agent.patch("/v1/auth/me").send({ displayName: "x" })).status).toBe(422);
    expect((await request(app).patch("/v1/auth/me").send({ displayName: "Anonymous" })).status).toBe(401);
  });

  it("bounds room history and pages backwards through it with a cursor", async () => {
    const { app } = await createTestApp();
    const { agent } = await registerWithOrg(
      app,
      { email: "history@example.com", username: "history-user", displayName: "History User" },
      "History Org",
    );
    const organizations = (await agent.get("/v1/auth/me")).body.organizations;
    const room = await agent.post(`/v1/orgs/${organizations[0].id}/rooms`).send({ name: "long-lived" });
    const roomId = room.body.room.id;

    // More events than a single page, so the bound is actually exercised.
    for (let index = 0; index < 12; index += 1) {
      const ingested = await request(app)
        .post("/v1/internal/room-events")
        .set("x-threadline-ingest", "test-ingest-secret")
        .send({
          deliveryId: crypto.randomUUID(),
          roomId,
          event: {
            type: "chat",
            payload: { text: `message ${index}`, username: "History User" },
            from: (await agent.get("/v1/auth/me")).body.user.id,
            at: new Date(Date.now() + index * 1000).toISOString(),
          },
        });
      expect(ingested.status).toBe(202);
    }

    const firstPage = await agent.get(`/v1/rooms/${roomId}/events`).query({ limit: 5 });
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.events).toHaveLength(5);
    expect(firstPage.body.hasMore).toBe(true);
    // Oldest-first within the page, and the page is the newest slice of history.
    const times = firstPage.body.events.map((event: { createdAt: string }) => Date.parse(event.createdAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);

    const older = await agent.get(`/v1/rooms/${roomId}/events`).query({ limit: 5, before: firstPage.body.nextBefore });
    expect(older.body.events).toHaveLength(5);
    // A cursor page must not repeat anything the caller already has.
    const firstIds = new Set(firstPage.body.events.map((event: { id: string }) => event.id));
    expect(older.body.events.some((event: { id: string }) => firstIds.has(event.id))).toBe(false);
    expect(Date.parse(older.body.events.at(-1)!.createdAt)).toBeLessThan(Date.parse(firstPage.body.nextBefore));

    // Walking far enough back reaches the start and says so.
    const oldest = await agent.get(`/v1/rooms/${roomId}/events`).query({ limit: 50 });
    expect(oldest.body.events.length).toBeGreaterThanOrEqual(13);
    expect(oldest.body.hasMore).toBe(false);

    expect((await agent.get(`/v1/rooms/${roomId}/events`).query({ limit: 0 })).status).toBe(422);
    expect((await agent.get(`/v1/rooms/${roomId}/events`).query({ limit: 5000 })).status).toBe(422);
  });

  it("derives a free username when the client does not supply one", async () => {
    const { app } = await createTestApp();
    // Same local part, different domains — the case a client-side "email prefix +
    // suffix" scheme collides on, which would otherwise fail the second signup with
    // an error about a field its sign-up form does not even show.
    const first = await request(app).post("/v1/auth/register").send({
      email: "avery@first.example",
      displayName: "Avery One",
      password: "correct-horse-battery",
    });
    const second = await request(app).post("/v1/auth/register").send({
      email: "avery@second.example",
      displayName: "Avery Two",
      password: "correct-horse-battery",
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.user.username).toBe("avery");
    expect(second.body.user.username).not.toBe(first.body.user.username);
    expect(second.body.user.username).toMatch(/^avery-[a-z0-9]{4}$/);
  });

  it("recovers an account with a single-use recovery code and evicts every old session", async () => {
    const { app } = await createTestApp();
    const agent = request.agent(app);
    const registration = await agent.post("/v1/auth/register").send({
      email: "locked-out@example.com",
      username: "locked-out",
      displayName: "Locked Out",
      password: "correct-horse-battery",
    });
    expect(registration.status).toBe(201);

    // Issued once, at registration, because there is no mail provider to send them later.
    const codes: string[] = registration.body.recoveryCodes;
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const code of codes) expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    // The old session must stop working once the password is reset through it.
    expect((await agent.get("/v1/auth/me")).status).toBe(200);

    const redeemed = await request(app)
      .post("/v1/auth/password-reset/redeem")
      .send({
        // Formatting and case are stripped before hashing, so how it is typed back is irrelevant.
        email: "Locked-Out@example.com",
        code: codes[0].toLowerCase().replace(/-/g, " "),
        password: "brand-new-passphrase",
      });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.remaining).toBe(7);

    expect((await agent.get("/v1/auth/me")).status).toBe(401);

    const oldPassword = await request(app)
      .post("/v1/auth/login")
      .send({ email: "locked-out@example.com", password: "correct-horse-battery" });
    expect(oldPassword.status).toBe(401);
    const newPassword = await request(app)
      .post("/v1/auth/login")
      .send({ email: "locked-out@example.com", password: "brand-new-passphrase" });
    expect(newPassword.status).toBe(200);

    // Single use: the same code must not work twice.
    const replay = await request(app)
      .post("/v1/auth/password-reset/redeem")
      .send({ email: "locked-out@example.com", code: codes[0], password: "third-passphrase-here" });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("invalid_recovery_code");
  });

  it("does not reveal whether an account exists when a recovery code is rejected", async () => {
    const { app } = await createTestApp();
    const registration = await request(app).post("/v1/auth/register").send({
      email: "known@example.com",
      username: "known-user",
      displayName: "Known User",
      password: "correct-horse-battery",
    });
    const valid: string = registration.body.recoveryCodes[0];

    const wrongCode = await request(app)
      .post("/v1/auth/password-reset/redeem")
      .send({ email: "known@example.com", code: "ZZZZ-ZZZZ-ZZZZ", password: "brand-new-passphrase" });
    const unknownAccount = await request(app)
      .post("/v1/auth/password-reset/redeem")
      .send({ email: "nobody@example.com", code: valid, password: "brand-new-passphrase" });

    // A real account with a bad code and a nonexistent account must be
    // indistinguishable, or this endpoint becomes an account-existence oracle.
    expect(wrongCode.status).toBe(unknownAccount.status);
    expect(wrongCode.body).toEqual(unknownAccount.body);
    expect(wrongCode.status).toBe(400);
  });

  it("regenerates recovery codes, invalidating every previous one", async () => {
    const { app } = await createTestApp();
    const agent = request.agent(app);
    const registration = await agent.post("/v1/auth/register").send({
      email: "rotate@example.com",
      username: "rotate-user",
      displayName: "Rotate User",
      password: "correct-horse-battery",
    });
    const original: string[] = registration.body.recoveryCodes;

    expect((await agent.get("/v1/auth/recovery-codes")).body).toMatchObject({ remaining: 8, total: 8 });

    const regenerated = await agent.post("/v1/auth/recovery-codes");
    expect(regenerated.status).toBe(201);
    const replacements: string[] = regenerated.body.recoveryCodes;
    expect(replacements).toHaveLength(8);
    expect(replacements.some((code) => original.includes(code))).toBe(false);

    // The point of regenerating is that anything printed earlier stops working.
    const stale = await request(app)
      .post("/v1/auth/password-reset/redeem")
      .send({ email: "rotate@example.com", code: original[0], password: "brand-new-passphrase" });
    expect(stale.status).toBe(400);

    const fresh = await request(app)
      .post("/v1/auth/password-reset/redeem")
      .send({ email: "rotate@example.com", code: replacements[0], password: "brand-new-passphrase" });
    expect(fresh.status).toBe(200);
  });

  it("never exposes recovery codes through a read endpoint", async () => {
    const { app } = await createTestApp();
    const agent = request.agent(app);
    const registration = await agent.post("/v1/auth/register").send({
      email: "opaque@example.com",
      username: "opaque-user",
      displayName: "Opaque User",
      password: "correct-horse-battery",
    });
    const codes: string[] = registration.body.recoveryCodes;

    const listed = await agent.get("/v1/auth/recovery-codes");
    expect(listed.status).toBe(200);
    // Only hashes are stored, so there is nothing to read back — the status endpoint
    // must not leak the plaintext by any route, including nested fields.
    const serialized = JSON.stringify(listed.body);
    for (const code of codes) expect(serialized).not.toContain(code);
    expect(serialized).not.toContain("codeHash");

    expect((await request(app).get("/v1/auth/recovery-codes")).status).toBe(401);
  });

  it("rejects a username already claimed by another account at registration", async () => {
    const { app } = await createTestApp();
    const agent = request.agent(app);
    const first = await agent.post("/v1/auth/register").send({
      email: "first@example.com",
      username: "shared-handle",
      displayName: "First User",
      password: "correct-horse-battery",
    });
    expect(first.status).toBe(201);

    // Case-folded, so "Shared-Handle" is the same claim as "shared-handle".
    const collision = await request(app).post("/v1/auth/register").send({
      email: "second@example.com",
      username: "Shared-Handle",
      displayName: "Second User",
      password: "correct-horse-battery",
    });
    expect(collision.status).toBe(409);
    expect(collision.body.error).toBe("username_in_use");
  });

  it("returns every field the published User schema declares required", async () => {
    const { app } = await createTestApp();
    const agent = request.agent(app);
    const registration = await agent.post("/v1/auth/register").send({
      email: "shape@example.com",
      username: "shape-user",
      displayName: "Shape User",
      password: "correct-horse-battery",
    });

    const specification = await request(app).get("/openapi.json");
    const required: string[] = specification.body.components.schemas.User.required;
    expect(required.length).toBeGreaterThan(0);

    // publicUser is what every user-carrying response is built from, so a field the
    // schema promises and it omits is a contract violation on all of them at once.
    for (const field of required) {
      expect(registration.body.user, `register is missing ${field}`).toHaveProperty(field);
      expect((await agent.get("/v1/auth/me")).body.user, `/v1/auth/me is missing ${field}`).toHaveProperty(field);
    }
  });

  it("does not let a personal access token rename the account that issued it", async () => {
    const { app } = await createTestApp();
    const { agent } = await registerWithOrg(
      app,
      { email: "pat-profile@example.com", username: "pat-profile", displayName: "Pat Profile" },
      "Pat Org",
    );
    const token = await agent.post("/v1/pats").send({ label: "automation", scopes: ["admin:*"] });
    expect(token.status).toBe(201);

    // admin:* is the broadest scope there is, and it still must not reach identity.
    const attempt = await request(app)
      .patch("/v1/auth/me")
      .set("authorization", `Bearer ${token.body.secret}`)
      .send({ displayName: "Escalated" });
    expect(attempt.status).toBe(401);
    expect((await agent.get("/v1/auth/me")).body.user.displayName).toBe("Pat Profile");
  });

  it("tracks rate limits per route, not globally across every rate-limited endpoint", async () => {
    const { app } = await createTestApp();
    // Login and register are mounted at distinct exact paths, so a naive key built
    // from request.path alone (which Express rebases to "/" inside an exact-path
    // app.use middleware) would collide the two into one shared counter.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await request(app)
        .post("/v1/auth/login")
        .send({ email: "nobody@example.com", password: "wrong-password" });
      expect(response.status).toBe(401);
    }
    const loginBlocked = await request(app)
      .post("/v1/auth/login")
      .send({ email: "nobody@example.com", password: "wrong-password" });
    expect(loginBlocked.status).toBe(429);

    // Register has its own, separate budget and must still succeed.
    const registration = await request(app).post("/v1/auth/register").send({
      email: "unaffected-by-login-limit@example.com",
      username: "unaffected",
      displayName: "Unaffected User",
      password: "correct-horse-battery",
    });
    expect(registration.status).toBe(201);
  });

  it("rate limits invite-code guessing on /v1/join like any other secret check", async () => {
    const { app } = await createTestApp();
    const agent = request.agent(app);
    await agent.post("/v1/auth/register").send({
      email: "guesser@example.com",
      username: "guesser",
      displayName: "Guesser User",
      password: "correct-horse-battery",
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await agent.post("/v1/join").send({ code: "WRONGCOD" });
      expect(response.status).toBe(404);
    }
    const blocked = await agent.post("/v1/join").send({ code: "WRONGCOD" });
    expect(blocked.status).toBe(429);
  });

  it("counts rate limits in the cache when one is configured, without touching the repository", async () => {
    const { app, repository } = await createTestApp(undefined, false, undefined, new MemoryCache());
    const repositoryCounter = vi.spyOn(repository, "incrementRateLimit");

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await request(app)
        .post("/v1/auth/login")
        .send({ email: "nobody@example.com", password: "wrong-password" });
      expect(response.status).toBe(401);
    }
    expect((await request(app).post("/v1/auth/login").send({ email: "n@example.com", password: "x" })).status).toBe(
      429,
    );
    // The whole point of the cache path is that the database never sees these.
    expect(repositoryCounter).not.toHaveBeenCalled();
  });

  it("still enforces the rate limit when the cache is unreachable", async () => {
    const brokenCache: Cache = {
      incrementWindow: async () => {
        throw new Error("Redis is not connected.");
      },
      claim: async () => {
        throw new Error("Redis is not connected.");
      },
      status: () => "unavailable",
      close: async () => {},
    };
    const { app, repository } = await createTestApp(undefined, false, undefined, brokenCache);
    const repositoryCounter = vi.spyOn(repository, "incrementRateLimit");

    for (let attempt = 0; attempt < 12; attempt += 1)
      await request(app).post("/v1/auth/login").send({ email: "nobody@example.com", password: "wrong-password" });

    // A cache failure must degrade to the repository, never to an unlimited endpoint.
    const blocked = await request(app)
      .post("/v1/auth/login")
      .send({ email: "nobody@example.com", password: "wrong-password" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(repositoryCounter).toHaveBeenCalled();
  });

  it("collapses repeated lastUsedAt writes without letting a revoked session survive", async () => {
    const { app, repository } = await createTestApp(undefined, false, undefined, new MemoryCache());
    const agent = request.agent(app);
    await agent.post("/v1/auth/register").send({
      email: "coalesced@example.com",
      username: "coalesced",
      displayName: "Coalesced User",
      password: "correct-horse-battery",
    });

    const sessionWrites = vi.spyOn(repository, "updateSession");
    expect((await agent.get("/v1/auth/me")).status).toBe(200);
    expect((await agent.get("/v1/auth/me")).status).toBe(200);
    expect((await agent.get("/v1/auth/me")).status).toBe(200);
    // Three authenticated requests, one bookkeeping write — the claim held for the
    // other two. Without a cache each request writes, which is the cost being removed.
    expect(sessionWrites).toHaveBeenCalledTimes(1);

    // Revocation must still be immediate. The session row is read from the
    // repository on every request; only the write is collapsed, so a live claim
    // cannot keep a revoked credential working.
    const sessions = await agent.get("/v1/sessions");
    const current = sessions.body.sessions.find((session: { isCurrent: boolean }) => session.isCurrent);
    expect((await agent.delete(`/v1/sessions/${current.id}`)).status).toBe(204);
    expect((await agent.get("/v1/auth/me")).status).toBe(401);
  });

  it("never emits a negative or zero Retry-After when the window has already elapsed", async () => {
    // A store returns a resetAt computed when it was read, so a slow reply — or a
    // bucket sitting on the edge of expiry — leaves it in the past by the time the
    // header is written. Unclamped that produced "Retry-After: -1", which is not a
    // valid RFC 9110 delta-seconds and which a client may reject outright.
    const elapsedWindowCache: Cache = {
      incrementWindow: async (key) => ({ key, count: 999, resetAt: new Date(Date.now() - 1_500) }),
      claim: async () => true,
      status: () => "ready",
      close: async () => {},
    };
    const { app } = await createTestApp(undefined, false, undefined, elapsedWindowCache);

    const blocked = await request(app).post("/v1/auth/login").send({ email: "a@example.com", password: "whatever-x" });

    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers["retry-after"]);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("reports cache state on /health without requiring one to be configured", async () => {
    const { app: withoutCache } = await createTestApp();
    expect((await request(withoutCache).get("/health")).body).toEqual({
      status: "ok",
      service: "threadline-api",
      cache: "disabled",
    });

    const { app: withCache } = await createTestApp(undefined, false, undefined, new MemoryCache());
    expect((await request(withCache).get("/health")).body.cache).toBe("ready");
  });

  it("enforces organization and restricted-room ABAC for reads, writes, tickets, and activity", async () => {
    const { app } = await createTestApp();
    const {
      agent: owner,
      registration: ownerRegistration,
      org: ownerOrgResponse,
    } = await registerWithOrg(
      app,
      { email: "owner@example.com", username: "owner", displayName: "Owner User" },
      "Owner Organization",
    );
    const member = request.agent(app);
    const memberRegistration = await member.post("/v1/auth/register").send({
      email: "member@example.com",
      username: "member",
      displayName: "Member User",
      password: "correct-horse-battery",
    });
    const ownerOrg = ownerOrgResponse.body.organization.id as string;
    const restricted = await owner.post(`/v1/orgs/${ownerOrg}/rooms`).send({
      name: "private-incident",
      visibility: "restricted",
      classification: "confidential",
    });
    expect(restricted.status).toBe(201);

    // A member of another organization cannot enumerate, fetch, or join it.
    expect((await member.get(`/v1/orgs/${ownerOrg}/rooms`)).status).toBe(403);
    expect((await member.post(`/v1/rooms/${restricted.body.room.id}/ticket`)).status).toBe(403);
    expect((await member.get(`/v1/rooms/${restricted.body.room.id}/events`)).status).toBe(403);

    // Once added to the organization, a standard member still cannot see a
    // restricted room or create one without an explicit delegated attribute.
    const added = await owner
      .post(`/v1/orgs/${ownerOrg}/members`)
      .send({ email: "member@example.com", role: "member" });
    expect(added.status).toBe(201);
    expect((await member.get(`/v1/orgs/${ownerOrg}/rooms`)).body.rooms).toHaveLength(0);
    expect((await member.post(`/v1/orgs/${ownerOrg}/rooms`).send({ name: "not-permitted" })).status).toBe(403);
    expect((await member.post(`/v1/rooms/${restricted.body.room.id}/ticket`)).status).toBe(403);

    // Restricted rooms can grant their initial access list as part of creation,
    // so there is no inaccessible gap between creating the room and managing it.
    const restrictedWithMembers = await owner.post(`/v1/orgs/${ownerOrg}/rooms`).send({
      name: "private-planning",
      visibility: "restricted",
      memberIds: [memberRegistration.body.user.id, memberRegistration.body.user.id],
    });
    expect(restrictedWithMembers.status).toBe(201);
    expect((await member.post(`/v1/rooms/${restrictedWithMembers.body.room.id}/ticket`)).status).toBe(200);
    expect((await owner.get(`/v1/rooms/${restrictedWithMembers.body.room.id}/members`)).body.members).toHaveLength(2);

    // An explicit room membership grants read/join only. Presence lifecycle
    // events are valid for viewers, but mutations still require write access.
    const addToRoom = await owner.post(`/v1/rooms/${restricted.body.room.id}/members`).send({
      userId: memberRegistration.body.user.id,
      role: "viewer",
    });
    expect(addToRoom.status).toBe(201);
    expect((await member.get(`/v1/rooms/${restricted.body.room.id}/events`)).status).toBe(200);
    expect((await member.post(`/v1/rooms/${restricted.body.room.id}/ticket`)).status).toBe(200);
    for (const type of ["participant.joined", "participant.left"]) {
      const presence = await request(app)
        .post("/v1/internal/room-events")
        .set("x-threadline-ingest", "test-ingest-secret")
        .send({
          deliveryId: crypto.randomUUID(),
          roomId: restricted.body.room.id,
          event: {
            type,
            payload: { userId: memberRegistration.body.user.id },
            from: memberRegistration.body.user.id,
            at: new Date().toISOString(),
          },
        });
      expect(presence.status).toBe(202);
    }
    const forgedPresence = await request(app)
      .post("/v1/internal/room-events")
      .set("x-threadline-ingest", "test-ingest-secret")
      .send({
        deliveryId: crypto.randomUUID(),
        roomId: restricted.body.room.id,
        event: {
          type: "participant.joined",
          payload: { userId: ownerRegistration.body.user.id },
          from: memberRegistration.body.user.id,
          at: new Date().toISOString(),
        },
      });
    expect(forgedPresence.status).toBe(422);
    expect(
      (
        await request(app)
          .post("/v1/internal/room-events")
          .set("x-threadline-ingest", "test-ingest-secret")
          .send({
            roomId: restricted.body.room.id,
            event: {
              type: "chat",
              payload: { text: "forged", username: "Member User" },
              from: memberRegistration.body.user.id,
              at: new Date().toISOString(),
            },
          })
      ).status,
    ).toBe(403);

    // Activity and calendars are organization scoped as well.
    expect((await member.get(`/v1/orgs/${ownerOrg}/activity`)).status).toBe(200);
    expect((await request(app).get(`/v1/orgs/${ownerOrg}/calendar`)).status).toBe(401);
    expect(
      (
        await member.post(`/v1/orgs/${ownerOrg}/calendar`).send({
          title: "Private review",
          startsAt: new Date(Date.now() + 60_000).toISOString(),
          endsAt: new Date(Date.now() + 120_000).toISOString(),
          roomId: restricted.body.room.id,
        })
      ).status,
    ).toBe(403);
    expect(ownerRegistration.status).toBe(201);
  });

  it("revokes explicit room membership without touching the caller's organization membership", async () => {
    const { app } = await createTestApp();
    const { agent: owner, org: ownerOrgResponse } = await registerWithOrg(
      app,
      { email: "revoke-owner@example.com", username: "revokeowner", displayName: "Revoke Owner" },
      "Revoke Organization",
    );
    const member = request.agent(app);
    const memberRegistration = await member.post("/v1/auth/register").send({
      email: "revoke-member@example.com",
      username: "revokemember",
      displayName: "Revoke Member",
      password: "correct-horse-battery",
    });
    const memberId = memberRegistration.body.user.id as string;
    const ownerOrg = ownerOrgResponse.body.organization.id as string;
    const room = await owner
      .post(`/v1/orgs/${ownerOrg}/rooms`)
      .send({ name: "revoke-target", visibility: "restricted" });
    const roomId = room.body.room.id as string;
    await owner.post(`/v1/orgs/${ownerOrg}/members`).send({ email: "revoke-member@example.com", role: "member" });
    const grant = await owner.post(`/v1/rooms/${roomId}/members`).send({ userId: memberId, role: "viewer" });
    expect(grant.status).toBe(201);
    expect((await member.post(`/v1/rooms/${roomId}/ticket`)).status).toBe(200);

    // The member being removed cannot revoke their own access — only someone with
    // the room's "manage" permission can.
    expect((await member.delete(`/v1/rooms/${roomId}/members/${memberId}`)).status).toBe(403);

    // Removing someone who was never explicitly a member of this room 404s rather
    // than silently succeeding.
    const strangerId = "00000000-0000-4000-8000-000000000000";
    expect((await owner.delete(`/v1/rooms/${roomId}/members/${strangerId}`)).status).toBe(404);

    const revoke = await owner.delete(`/v1/rooms/${roomId}/members/${memberId}`);
    expect(revoke.status).toBe(204);

    // The org membership is untouched — only the room-scoped grant is gone, so a
    // restricted room now correctly rejects the caller again.
    expect((await member.get(`/v1/orgs/${ownerOrg}/rooms`)).status).toBe(200);
    expect((await member.post(`/v1/rooms/${roomId}/ticket`)).status).toBe(403);

    // The room owner can't be removed through this endpoint.
    const ownerId = (await owner.get("/v1/auth/me")).body.user.id as string;
    const removeOwner = await owner.delete(`/v1/rooms/${roomId}/members/${ownerId}`);
    expect(removeOwner.status).toBe(400);
  });
  it("registers accounts with no organization until one is explicitly created or joined", async () => {
    const { app } = await createTestApp();
    const agent = request.agent(app);
    const registration = await agent.post("/v1/auth/register").send({
      email: "unaffiliated@example.com",
      username: "unaffiliated",
      displayName: "Unaffiliated User",
      password: "correct-horse-battery",
    });
    expect(registration.status).toBe(201);
    expect(registration.body.organization).toBeUndefined();

    const current = await agent.get("/v1/auth/me");
    expect(current.body.organizations).toHaveLength(0);
  });

  it("creates a workspace with a join code that is never exposed outside the dedicated invite endpoint", async () => {
    const { app } = await createTestApp();
    const { agent: owner, org } = await registerWithOrg(
      app,
      { email: "wsowner@example.com", username: "wsowner", displayName: "Workspace Owner" },
      "Codepath Labs",
    );
    expect(org.status).toBe(201);
    expect(org.body.organization.role).toBe("owner");
    expect(org.body.organization.joinCode).toBeUndefined();

    const current = await owner.get("/v1/auth/me");
    expect(current.body.organizations[0].joinCode).toBeUndefined();
    const list = await owner.get("/v1/orgs");
    expect(list.body.organizations[0].joinCode).toBeUndefined();

    const invite = await owner.get(`/v1/orgs/${org.body.organization.id}/invite`);
    expect(invite.status).toBe(200);
    expect(invite.body.joinCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(invite.body.allowMemberInvites).toBe(false);
  });

  it("joins a workspace by invite code and rejects invalid or already-used codes", async () => {
    const { app } = await createTestApp();
    const { agent: owner, org } = await registerWithOrg(
      app,
      { email: "joinowner@example.com", username: "joinowner", displayName: "Join Owner" },
      "Riverside Studio",
    );
    const orgId = org.body.organization.id as string;
    const invite = await owner.get(`/v1/orgs/${orgId}/invite`);

    const joiner = request.agent(app);
    await joiner.post("/v1/auth/register").send({
      email: "joiner@example.com",
      username: "joiner",
      displayName: "Joiner User",
      password: "correct-horse-battery",
    });

    const badCode = await joiner.post("/v1/join").send({ code: "NOTREAL1" });
    expect(badCode.status).toBe(404);

    // Codes are accepted case-insensitively and with incidental whitespace,
    // since a person is retyping this from another screen.
    const join = await joiner.post("/v1/join").send({ code: ` ${invite.body.joinCode.toLowerCase()} ` });
    expect(join.status).toBe(201);
    expect(join.body.organization.role).toBe("member");
    expect(join.body.organization.joinCode).toBeUndefined();

    const rejoin = await joiner.post("/v1/join").send({ code: invite.body.joinCode });
    expect(rejoin.status).toBe(409);

    const members = await owner.get(`/v1/orgs/${orgId}/members`);
    expect(members.body.members).toHaveLength(2);

    // A plain member cannot read or regenerate the invite code by default.
    expect((await joiner.get(`/v1/orgs/${orgId}/invite`)).status).toBe(403);
    expect((await joiner.post(`/v1/orgs/${orgId}/invite/regenerate`)).status).toBe(403);

    // The owner can opt in to letting members share the invite, at which
    // point regeneration by the owner also invalidates the old code.
    const settings = await owner.patch(`/v1/orgs/${orgId}/settings`).send({ allowMemberInvites: true });
    expect(settings.status).toBe(200);
    expect(settings.body.allowMemberInvites).toBe(true);
    expect((await joiner.get(`/v1/orgs/${orgId}/invite`)).status).toBe(200);

    const regenerated = await owner.post(`/v1/orgs/${orgId}/invite/regenerate`);
    expect(regenerated.status).toBe(200);
    expect(regenerated.body.joinCode).not.toBe(invite.body.joinCode);
    expect((await joiner.post("/v1/join").send({ code: invite.body.joinCode })).status).toBe(404);
  });

  it("manages member roles: owner-only admin grants, and a last-admin self-demotion guard", async () => {
    const { app } = await createTestApp();
    const { agent: owner, org } = await registerWithOrg(
      app,
      { email: "roleowner@example.com", username: "roleowner", displayName: "Role Owner" },
      "Northline Systems",
    );
    const orgId = org.body.organization.id as string;
    const ownerId = (await owner.get("/v1/auth/me")).body.user.id as string;

    const addMember = async (email: string, username: string) => {
      const agent = request.agent(app);
      const registration = await agent.post("/v1/auth/register").send({
        email,
        username,
        displayName: username,
        password: "correct-horse-battery",
      });
      await owner.post(`/v1/orgs/${orgId}/members`).send({ email, role: "member" });
      return { agent, userId: registration.body.user.id as string };
    };

    const admin1 = await addMember("admin1@example.com", "admin1");
    const admin2 = await addMember("admin2@example.com", "admin2");
    const plain = await addMember("plainmember@example.com", "plainmember");

    // Promote both to admin — only the owner may do this.
    expect((await owner.patch(`/v1/orgs/${orgId}/members/${admin1.userId}`).send({ role: "admin" })).status).toBe(200);
    expect((await owner.patch(`/v1/orgs/${orgId}/members/${admin2.userId}`).send({ role: "admin" })).status).toBe(200);

    // A non-owner admin cannot grant admin to someone else.
    const escalationAttempt = await admin1.agent
      .patch(`/v1/orgs/${orgId}/members/${plain.userId}`)
      .send({ role: "admin" });
    expect(escalationAttempt.status).toBe(403);

    // A plain member cannot change anyone's role at all.
    expect(
      (await plain.agent.patch(`/v1/orgs/${orgId}/members/${admin1.userId}`).send({ role: "member" })).status,
    ).toBe(403);

    // The owner's own role can never be changed through this endpoint.
    expect((await owner.patch(`/v1/orgs/${orgId}/members/${ownerId}`).send({ role: "admin" })).status).toBe(400);

    // With two admins present, one may self-demote to member.
    const firstDemotion = await admin1.agent.patch(`/v1/orgs/${orgId}/members/${admin1.userId}`).send({
      role: "member",
    });
    expect(firstDemotion.status).toBe(200);
    expect(firstDemotion.body.member.role).toBe("member");

    // Now admin2 is the organization's only admin — self-demotion must be blocked.
    const blockedDemotion = await admin2.agent.patch(`/v1/orgs/${orgId}/members/${admin2.userId}`).send({
      role: "member",
    });
    expect(blockedDemotion.status).toBe(400);
    expect(blockedDemotion.body.error).toBe("last_admin");

    // The guard only protects self-service demotion — an owner-directed
    // change is allowed even if it leaves zero admins, since the owner
    // remains as a fallback administrator.
    const ownerDirectedDemotion = await owner.patch(`/v1/orgs/${orgId}/members/${admin2.userId}`).send({
      role: "member",
    });
    expect(ownerDirectedDemotion.status).toBe(200);
  });

  it("keeps live rooms restricted to organization members even under the new signup flow", async () => {
    const { app } = await createTestApp();
    const { agent: owner, org } = await registerWithOrg(
      app,
      { email: "roomowner@example.com", username: "roomowner", displayName: "Room Owner" },
      "Perimeter Inc",
    );
    const room = await owner.post(`/v1/orgs/${org.body.organization.id}/rooms`).send({ name: "standup" });
    expect(room.status).toBe(201);

    const outsider = request.agent(app);
    await outsider.post("/v1/auth/register").send({
      email: "outsider@example.com",
      username: "outsider",
      displayName: "Outsider User",
      password: "correct-horse-battery",
    });
    // A brand-new account with zero organizations has no room role at all.
    expect((await outsider.get("/v1/auth/me")).body.organizations).toHaveLength(0);
    expect((await outsider.get(`/v1/rooms/${room.body.room.id}`)).status).toBe(403);
    expect((await outsider.post(`/v1/rooms/${room.body.room.id}/ticket`)).status).toBe(403);

    // Someone with no membership at all in the org — not merely a member lacking
    // invite permission — can't read its join code either. And a nonexistent
    // orgId returns the identical status, so a caller can't use the invite
    // endpoint's response code to enumerate which org IDs are real.
    const realOrgInvite = await outsider.get(`/v1/orgs/${org.body.organization.id}/invite`);
    const fakeOrgInvite = await outsider.get("/v1/orgs/00000000-0000-4000-8000-000000000000/invite");
    expect(realOrgInvite.status).toBe(403);
    expect(fakeOrgInvite.status).toBe(403);
  });
});

describe("POST /oauth/token request validation", () => {
  it("returns 400 invalid_request for missing, malformed, or unparsable request data", async () => {
    const { app } = await createTestApp();
    const responses = await Promise.all([
      request(app).post("/oauth/token").set("Content-Type", "text/plain").send("grant_type=authorization_code"),
      request(app).post("/oauth/token").send({}),
      request(app).post("/oauth/token").send({ grant_type: "" }),
      request(app).post("/oauth/token").send({ grant_type: "   " }),
      request(app).post("/oauth/token").send({ grant_type: " authorization_code " }),
      request(app).post("/oauth/token").send({ grant_type: 42 }),
      request(app).post("/oauth/token").send({ grant_type: "authorization_code" }),
      request(app).post("/oauth/token").send({ grant_type: "refresh_token", client_id: "threadline-web" }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("invalid_request");
    }
  });

  it("returns 400 invalid_request for malformed JSON parsed before the route", async () => {
    const { app } = await createTestApp();
    const response = await request(app)
      .post("/oauth/token")
      .set("Content-Type", "application/json")
      .send('{"grant_type":');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_request");
  });

  it("keeps unsupported grant types and non-token validation errors distinct", async () => {
    const { app } = await createTestApp();
    const unsupported = await request(app).post("/oauth/token").send({ grant_type: "client_credentials" });
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error).toBe("unsupported_grant_type");

    const ordinaryValidationError = await request(app).post("/v1/auth/login").send({});
    expect(ordinaryValidationError.status).toBe(422);
    expect(ordinaryValidationError.body.error).toBe("validation_error");
  });
});
