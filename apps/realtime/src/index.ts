import { jwtVerify } from "jose";

export interface Env {
  ROOM: DurableObjectNamespace;
  ROOM_TICKET_SECRET: string;
  PERSISTENCE_WEBHOOK?: string;
  PERSISTENCE_SECRET?: string;
}

type Participant = { userId: string; username: string; role: string; joinedAt: string; screenSharing: boolean };
type ClientMessage = {
  type: "heartbeat" | "signal" | "cursor" | "chat" | "editor" | "whiteboard" | "screen-share" | "timeline";
  payload?: unknown;
  to?: string;
};
type ServerMessage = { type: string; payload?: unknown; from?: string; at?: string };
type PersistedEvent = { type: string; payload: unknown; from: string; at: string };
type Delivery = { roomId: string; event: PersistedEvent };

const encoder = new TextEncoder();
const send = (socket: WebSocket, message: ServerMessage) => socket.send(JSON.stringify(message));

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
    let event: ClientMessage;
    try {
      event = JSON.parse(message) as ClientMessage;
    } catch {
      return socket.close(1007, "Malformed JSON");
    }
    if (
      !["heartbeat", "signal", "cursor", "chat", "editor", "whiteboard", "screen-share", "timeline"].includes(
        event.type,
      )
    )
      return;
    if (event.type === "heartbeat") return send(socket, { type: "heartbeat", at: new Date().toISOString() });
    if (event.type === "screen-share")
      participant.screenSharing = Boolean((event.payload as { active?: boolean })?.active);
    const envelope = {
      type: event.type,
      payload: event.payload,
      from: participant.userId,
      at: new Date().toISOString(),
    };
    this.broadcast(envelope, event.to);
    if (event.type !== "cursor" && event.type !== "signal" && event.type !== "whiteboard") await this.record(envelope);
    if (event.type === "screen-share") this.broadcast({ type: "presence", payload: [...this.participants.values()] });
  }

  async webSocketClose(socket: WebSocket) {
    const participant = socket.deserializeAttachment() as Participant | null;
    socket.close();
    if (!participant) return;
    this.restoreParticipants();
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
    for (const [key, delivery] of queued) await this.deliver(key, delivery);
    const remaining = await this.state.storage.list({ prefix: "delivery:" });
    if (remaining.size) await this.state.storage.setAlarm(Date.now() + 30_000);
  }

  private async acceptSocket(socket: WebSocket, participant: Participant) {
    socket.accept();
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
      if (!recipient || participant?.userId === recipient) send(socket, message);
    }
  }

  private restoreParticipants() {
    this.participants = new Map();
    for (const socket of this.state.getWebSockets()) {
      const participant = socket.deserializeAttachment() as Participant | null;
      if (participant) this.participants.set(participant.userId, participant);
    }
  }

  private async record(event: PersistedEvent) {
    this.events.push(event);
    this.events = this.events.slice(-250);
    await this.state.storage.put("recent_events", this.events);
    if (this.env.PERSISTENCE_WEBHOOK && this.env.PERSISTENCE_SECRET) {
      const key = `delivery:${crypto.randomUUID()}`;
      const delivery = { roomId: this.roomId, event };
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
      if (!response.ok) throw new Error(`Persistence returned ${response.status}.`);
      await this.state.storage.delete(key);
    } catch {
      await this.state.storage.setAlarm(Date.now() + 30_000);
    }
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
        username: payload.username,
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
