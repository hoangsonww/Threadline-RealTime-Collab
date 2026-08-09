# ADR-0005: SQLite-backed, hibernatable Durable Object storage

## Status

Accepted

## Date

2026-08-01

## Context

`RoomDurableObject` (see [ADR-0001](0001-durable-objects-for-realtime.md)) needs to: hold each connected participant's identity for the life of their WebSocket, keep a short recent-events buffer for fast reconnect replay, and queue events awaiting hand-off to the API without losing them if the webhook is briefly unreachable. Cloudflare Durable Objects offer two storage backends (key-value and SQLite) and an optional hibernation API for WebSockets.

## Decision

- Use the **SQLite-backed** storage class (`new_sqlite_classes` migration in `apps/realtime/wrangler.toml`) for `this.state.storage`.
- Use **hibernatable WebSockets** (`state.acceptWebSocket()`, not a plain event-listener-based accept) so the Durable Object can be evicted from memory between messages.
- Serialize each participant's identity directly onto their socket (`socket.serializeAttachment()`) rather than looking it up from storage on every message, so it survives that eviction without a storage round-trip.

## Alternatives Considered

### Key-value storage instead of SQLite-backed

- Pros: Slightly simpler mental model for small, flat data.
- Cons: The room's undelivered-event queue (`delivery:<uuid>` keys, potentially several at once during an outage) and its recent-events buffer benefit from SQLite's transactional guarantees when the Durable Object is juggling concurrent socket messages and alarm-triggered retries.
- Rejected: SQLite-backed storage is Cloudflare's current recommended default for new Durable Objects and imposes no real cost here.

### Non-hibernatable WebSockets (hold the object resident for the life of every connection)

- Pros: Marginally simpler code — no need to think about what state must be serialized onto a socket versus reconstructed.
- Cons: A room with people connected but idle would keep the Durable Object (and its underlying compute) resident the entire time, for no benefit. Hibernation is specifically what makes "many rooms, mostly idle" cheap.
- Rejected: The cost of using the hibernation API correctly (the attachment pattern, and the specific `state.getWebSockets()` gotcha this uncovered — see [ADR pattern in `../realtime.md`](../realtime.md#one-crash-that-looked-like-a-persistence-bug)) is worth paying for the compute savings at rest.

Full Durable Object lifecycle (cold → constructing → active → hibernating → evicted → rehydrated): [`../architecture.md`](../architecture.md#durable-object-lifecycle).

## Consequences

- **Hibernation has a real, documented sharp edge, and it bit this codebase twice, not once.** A socket that has just closed is still reported by `state.getWebSockets()` while its own `webSocketClose` handler is running:
  - First: `broadcast()` called `send()` on that socket unconditionally, threw, and aborted the handler before it reached `record()` — durable `participant.left` events silently never got written. Fixed with a try/catch per socket. See [`../realtime.md`](../realtime.md#one-crash-that-looked-like-a-persistence-bug).
  - Second, found later, in the _same_ handler: `restoreParticipants()` rebuilt the presence list from that same `getWebSockets()` call, so the departing user re-added themselves to their own "who's here" broadcast on the way out — participants who left stayed visible in everyone else's UI forever. Fixed by excluding the specific socket the handler already knows is closing, instead of trusting the enumeration. See [`../realtime.md`](../realtime.md#a-second-quieter-hibernation-quirk-the-departing-socket-counts-itself-present).

  Same root cause both times — trusting `state.getWebSockets()` as ground truth for "who's still connected" during the exact handler invoked because someone just disconnected — and the second one shipped even after the first was fixed and tested, because it's a genuinely different symptom in different code.

- Code that broadcasts to "everyone" during a close handler must be written defensively (try/catch per socket, and explicit exclusion of the closing socket) rather than trusting the platform to have already updated its own bookkeeping by the time the handler runs.
- Testing this class faithfully requires running against the real Workers runtime (`@cloudflare/vitest-pool-workers`), not a plain Node mock — a stubbed `state.getWebSockets()` would never have reproduced the bug above. See [`../testing.md`](../testing.md#durable-object-tests) for the isolated-storage quirks that come with that test tooling.
- `wrangler dev`'s local emulation of hibernation and SQLite storage is close to, but not guaranteed identical to, Cloudflare's production runtime — a known source of local-only behavior differences (see [`../troubleshooting.md`](../troubleshooting.md)).
