import { SELF } from "cloudflare:test";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

const ticketSecret = new TextEncoder().encode("test-ticket-secret");

async function ticketFor(roomId: string, userId: string, username: string) {
  return new SignJWT({ room_id: roomId, role: "member", username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(ticketSecret);
}

async function connect(roomId: string, userId: string, username: string) {
  const ticket = await ticketFor(roomId, userId, username);
  const response = await SELF.fetch(`https://example.com/rooms/${roomId}?ticket=${encodeURIComponent(ticket)}`, {
    headers: { Upgrade: "websocket" },
  });
  const socket = response.webSocket;
  if (!socket) throw new Error("Expected a WebSocket upgrade response.");
  socket.accept();
  return socket;
}

function nextMessage(socket: WebSocket) {
  return new Promise<{ type: string; payload?: unknown }>((resolve) => {
    socket.addEventListener("message", (event) => resolve(JSON.parse(event.data as string)), { once: true });
  });
}

async function recentEventTypes(roomId: string, userId: string, username: string) {
  const ticket = await ticketFor(roomId, userId, username);
  const response = await SELF.fetch(`https://example.com/rooms/${roomId}?ticket=${encodeURIComponent(ticket)}`);
  const body = await response.json<{ recentEvents: Array<{ type: string }> }>();
  return body.recentEvents.map((event) => event.type);
}

describe("RoomDurableObject", () => {
  it("rejects a WebSocket upgrade without a valid room ticket", async () => {
    const response = await SELF.fetch("https://example.com/rooms/no-ticket-room", {
      headers: { Upgrade: "websocket" },
    });
    expect(response.status).toBe(401);
    await response.text();
  });

  it("still records the participant.left event when a socket closes", async () => {
    // Regression test: webSocketClose() used to call broadcast(), which threw
    // "Can't call WebSocket send() after close()" when it reached the closing
    // socket itself (still present in state.getWebSockets() at that point).
    // That uncaught throw aborted webSocketClose() before it reached
    // `await this.record(...)`, so the participant.left event was silently
    // dropped from the durable timeline. See apps/realtime/src/index.ts.
    const roomId = crypto.randomUUID();
    const socket = await connect(roomId, "user-a", "Alice");
    await nextMessage(socket); // room.ready
    socket.close();

    let types: string[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      types = await recentEventTypes(roomId, "user-a", "Alice");
      if (types.includes("participant.left")) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(types).toContain("participant.left");
  });

  it("broadcasts presence to a remaining participant when another one leaves", async () => {
    const roomId = crypto.randomUUID();
    const alice = await connect(roomId, "user-a", "Alice");
    await nextMessage(alice); // room.ready for Alice

    const aliceMessages: Array<{ type: string; payload?: unknown }> = [];
    alice.addEventListener("message", (event) => aliceMessages.push(JSON.parse(event.data as string)));

    const bob = await connect(roomId, "user-b", "Bob");
    await nextMessage(bob); // room.ready for Bob
    bob.close();

    // Poll rather than await a single "next message": broadcast() may
    // deliver more than one presence update to Alice (Bob joining, then
    // Bob leaving), and ordering across sockets isn't guaranteed.
    let solo: Array<{ userId: string }> | undefined;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      solo = aliceMessages
        .filter((message) => message.type === "presence")
        .map((message) => message.payload as Array<{ userId: string }>)
        .find((participants) => participants.length === 1);
      if (solo) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(solo?.map((participant) => participant.userId)).toEqual(["user-a"]);

    alice.close();
  }, 10_000);
});
