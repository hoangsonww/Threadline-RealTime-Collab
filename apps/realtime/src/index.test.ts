import { env, fetchMock, runInDurableObject, SELF } from "cloudflare:test";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { deliveryRetryDelay, isRetryableDeliveryStatus, type Env, type RoomDurableObject } from "./index";

const ticketSecret = new TextEncoder().encode("test-ticket-secret");

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock
    .get("https://threadline-app-api.vercel.app")
    .intercept({ path: "/v1/internal/room-events", method: "POST" })
    .reply(202)
    .persist();
});

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

type TestParticipant = { connectionId: string; userId: string; username: string };
type TestMessage = { type: string; payload?: unknown; from?: string };

function nextMessage(socket: WebSocket) {
  return new Promise<TestMessage>((resolve) => {
    socket.addEventListener("message", (event) => resolve(JSON.parse(event.data as string)), { once: true });
  });
}

async function recentEventTypes(roomId: string, userId: string, username: string) {
  const ticket = await ticketFor(roomId, userId, username);
  const response = await SELF.fetch(`https://example.com/rooms/${roomId}?ticket=${encodeURIComponent(ticket)}`);
  const body = await response.json<{ recentEvents: Array<{ type: string }> }>();
  return body.recentEvents.map((event) => event.type);
}

async function whiteboardOf(roomId: string, userId: string, username: string) {
  const ticket = await ticketFor(roomId, userId, username);
  const response = await SELF.fetch(`https://example.com/rooms/${roomId}?ticket=${encodeURIComponent(ticket)}`);
  const body = await response.json<{ whiteboardStrokes?: Array<{ from: unknown; to: unknown }> }>();
  return body.whiteboardStrokes ?? [];
}

describe("RoomDurableObject", () => {
  it("does not retry permanent webhook rejections", () => {
    expect(isRetryableDeliveryStatus(400)).toBe(false);
    expect(isRetryableDeliveryStatus(401)).toBe(false);
    expect(isRetryableDeliveryStatus(403)).toBe(false);
    expect(isRetryableDeliveryStatus(404)).toBe(false);
    expect(isRetryableDeliveryStatus(409)).toBe(false);
  });

  it("backs off temporary webhook failures with a bounded delay", () => {
    expect(isRetryableDeliveryStatus(408)).toBe(true);
    expect(isRetryableDeliveryStatus(425)).toBe(true);
    expect(isRetryableDeliveryStatus(429)).toBe(true);
    expect(isRetryableDeliveryStatus(500)).toBe(true);
    expect(deliveryRetryDelay(1)).toBe(30_000);
    expect(deliveryRetryDelay(2)).toBe(60_000);
    expect(deliveryRetryDelay(20)).toBe(30 * 60_000);
  });

  it("coalesces editor persistence while still accepting every live update", async () => {
    const roomId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const socket = await connect(roomId, userId, "Editor");
    await nextMessage(socket);

    socket.send(JSON.stringify({ type: "editor", payload: { document: "notes", content: "first" } }));
    socket.send(JSON.stringify({ type: "editor", payload: { document: "notes", content: "latest" } }));

    const namespace = (env as Env).ROOM;
    const stub = namespace.get(namespace.idFromName(roomId));
    let pending: Array<{ event: { payload: unknown } }> = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      pending = await runInDurableObject(stub, async (_instance: RoomDurableObject, state) => [
        ...(await state.storage.list<{ event: { payload: unknown } }>({ prefix: "delivery:editor:" })).values(),
      ]);
      if ((pending[0]?.event.payload as { content?: string } | undefined)?.content === "latest") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(pending).toHaveLength(1);
    expect(pending[0].event.payload).toEqual({ document: "notes", content: "latest" });
    socket.close();
  });

  it("rejects invalid mutation payloads before they enter the persistence queue", async () => {
    const roomId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const socket = await connect(roomId, userId, "Writer");
    await nextMessage(socket);

    socket.send(JSON.stringify({ type: "chat", payload: { text: "" } }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(await recentEventTypes(roomId, userId, "Writer")).not.toContain("chat");
  });

  it("keeps whiteboard strokes after every participant disconnects", async () => {
    const roomId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const socket = await connect(roomId, userId, "Artist");
    await nextMessage(socket);

    socket.send(JSON.stringify({ type: "whiteboard", payload: { from: { x: 1, y: 2 }, to: { x: 3, y: 4 } } }));
    socket.send(JSON.stringify({ type: "whiteboard", payload: { from: { x: 3, y: 4 }, to: { x: 5, y: 6 } } }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    // The disconnect is the whole point: this is what used to wipe the board.
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 25));

    const strokes = await whiteboardOf(roomId, userId, "Artist");
    expect(strokes).toEqual([
      { from: { x: 1, y: 2 }, to: { x: 3, y: 4 } },
      { from: { x: 3, y: 4 }, to: { x: 5, y: 6 } },
    ]);
  });

  it("clears the board only when a participant explicitly clears it", async () => {
    const roomId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const socket = await connect(roomId, userId, "Artist");
    await nextMessage(socket);

    socket.send(JSON.stringify({ type: "whiteboard", payload: { from: { x: 1, y: 1 }, to: { x: 2, y: 2 } } }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(await whiteboardOf(roomId, userId, "Artist")).toHaveLength(1);

    socket.send(JSON.stringify({ type: "whiteboard", payload: { clear: true } }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(await whiteboardOf(roomId, userId, "Artist")).toHaveLength(0);
  });

  it("rejects malformed whiteboard payloads instead of storing them", async () => {
    const roomId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const socket = await connect(roomId, userId, "Artist");
    await nextMessage(socket);

    // Non-finite coordinates pass `typeof === "number"` and would poison every
    // future replay of this board if they were stored.
    socket.send(JSON.stringify({ type: "whiteboard", payload: { from: { x: Number.NaN, y: 0 }, to: { x: 1, y: 1 } } }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(await whiteboardOf(roomId, userId, "Artist")).toHaveLength(0);
  });

  it("does not let a viewer draw on the board", async () => {
    const roomId = crypto.randomUUID();
    const owner = crypto.randomUUID();
    const author = await connect(roomId, owner, "Author");
    await nextMessage(author);
    author.send(JSON.stringify({ type: "whiteboard", payload: { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } } }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    const viewerId = crypto.randomUUID();
    const viewerTicket = await new SignJWT({ room_id: roomId, role: "viewer", username: "Viewer" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("https://threadline.test")
      .setSubject(viewerId)
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(ticketSecret);
    const viewerResponse = await SELF.fetch(
      `https://example.com/rooms/${roomId}?ticket=${encodeURIComponent(viewerTicket)}`,
      { headers: { Upgrade: "websocket" } },
    );
    const viewer = viewerResponse.webSocket;
    if (!viewer) throw new Error("Expected a WebSocket upgrade response.");
    viewer.accept();
    await nextMessage(viewer);

    viewer.send(JSON.stringify({ type: "whiteboard", payload: { from: { x: 9, y: 9 }, to: { x: 10, y: 10 } } }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    // The author's single stroke survives; the viewer's is not added.
    expect(await whiteboardOf(roomId, owner, "Author")).toHaveLength(1);
  });

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

  it("keeps two devices for one account as distinct signaling endpoints", async () => {
    const roomId = crypto.randomUUID();
    const firstDevice = await connect(roomId, "user-a", "Alice");
    const firstReady = await nextMessage(firstDevice);
    const firstParticipant = (firstReady.payload as { participant: TestParticipant }).participant;

    const secondDevice = await connect(roomId, "user-a", "Alice");
    const secondReady = await nextMessage(secondDevice);
    const secondPayload = secondReady.payload as {
      participant: TestParticipant;
      participants: TestParticipant[];
    };
    expect(secondPayload.participant.connectionId).not.toBe(firstParticipant.connectionId);
    expect(secondPayload.participants.filter((participant) => participant.userId === "user-a")).toHaveLength(2);

    const firstMessages: TestMessage[] = [];
    const secondMessages: TestMessage[] = [];
    firstDevice.addEventListener("message", (event) => firstMessages.push(JSON.parse(event.data as string)));
    secondDevice.addEventListener("message", (event) => secondMessages.push(JSON.parse(event.data as string)));

    const bob = await connect(roomId, "user-b", "Bob");
    const bobReady = await nextMessage(bob);
    const bobParticipant = (bobReady.payload as { participant: TestParticipant }).participant;
    bob.send(
      JSON.stringify({
        type: "signal",
        to: firstParticipant.connectionId,
        payload: { candidate: { candidate: "candidate:device-one" } },
      }),
    );

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (firstMessages.some((message) => message.type === "signal")) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(firstMessages.find((message) => message.type === "signal")?.from).toBe(bobParticipant.connectionId);
    expect(secondMessages.some((message) => message.type === "signal")).toBe(false);

    firstDevice.close();
    secondDevice.close();
    bob.close();
  }, 10_000);

  it("records account presence only on its first connection and final disconnection", async () => {
    const roomId = crypto.randomUUID();
    const firstDevice = await connect(roomId, "user-a", "Alice");
    await nextMessage(firstDevice);
    const secondDevice = await connect(roomId, "user-a", "Alice");
    await nextMessage(secondDevice);

    firstDevice.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    let types = await recentEventTypes(roomId, "user-a", "Alice");
    expect(types.filter((type) => type === "participant.joined")).toHaveLength(1);
    expect(types).not.toContain("participant.left");

    secondDevice.close();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      types = await recentEventTypes(roomId, "user-a", "Alice");
      if (types.includes("participant.left")) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(types.filter((type) => type === "participant.left")).toHaveLength(1);
  }, 10_000);
});
