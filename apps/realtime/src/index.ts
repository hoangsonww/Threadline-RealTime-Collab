/**
 * The realtime tier: a Cloudflare Worker fronting one
 * {@link RoomDurableObject} per room.
 *
 * This service owns WebRTC signalling, presence, and live fan-out. It owns no
 * durable truth — persistence belongs to `apps/api`, which this Worker reaches
 * through an authenticated internal ingest webhook with its own retry schedule.
 *
 * **The invariant that defines this file:** the Durable Object verifies the
 * room ticket itself, on every connection, rather than trusting that `apps/api`
 * authorized the join before issuing one. The two services are separately
 * deployed and separately reachable, so a check that exists only upstream
 * protects nothing here. See
 * [`docs/security.md`](../../../docs/security.md) and
 * [`docs/realtime.md`](../../../docs/realtime.md).
 *
 * Runtime notes for anyone editing this: it runs on workerd, not Node — no
 * filesystem, no `process`, no Node built-ins. The object hibernates, so
 * in-memory fields do not survive an idle period and anything that must persist
 * goes to storage. Tests run under `@cloudflare/vitest-pool-workers` in a real
 * workerd instance, which is why `apps/realtime` is excluded from the root
 * vitest config and invoked separately.
 *
 * @module
 */

import { jwtVerify } from "jose";

/**
 * Bindings and secrets, as declared in `wrangler.toml`.
 *
 * `ROOM_TICKET_SECRET` is shared with `apps/api`, which signs the tickets this
 * Worker verifies. It authorizes exactly that one thing — see the secrets
 * inventory in [`docs/security.md`](../../../docs/security.md#secrets-inventory).
 *
 * The persistence pair is optional: with no webhook configured the room still
 * works live, it just records nothing.
 */
export interface Env {
  ROOM: DurableObjectNamespace;
  ROOM_TICKET_SECRET: string;
  PERSISTENCE_WEBHOOK?: string;
  PERSISTENCE_SECRET?: string;
}

/** The claims carried inside a verified room ticket. Never taken from client input. */
type TicketIdentity = { userId: string; username: string; role: string };
/** A connected participant: verified identity plus per-connection live state. */
type Participant = TicketIdentity & {
  connectionId: string;
  joinedAt: string;
  screenSharing: boolean;
};
/**
 * Every message a client may send.
 *
 * A closed union rather than an open envelope, so an unrecognised `type` is
 * rejected by construction instead of falling through to a default branch.
 */
type ClientMessage =
  | { type: "heartbeat"; payload?: unknown }
  | { type: "signal"; payload?: unknown; to?: string }
  | { type: "cursor"; payload?: unknown }
  | { type: "whiteboard"; payload: WhiteboardStroke | { clear: true } }
  | { type: "chat"; payload: { text: string } }
  | { type: "editor"; payload: { document: "code" | "notes"; content: string } }
  | { type: "screen-share"; payload: { active: boolean } };
/** Every message the room broadcasts back. */
type ServerMessage = { type: string; payload?: unknown; from?: string; at?: string };
/** A point on the whiteboard, in the canvas's own coordinate space. */
type Point = { x: number; y: number };

/** One drawn segment. The board is the ordered list of these. */
type WhiteboardStroke = { from: Point; to: Point };

/** The subset of a room's traffic that is durable enough to send to `apps/api`. */
type PersistedEvent = { type: string; payload: unknown; from: string; at: string };
/**
 * One queued attempt to persist an event upstream.
 *
 * Retry state travels with the delivery rather than living in memory, because
 * the object hibernates between attempts and an in-memory schedule would not
 * survive that.
 */
type Delivery = {
  deliveryId?: string;
  roomId: string;
  event: PersistedEvent;
  attemptCount?: number;
  nextAttemptAt?: number;
  queuedAt?: number;
};

/** Base delay for the exponential persistence retry. */
const deliveryRetryBaseMs = 30_000;
/** Retry backoff ceiling — thirty minutes, so a long API outage does not become a hot loop. */
const deliveryRetryMaxMs = 30 * 60_000;
/** After this many failures a delivery is dropped rather than retried forever. */
const deliveryMaxAttempts = 8;
/**
 * How long the editor must be idle before its contents are persisted.
 *
 * Editor content is a *replace*, not an append: persisting every keystroke
 * would write thousands of near-identical events for one paragraph.
 */
/**
 * Ceiling on retained whiteboard segments.
 *
 * At roughly 50 bytes of JSON per segment this caps the board near 200 KB,
 * which is comfortable for both Durable Object storage and a single persisted
 * snapshot. A continuous drag emits a segment per pointermove, so this is
 * minutes of uninterrupted drawing rather than a limit anyone meets by
 * sketching a diagram.
 */
const maxWhiteboardStrokes = 4_000;

const editorPersistenceQuietMs = 2_000;
/**
 * Upper bound on the quiet-period debounce.
 *
 * Without it, continuous typing would defer the write indefinitely and a
 * disconnection mid-paragraph would lose all of it.
 */
const editorPersistenceMaxWaitMs = 10_000;

/**
 * Whether a failed persistence attempt is worth retrying.
 *
 * 5xx, plus the 4xx statuses that describe a transient condition rather than a
 * bad request: 408 timeout, 425 too early, 429 rate limited. A 400 or a 403
 * will fail identically forever, so retrying it only amplifies the problem.
 */
export const isRetryableDeliveryStatus = (status: number) =>
  status >= 500 || status === 408 || status === 425 || status === 429;

/** Exponential backoff for attempt `n`, clamped to `deliveryRetryMaxMs`. */
export const deliveryRetryDelay = (attemptCount: number) =>
  Math.min(deliveryRetryBaseMs * 2 ** Math.max(0, attemptCount - 1), deliveryRetryMaxMs);

const encoder = new TextEncoder();
const send = (socket: WebSocket, message: ServerMessage) => socket.send(JSON.stringify(message));
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** A finite coordinate. Rejects NaN and Infinity, which survive `typeof === "number"`. */
const isPoint = (value: unknown): value is Point =>
  isObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y);

function isClientMessage(value: unknown): value is ClientMessage {
  if (!isObject(value) || typeof value.type !== "string") return false;
  if (["heartbeat", "cursor"].includes(value.type)) return true;
  // Whiteboard payloads are now validated rather than accepted as `unknown`,
  // because they are persisted: an unchecked payload used to be discarded after
  // fan-out, and is now written to storage and replayed to every future joiner.
  if (value.type === "whiteboard")
    return (
      isObject(value.payload) &&
      (value.payload.clear === true || (isPoint(value.payload.from) && isPoint(value.payload.to)))
    );
  if (value.type === "signal") return typeof value.to === "string" && value.to.length > 0 && value.to.length <= 128;
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

/**
 * One room's live coordinator.
 *
 * There is exactly one instance per room, globally — which is what makes
 * ordering, presence, and fan-out tractable without a consensus protocol. That
 * choice is recorded in
 * [ADR 0001](../../../docs/decisions/0001-durable-objects-for-realtime.md), and
 * the hibernatable SQLite-backed storage it uses in
 * [ADR 0005](../../../docs/decisions/0005-sqlite-hibernatable-durable-object.md).
 *
 * The constructor restores state inside `blockConcurrencyWhile`, so no request
 * is served against a half-restored object.
 */
export class RoomDurableObject implements DurableObject {
  private participants = new Map<string, Participant>();
  private events: Array<{ type: string; payload: unknown; from: string; at: string }> = [];
  private roomId = "";
  /**
   * The whiteboard, as the ordered list of segments drawn on it.
   *
   * Held in storage rather than only in memory because the object hibernates,
   * and because this is now the board's authoritative state — it is what a
   * joining client is sent and what a reconnecting one is restored from.
   */
  private strokes: WhiteboardStroke[] = [];

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
      this.strokes = (await this.state.storage.get<WhiteboardStroke[]>("whiteboard_strokes")) ?? [];
      this.restoreParticipants();
    });
  }

  /**
   * Entry point for every request routed to this room.
   *
   * Verifies the ticket **before** anything else — including before reading the
   * upgrade header — so an unauthenticated caller cannot reach any other code
   * path here. A missing ticket is 401, an invalid one is 403.
   *
   * Without an `Upgrade: websocket` header this returns a JSON snapshot of the
   * room instead of opening a socket.
   */
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
        whiteboardStrokes: this.strokes,
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    await this.acceptSocket(server, identity);
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Handles one inbound client message.
   *
   * The participant identity comes from the socket's attachment — established
   * from the verified ticket at accept time — never from the message body. A
   * socket authorized as one participant therefore cannot emit events
   * attributed to another, which is the check that a naive implementation
   * omits.
   *
   * Binary frames and anything over 64 KB are rejected outright rather than
   * parsed.
   */
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
    if (event.type === "screen-share") {
      participant.screenSharing = event.payload.active;
      // Attachments are the source of truth after hibernation, so every mutation
      // must be serialized back onto the socket before this object can sleep.
      socket.serializeAttachment(participant);
      this.participants.set(participant.connectionId, participant);
    }
    const payload =
      event.type === "chat" ? { text: event.payload.text.trim(), username: participant.username } : event.payload;
    const usesConnectionTarget = event.type === "signal" && !!event.to && this.participants.has(event.to);
    const envelope = {
      type: event.type,
      payload,
      // SDP/ICE belongs to one browser connection. Persisted collaboration events
      // continue to use the account ID for authorization and audit attribution. The
      // user-ID fallback keeps already-open clients alive during the rolling deploy.
      from: event.type === "signal" && usesConnectionTarget ? participant.connectionId : participant.userId,
      at: new Date().toISOString(),
    };
    this.broadcast(envelope, event.type === "signal" ? event.to : undefined);

    // The whiteboard is applied to accumulated state rather than recorded as one
    // event per segment. `draw()` publishes on every pointermove, so recording
    // each one would push hundreds of events per second through `record()`,
    // whose history is capped at 250 — a few seconds of drawing would evict
    // every chat message in the room. The board is therefore persisted the way
    // the editor is: as a snapshot that replaces its predecessor.
    if (event.type === "whiteboard") {
      await this.applyWhiteboard(event.payload, participant.userId);
      return;
    }

    if (event.type !== "cursor" && event.type !== "signal") await this.record(envelope);
    if (event.type === "screen-share") this.broadcast({ type: "presence", payload: [...this.participants.values()] });
  }

  /** Removes a departing participant and tells the room. */
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
    const userStillPresent = [...this.participants.values()].some((item) => item.userId === participant.userId);
    if (!userStillPresent)
      await this.record({
        type: "participant.left",
        payload: { userId: participant.userId },
        from: participant.userId,
        at: new Date().toISOString(),
      });
  }

  /** Treats a socket error as a departure — the connection is gone either way. */
  async webSocketError(socket: WebSocket) {
    await this.webSocketClose(socket);
  }

  /**
   * Drains the persistence queue and flushes pending editor writes.
   *
   * The alarm is the object's only self-initiated wake-up. It is what makes
   * retry survive hibernation: a delivery that failed while the room was busy
   * is retried later even if nobody has reconnected since.
   */
  async alarm() {
    const queued = await this.state.storage.list<Delivery>({ prefix: "delivery:" });
    const timestamp = Date.now();
    for (const [key, delivery] of queued) {
      if (!delivery.nextAttemptAt || delivery.nextAttemptAt <= timestamp) await this.deliver(key, delivery);
    }
    await this.scheduleNextDelivery();
  }

  private async acceptSocket(socket: WebSocket, identity: TicketIdentity) {
    const alreadyPresent = [...this.participants.values()].some((item) => item.userId === identity.userId);
    const participant: Participant = {
      ...identity,
      connectionId: crypto.randomUUID(),
      joinedAt: new Date().toISOString(),
      screenSharing: false,
    };
    // Hibernatable sockets preserve their attachment and lifecycle handlers
    // without keeping the Durable Object resident between messages.
    this.state.acceptWebSocket(socket);
    socket.serializeAttachment(participant);
    this.participants.set(participant.connectionId, participant);
    send(socket, {
      type: "room.ready",
      // The board travels as its own field rather than being reconstructed from
      // `recentEvents`. That list is sliced to the last 100, so in a chatty room
      // the newest whiteboard snapshot would scroll out of the window and a
      // joiner would be handed an empty canvas for a board that is not empty.
      payload: {
        participant,
        participants: [...this.participants.values()],
        recentEvents: this.events.slice(-100),
        whiteboardStrokes: this.strokes,
      },
    });
    this.broadcast({ type: "presence", payload: [...this.participants.values()] });
    if (!alreadyPresent)
      await this.record({
        type: "participant.joined",
        payload: { userId: participant.userId },
        from: participant.userId,
        at: new Date().toISOString(),
      });
  }

  private broadcast(message: ServerMessage, recipientConnectionId?: string) {
    const usesConnectionTarget = !!recipientConnectionId && this.participants.has(recipientConnectionId);
    for (const socket of this.state.getWebSockets()) {
      const participant = socket.deserializeAttachment() as Participant | null;
      if (
        recipientConnectionId &&
        (usesConnectionTarget
          ? participant?.connectionId !== recipientConnectionId
          : participant?.userId !== recipientConnectionId)
      )
        continue;
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
      if (participant) this.participants.set(participant.connectionId, participant);
    }
  }

  /**
   * Applies one whiteboard message to the board and persists the result.
   *
   * A segment appends; `{ clear: true }` empties the board, which is the only
   * thing that does — that is the entire point of the change, since previously
   * every disconnect cleared it implicitly.
   *
   * The snapshot written to `apps/api` always carries the *complete* board, not
   * a delta. That matters because room history is bounded at both ends: an
   * older snapshot being evicted is harmless when the newest one is whole,
   * whereas evicting one delta out of a chain would leave a silently corrupted
   * drawing. Same reasoning as the editor, which persists whole documents.
   */
  private async applyWhiteboard(payload: WhiteboardStroke | { clear: true }, actorId: string) {
    if ("clear" in payload) {
      this.strokes = [];
    } else {
      this.strokes.push({ from: payload.from, to: payload.to });
      // Bounded for the same reason `events` is: a room left open with someone
      // leaning on a stylus must not grow this object's storage without limit.
      // Dropping the oldest segments degrades an over-long drawing gracefully
      // rather than refusing new strokes, which would look like a broken pen.
      if (this.strokes.length > maxWhiteboardStrokes) this.strokes = this.strokes.slice(-maxWhiteboardStrokes);
    }
    await this.state.storage.put("whiteboard_strokes", this.strokes);

    if (!this.env.PERSISTENCE_WEBHOOK || !this.env.PERSISTENCE_SECRET) return;

    // Coalesced exactly like the editor: broadcast is immediate, but only the
    // latest board needs to reach Mongo, and only after the pen stops moving.
    const delivery = {
      deliveryId: crypto.randomUUID(),
      roomId: this.roomId,
      event: {
        type: "whiteboard",
        payload: { strokes: this.strokes },
        from: actorId,
        at: new Date().toISOString(),
      },
    };
    const key = "delivery:whiteboard";
    const current = await this.state.storage.get<Delivery>(key);
    const timestamp = Date.now();
    const queuedAt = current?.queuedAt ?? timestamp;
    const nextAttemptAt = Math.min(timestamp + editorPersistenceQuietMs, queuedAt + editorPersistenceMaxWaitMs);
    await this.state.storage.put(key, { ...delivery, queuedAt, nextAttemptAt });
    await this.scheduleAlarmAt(nextAttemptAt);
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

  private async verifyTicket(ticket: string, roomId: string): Promise<TicketIdentity | undefined> {
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
      };
    } catch {
      return undefined;
    }
  }
}

/**
 * The Worker entry point.
 *
 * Routes a request to the Durable Object for its room. It holds no state and
 * makes no authorization decision of its own — the ticket check happens inside
 * {@link RoomDurableObject.fetch}, where the room's identity is unambiguous.
 */
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
