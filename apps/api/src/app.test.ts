import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./application.js";
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

async function createTestApp(additionalWebOrigins?: string[], secureCookies = false) {
  const signer = await OidcSigner.create();
  const delivered: Array<{ type: string; actionUrl: string }> = [];
  const app = createApp({
    repository: new MemoryRepository(),
    issuer: "https://id.threadline.test",
    webOrigin: "https://app.threadline.test",
    additionalWebOrigins,
    secureCookies,
    ticketSecret: "test-ticket-secret",
    ingestSecret: "test-ingest-secret",
    signer,
    actionUrl: (type, token) => `https://app.threadline.test/${type}?token=${token}`,
    deliverAccountAction: async ({ type, actionUrl }) => {
      delivered.push({ type, actionUrl });
    },
    enableHttpLogs: false,
  });
  return { app, delivered };
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
    const { app } = await createTestApp();
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

    const ingestion = await request(app)
      .post("/v1/internal/room-events")
      .set("x-threadline-ingest", "test-ingest-secret")
      .send({
        roomId: room.body.room.id,
        event: {
          type: "chat",
          payload: { text: "Rollback approved" },
          from: registration.body.user.id,
          at: new Date().toISOString(),
        },
      });
    expect(ingestion.status).toBe(202);
    const events = await agent.get(`/v1/rooms/${room.body.room.id}/events`);
    expect(events.status).toBe(200);
    expect(events.body.events).toHaveLength(2);
    expect(events.body.events.at(-1).type).toBe("chat");
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

  it("tracks email verification state through registration, resend, and confirmation", async () => {
    const { app, delivered } = await createTestApp();
    const agent = request.agent(app);
    await agent.post("/v1/auth/register").send({
      email: "verify@example.com",
      username: "verify-user",
      displayName: "Verify User",
      password: "correct-horse-battery",
    });
    expect((await agent.get("/v1/auth/me")).body.user.emailVerified).toBe(false);

    const resend = await agent.post("/v1/auth/email-verification/request");
    expect(resend.status).toBe(202);
    const delivery = [...delivered].reverse().find((item) => item.type === "email_verification");
    const token = new URL(delivery?.actionUrl ?? "https://invalid.test").searchParams.get("token");
    expect(token).toBeTruthy();

    const confirm = await request(app).post("/v1/auth/email-verification/confirm").send({ token });
    expect(confirm.status).toBe(204);
    expect((await agent.get("/v1/auth/me")).body.user.emailVerified).toBe(true);
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

    // An explicit room membership grants read/join only. Viewer writes are
    // rejected by the API ingress even if a client tries to forge an event.
    const addToRoom = await owner.post(`/v1/rooms/${restricted.body.room.id}/members`).send({
      userId: memberRegistration.body.user.id,
      role: "viewer",
    });
    expect(addToRoom.status).toBe(201);
    expect((await member.get(`/v1/rooms/${restricted.body.room.id}/events`)).status).toBe(200);
    expect((await member.post(`/v1/rooms/${restricted.body.room.id}/ticket`)).status).toBe(200);
    expect(
      (
        await request(app)
          .post("/v1/internal/room-events")
          .set("x-threadline-ingest", "test-ingest-secret")
          .send({
            roomId: restricted.body.room.id,
            event: {
              type: "chat",
              payload: { text: "forged" },
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
  });
});
