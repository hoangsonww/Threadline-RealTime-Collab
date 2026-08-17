---
name: threadline-realtime-event
description: Use when changing the Durable Object message protocol in apps/realtime — adding a message type, changing presence or fan-out behavior, altering ticket verification, or touching room event persistence. Covers the workerd runtime constraints that make this tier different from the API.
---

# Changing the realtime protocol

`apps/realtime` is one Cloudflare Worker with **one `RoomDurableObject` per room**. It is not a second Node service and several things you would reach for reflexively are unavailable or behave differently.

## Runtime constraints — read before writing

- **This is workerd, not Node.** No filesystem, no `process`, no Node built-ins beyond what the Workers runtime polyfills. Tests run under `@cloudflare/vitest-pool-workers` in a real workerd instance, which is why `apps/realtime/**` is **excluded** from the root `vitest.config.ts` and invoked separately by the root `test` script. If your new test does not run, that exclusion is why.
- **The Durable Object hibernates.** It uses the WebSocket hibernation API with SQLite-backed storage. In-memory state on the instance does **not** survive hibernation. Anything that must outlive an idle period goes in storage, not in a field.
- **`worker-configuration.d.ts` is generated** by `wrangler types`, which runs as part of the workspace's `typecheck` script. Never hand-edit it. A diff in it is regeneration noise.
- **Room event history is bounded in the database**, not in memory — see the `perf(api)` commit that made that change and the contract recorded alongside it. Do not reintroduce unbounded in-memory accumulation.

## The invariant that matters most

**The Durable Object verifies the room ticket itself.** It does not trust that `apps/api` already authorized the connection.

This is the central claim of the whole architecture ([`docs/security.md`](../../../docs/security.md)). When you add a message type, ask: *does the ticket that admitted this connection actually authorize this new capability?* If the new message can do something the ticket's scope did not contemplate — write where the ticket only granted read, manage where it granted join — then the check that admitted the socket is not sufficient, and the handler needs its own.

Do not remove a verification because it looks redundant with something `apps/api` does. That redundancy is the design.

## Steps

### 1. Define the message

Extend the message handling in `apps/realtime/src/index.ts` — `webSocketMessage` for inbound, the fan-out path for outbound.

Validate the inbound payload. A message arriving over a WebSocket is untrusted input exactly as much as an HTTP body is, and the fact that the socket was authenticated says nothing about the shape of what arrives on it.

### 2. Authorize it

Check inside the handler, against what the connection's ticket actually granted. Presence events are a live example of a check that looks redundant and is not: the code asserts that a presence event's `userId` matches its actor, because a socket authorized as one participant must not be able to emit events attributed to another.

### 3. Decide what persists

Not every message should be recorded. Ephemeral signalling — ICE candidates, session descriptions, transient presence — should not accumulate in room history. Durable artefacts should.

If it persists, it flows to `apps/api` through the internal ingest path, which is authenticated with its own secret and verified independently on arrival.

### 4. Test it

`apps/realtime/src/index.test.ts`, under `@cloudflare/vitest-pool-workers`.

Cover the accepted path, the **rejected** path (a socket that should not be permitted to send this message), and a malformed payload. As with the API tier, the rejection path is the one that only ever runs in the suite.

```bash
npm run test --workspace=@threadline/realtime
```

### 5. Document it

[`docs/realtime.md`](../../../docs/realtime.md) is the protocol's specification. A message type that exists in code but not there will be re-litigated by the next person who reads either one.

If the change alters a trust boundary, [`docs/security.md`](../../../docs/security.md) needs updating too, and it likely warrants an ADR.

## Verify

```bash
npm run typecheck                                  # also regenerates worker-configuration.d.ts
npm run test --workspace=@threadline/realtime
npm run dev:realtime:local                         # wrangler dev --local on :8787
```

For an end-to-end check, run the full stack (`npm run dev`) and open two browser sessions in the same room — a protocol change that works against one client and breaks fan-out is not visible with a single tab.

## Checklist

- [ ] Inbound payload is validated
- [ ] Authorization is re-checked in the handler against what the ticket granted
- [ ] Presence and identity claims are verified against the actual actor
- [ ] Persistence decision is deliberate — ephemeral signalling is not recorded
- [ ] Nothing accumulates unboundedly in Durable Object memory
- [ ] Test for the accepted path
- [ ] Test for the rejected path
- [ ] Test for a malformed payload
- [ ] `docs/realtime.md` updated
- [ ] `docs/security.md` updated if a trust boundary moved
- [ ] Verified with two clients in one room, not one
