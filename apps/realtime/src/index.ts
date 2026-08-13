import { jwtVerify } from "jose";

export interface Env {
  ROOM: DurableObjectNamespace;
  ROOM_TICKET_SECRET: string;
  PERSISTENCE_WEBHOOK?: string;
  PERSISTENCE_SECRET?: string;
}

type Participant = { userId: string; username: string; role: string; joinedAt: string; screenSharing: boolean };
type ClientMessage =
  | { type: "heartbeat"; payload?: unknown }
  | { type: "signal"; payload?: unknown; to?: string }
  | { type: "cursor"; payload?: unknown }
  | { type: "whiteboard"; payload?: unknown }
  | { type: "chat"; payload: { text: string } }
  | { type: "editor"; payload: { document: "code" | "notes"; content: string } }
  | { type: "screen-share"; payload: { active: boolean } };
type ServerMessage = { type: string; payload?: unknown; from?: string; at?: string };
type PersistedEvent = { type: string; payload: unknown; from: string; at: string };
type Delivery = {
  deliveryId?: string;
  roomId: string;
  event: PersistedEvent;
  attemptCount?: number;
  nextAttemptAt?: number;
  queuedAt?: number;
};

const deliveryRetryBaseMs = 30_000;
const deliveryRetryMaxMs = 30 * 60_000;
const deliveryMaxAttempts = 8;
const editorPersistenceQuietMs = 2_000;
const editorPersistenceMaxWaitMs = 10_000;

export const isRetryableDeliveryStatus = (status: number) =>
  status >= 500 || status === 408 || status === 425 || status === 429;

export const deliveryRetryDelay = (attemptCount: number) =>
  Math.min(deliveryRetryBaseMs * 2 ** Math.max(0, attemptCount - 1), deliveryRetryMaxMs);

const encoder = new TextEncoder();
const send = (socket: WebSocket, message: ServerMessage) => socket.send(JSON.stringify(message));
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function isClientMessage(value: unknown): value is ClientMessage {
  if (!isObject(value) || typeof value.type !== "string") return false;
  if (["heartbeat", "cursor", "whiteboard"].includes(value.type)) return true;
  if (value.type === "signal") return value.to === undefined || typeof value.to === "string";
  if (!isObject(value.payload)) return false;
  if (value.type === "chat")
    return (
      typeof value.payload.text === "string" &&
      value.payload.text.trim().length > 0 &&
      value.payload.text.length <= 4_000
    );
  if (value.type === "editor")
    return (
      (value.payload.document === "code" || value.payload.document === "notes") &&
      typeof value.payload.content === "string" &&
      value.payload.content.length <= 64_000
    );
  if (value.type === "screen-share") return typeof value.payload.active === "boolean";
  return false;
}

export class RoomDurableObject implements DurableObject {
  private participants = new Map<string, Participant>();
  private events: Array<{ type: string; payload: unknown; from: string; at: string }> = [];
  private roomId = "";

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    this.state.blockConcurrencyWhile(async () => {
      this.events =
        (await this.state.storage.get<Array<{ type: string; payload: unknown; from: string; at: string }>>(
          "recent_events",
        )) ?? [];
      this.roomId = (await this.state.storage.get<string>("room_id")) ?? "";
      this.restoreParticipants();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomId = url.pathname.split("/").filter(Boolean).at(-1);
    const ticket = url.searchParams.get("ticket");
    if (!roomId || !ticket) return new Response("Room ticket is required", { status: 401 });
    const identity = await this.verifyTicket(ticket, roomId);
    if (!identity) return new Response("Invalid room ticket", { status: 403 });
    this.roomId = roomId;
    await this.state.storage.put("room_id", roomId);

    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json({
        roomId,
        participants: [...this.participants.values()],
        recentEvents: this.events.slice(-100),
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.acceptSocket(server, identity);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const participant = socket.deserializeAttachment() as Participant | null;
    if (!participant || typeof message !== "string" || message.length > 64_000)
      return socket.close(1008, "Invalid message");
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return socket.close(1007, "Malformed JSON");
    }
    if (!isClientMessage(parsed)) return socket.close(1008, "Invalid event");
    const event = parsed;
    // Tickets are issued from the API after ABAC evaluation. A viewer may
    // receive media/signalling and presence but cannot mutate shared state.
    if (participant.role === "viewer" && ["chat", "editor", "whiteboard", "screen-share"].includes(event.type))
      return socket.close(1008, "Room role does not permit writing");
    if (event.type === "heartbeat") return send(socket, { type: "heartbeat", at: new Date().toISOString() });
    if (event.type === "screen-share") participant.screenSharing = event.payload.active;
    const payload =
      event.type === "chat" ? { text: event.payload.text.trim(), username: participant.username } : event.payload;
    const envelope = {
      type: event.type,
      payload,
      from: participant.userId,
      at: new Date().toISOString(),
    };
    this.broadcast(envelope, event.type === "signal" ? event.to : undefined);
    if (event.type !== "cursor" && event.type !== "signal" && event.type !== "whiteboard") await this.record(envelope);
    if (event.type === "screen-share") this.broadcast({ type: "presence", payload: [...this.participants.values()] });
  }

  async webSocketClose(socket: WebSocket) {
    const participant = socket.deserializeAttachment() as Participant | null;
    socket.close();
    if (!participant) return;
    // state.getWebSockets() can still report this socket for a moment after the
    // platform has invoked this very close handler for it, so rebuilding from that
    // enumeration alone would re-add the participant we're supposed to be removing.
    // We know for certain this socket is gone, so exclude it explicitly.
    this.restoreParticipants(socket);
    this.broadcast({ type: "presence", payload: [...this.participants.values()] });
    await this.record({
      type: "participant.left",
      payload: { userId: participant.userId },
      from: participant.userId,
      at: new Date().toISOString(),
    });
  }

  async webSocketError(socket: WebSocket) {
    await this.webSocketClose(socket);
  }

  async alarm() {
    const queued = await this.state.storage.list<Delivery>({ prefix: "delivery:" });
    const timestamp = Date.now();
    for (const [key, delivery] of queued) {
      if (!delivery.nextAttemptAt || delivery.nextAttemptAt <= timestamp) await this.deliver(key, delivery);
    }
    await this.scheduleNextDelivery();
  }

  private async acceptSocket(socket: WebSocket, participant: Participant) {
    // Hibernatable sockets preserve their attachment and lifecycle handlers
    // without keeping the Durable Object resident between messages.
    this.state.acceptWebSocket(socket);
    socket.serializeAttachment(participant);
    this.participants.set(participant.userId, participant);
    send(socket, {
      type: "room.ready",
      payload: { participant, participants: [...this.participants.values()], recentEvents: this.events.slice(-100) },
    });
    this.broadcast({ type: "presence", payload: [...this.participants.values()] });
    await this.record({
      type: "participant.joined",
      payload: { userId: participant.userId },
      from: participant.userId,
      at: new Date().toISOString(),
    });
  }

  private broadcast(message: ServerMessage, recipient?: string) {
    for (const socket of this.state.getWebSockets()) {
      const participant = socket.deserializeAttachment() as Participant | null;
      if (recipient && participant?.userId !== recipient) continue;
      try {
        send(socket, message);
      } catch {
        // The socket closed between getWebSockets() and send() (e.g. it's the
        // very socket whose close just triggered this broadcast). Skip it so
        // one stale socket can't abort delivery to everyone else, or abort
        // the caller before it finishes recording the close event.
      }
    }
  }

  private restoreParticipants(excludeSocket?: WebSocket) {
    this.participants = new Map();
    for (const socket of this.state.getWebSockets()) {
      if (socket === excludeSocket) continue;
      const participant = socket.deserializeAttachment() as Participant | null;
      if (participant) this.participants.set(participant.userId, participant);
    }
  }

  private async record(event: PersistedEvent) {
    this.events.push(event);
    this.events = this.events.slice(-250);
    await this.state.storage.put("recent_events", this.events);
    if (this.env.PERSISTENCE_WEBHOOK && this.env.PERSISTENCE_SECRET) {
      const delivery = { deliveryId: crypto.randomUUID(), roomId: this.roomId, event };
      const document =
        event.type === "editor" && typeof event.payload === "object" && event.payload !== null
          ? (event.payload as { document?: unknown }).document
          : undefined;
      if (document === "code" || document === "notes") {
        // Editor updates still broadcast immediately, but only the latest snapshot
        // needs to cross into Mongo. Persist after a pause, or at least every ten
        // seconds during continuous typing, instead of once per keystroke.
        const key = `delivery:editor:${document}`;
        const current = await this.state.storage.get<Delivery>(key);
        const timestamp = Date.now();
        const queuedAt = current?.queuedAt ?? timestamp;
        const nextAttemptAt = Math.min(timestamp + editorPersistenceQuietMs, queuedAt + editorPersistenceMaxWaitMs);
        await this.state.storage.put(key, { ...delivery, queuedAt, nextAttemptAt });
        await this.scheduleAlarmAt(nextAttemptAt);
        return;
      }

      const key = `delivery:${delivery.deliveryId}`;
      await this.state.storage.put(key, delivery);
      this.state.waitUntil(this.deliver(key, delivery));
    }
  }

  private async deliver(key: string, delivery: Delivery) {
    if (!this.env.PERSISTENCE_WEBHOOK || !this.env.PERSISTENCE_SECRET) return;
    try {
      const response = await fetch(this.env.PERSISTENCE_WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json", "x-threadline-ingest": this.env.PERSISTENCE_SECRET },
        body: JSON.stringify(delivery),
      });
      if (!response.ok && !isRetryableDeliveryStatus(response.status)) {
        // A malformed, unauthorized, or forbidden event will never become valid
        // by sending it again. Keeping it queued creates an infinite request loop.
        await this.deleteDeliveryIfCurrent(key, delivery);
        console.warn(
          JSON.stringify({
            message: "Discarding permanently rejected room event delivery.",
            roomId: delivery.roomId,
            eventType: delivery.event.type,
            status: response.status,
          }),
        );
        return;
      }
      if (!response.ok) throw new Error(`Persistence returned ${response.status}.`);
      await this.deleteDeliveryIfCurrent(key, delivery);
    } catch (error) {
      const attemptCount = (delivery.attemptCount ?? 0) + 1;
      if (attemptCount >= deliveryMaxAttempts) {
        await this.deleteDeliveryIfCurrent(key, delivery);
        console.error(
          JSON.stringify({
            message: "Discarding room event delivery after retry limit.",
            roomId: delivery.roomId,
            eventType: delivery.event.type,
            attemptCount,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return;
      }

      const delayMs = deliveryRetryDelay(attemptCount);
      const nextAttemptAt = Date.now() + delayMs;
      const current = await this.state.storage.get<Delivery>(key);
      if (delivery.deliveryId && current?.deliveryId !== delivery.deliveryId) return;
      await this.state.storage.put(key, { ...delivery, attemptCount, nextAttemptAt });
      await this.scheduleAlarmAt(nextAttemptAt);
      console.error(
        JSON.stringify({
          message: "Room event delivery failed; retry scheduled.",
          roomId: delivery.roomId,
          eventType: delivery.event.type,
          attemptCount,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  private async deleteDeliveryIfCurrent(key: string, delivery: Delivery) {
    if (!delivery.deliveryId) {
      await this.state.storage.delete(key);
      return;
    }
    const current = await this.state.storage.get<Delivery>(key);
    if (current?.deliveryId === delivery.deliveryId) await this.state.storage.delete(key);
  }

  private async scheduleAlarmAt(timestamp: number) {
    const current = await this.state.storage.getAlarm();
    if (current === null || timestamp < current) await this.state.storage.setAlarm(timestamp);
  }

  private async scheduleNextDelivery() {
    const queued = await this.state.storage.list<Delivery>({ prefix: "delivery:" });
    if (!queued.size) {
      await this.state.storage.deleteAlarm();
      return;
    }
    const nextAttemptAt = Math.min(
      ...[...queued.values()].map((delivery) => delivery.nextAttemptAt ?? Date.now() + deliveryRetryBaseMs),
    );
    await this.state.storage.setAlarm(nextAttemptAt);
  }

  private async verifyTicket(ticket: string, roomId: string): Promise<Participant | undefined> {
    try {
      const { payload } = await jwtVerify(ticket, encoder.encode(this.env.ROOM_TICKET_SECRET), {
        algorithms: ["HS256"],
      });
      if (
        payload.room_id !== roomId ||
        !payload.sub ||
        typeof payload.username !== "string" ||
        typeof payload.role !== "string"
      )
        return undefined;
      return {
        userId: payload.sub,
        username: typeof payload.display_name === "string" ? payload.display_name.slice(0, 80) : payload.username,
        role: payload.role,
        joinedAt: new Date().toISOString(),
        screenSharing: false,
      };
    } catch {
      return undefined;
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ status: "ok", service: "threadline-realtime" });
    const match = url.pathname.match(/^\/rooms\/([^/]+)$/);
    if (!match) return new Response("Not found", { status: 404 });
    const id = env.ROOM.idFromName(match[1]);
    return env.ROOM.get(id).fetch(request);
  },
};
