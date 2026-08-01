import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryRepository } from "./repository";
import { OidcSigner } from "./security";

async function createTestApp() {
  const signer = await OidcSigner.create();
  const delivered: Array<{ type: string; actionUrl: string }> = [];
  const app = createApp({
    repository: new MemoryRepository(),
    issuer: "https://id.threadline.test",
    webOrigin: "https://app.threadline.test",
    secureCookies: false,
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
  it("creates a session, PAT, room, and short-lived room ticket", async () => {
    const { app } = await createTestApp();
    const agent = request.agent(app);
    const registration = await agent.post("/v1/auth/register").send({
      email: "avery@example.com",
      username: "avery",
      displayName: "Avery Chen",
      password: "correct-horse-battery",
      organizationName: "Northstar Engineering",
    });
    expect(registration.status).toBe(201);
    expect(registration.body.user.email).toBe("avery@example.com");

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
    expect(events.body.events).toHaveLength(1);
    expect(events.body.events[0].type).toBe("chat");
  });

  it("performs an authorization-code-with-PKCE exchange and serves userinfo", async () => {
    const { app } = await createTestApp();
    const agent = request.agent(app);
    await agent.post("/v1/auth/register").send({
      email: "lina@example.com",
      username: "lina",
      displayName: "Lina Novak",
      password: "correct-horse-battery",
      organizationName: "Northstar Engineering",
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
      organizationName: "Northstar Engineering",
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
});
