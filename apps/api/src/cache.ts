/**
 * The ephemeral-counter port, and its two implementations.
 *
 * This is deliberately **not** part of {@link repository.Repository}. The
 * repository is the store of record: what it accepts, it keeps. A cache is the
 * opposite contract — every read may miss, every key may vanish under memory
 * pressure, and the whole process may be unreachable without the API being
 * down. Folding one into the other would let a route accidentally treat an
 * evictable value as durable, which is exactly the bug this separation
 * prevents. See
 * [ADR 0009](../../../docs/decisions/0009-redis-for-ephemeral-counters.md).
 *
 * **This is the only file permitted to import the Redis driver**, mirroring the
 * rule that keeps the MongoDB driver inside `repository.ts`. Route code in
 * {@link application} depends on the {@link Cache} interface, so the same
 * handlers run with Redis in production, with {@link MemoryCache} under test,
 * and with no cache at all when `REDIS_URL` is unset.
 *
 * Every operation here is **best-effort by contract**. A caller that cannot
 * state what it will do when the cache throws is using the wrong module —
 * `application.ts` falls back to the repository for rate limits and falls back
 * to writing through for session touches, and both of those fall back toward
 * *more* work, never toward less enforcement.
 *
 * @module
 */

import { createHash } from "node:crypto";
import { createClient } from "redis";
import type { RateLimitEntry } from "./domain.js";

/**
 * What {@link Cache.status} reports to `/health`.
 *
 * `unavailable` is not an error state for the API — it means callers are
 * currently paying the un-cached cost, which is precisely the behaviour the
 * service had before this module existed.
 */
export type CacheStatus = "ready" | "unavailable";

/**
 * Ephemeral, evictable, best-effort state.
 *
 * Two operations, because there are exactly two things worth keeping out of the
 * database on the hot path: a fixed-window counter, and a "has this already
 * happened recently" flag. Resist adding a general-purpose `get`/`set` — the
 * moment this becomes a key-value store, something durable ends up in it.
 */
export interface Cache {
  /**
   * Atomically increments the fixed window for `key`, starting a new one when
   * no window is live.
   *
   * Returns the same {@link RateLimitEntry} shape as
   * `Repository.incrementRateLimit` so the two are interchangeable at the call
   * site. Must be atomic — a read-then-write races under exactly the concurrent
   * load a rate limiter exists to handle.
   *
   * @throws When the cache is unreachable. Callers must fall back, never allow.
   */
  incrementWindow(key: string, windowMs: number): Promise<RateLimitEntry>;
  /**
   * Claims `key` for `ttlMs`, returning whether *this* caller won the claim.
   *
   * `true` means no live claim existed and the caller now holds it; `false`
   * means someone claimed it within the window. Used to collapse repeated
   * write-through of the same low-value fact — see the `lastUsedAt` handling in
   * {@link application}.
   *
   * @throws When the cache is unreachable. Callers must fall back to doing the
   * work unconditionally.
   */
  claim(key: string, ttlMs: number): Promise<boolean>;
  /** Liveness, as reported by `/health`. Never throws. */
  status(): CacheStatus;
  /** Releases the underlying connection. Safe to call more than once. */
  close(): Promise<void>;
}

/**
 * An in-process implementation backed by plain `Map`s.
 *
 * For the test suite and for single-process local development. **It is not a
 * substitute for Redis in any deployment that runs more than one instance** —
 * an in-process counter gets a fresh, empty bucket per instance, which is the
 * precise bug that moved rate limiting into the repository in the first place
 * (see [`docs/security.md`](../../../docs/security.md#rate-limits)). Nothing in
 * `index.ts` ever constructs this; it exists so `app.test.ts` can drive the
 * cached path deterministically without a server.
 *
 * Expiry is evaluated lazily on read rather than by timer, so an instance never
 * holds the event loop open — which matters because the test suite creates many
 * of these and never closes most of them.
 */
export class MemoryCache implements Cache {
  private windows = new Map<string, RateLimitEntry>();
  private claims = new Map<string, number>();

  async incrementWindow(key: string, windowMs: number): Promise<RateLimitEntry> {
    const timestamp = Date.now();
    const current = this.windows.get(key);
    const entry =
      !current || current.resetAt.getTime() <= timestamp
        ? { key, count: 0, resetAt: new Date(timestamp + windowMs) }
        : current;
    entry.count += 1;
    this.windows.set(key, entry);
    return entry;
  }

  async claim(key: string, ttlMs: number): Promise<boolean> {
    const timestamp = Date.now();
    const heldUntil = this.claims.get(key);
    if (heldUntil !== undefined && heldUntil > timestamp) return false;
    this.claims.set(key, timestamp + ttlMs);
    return true;
  }

  status(): CacheStatus {
    return "ready";
  }

  async close() {
    this.windows.clear();
    this.claims.clear();
  }
}

/**
 * Increment a fixed window and report how much of it remains, in one round trip.
 *
 * `PTTL` is re-asserted rather than assumed: a key can exist without an expiry
 * if a previous `PEXPIRE` was lost to a disconnect between the two commands, and
 * an un-expiring rate-limit counter never resets — the affected caller would be
 * locked out permanently rather than for one window. Repairing whenever the TTL
 * is negative covers both `-1` (no expiry) and `-2` (the key expired between the
 * `INCR` and the `PTTL`), so the script is correct from any starting state.
 */
const windowScript = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

const windowScriptSha = createHash("sha1").update(windowScript).digest("hex");

/**
 * How long a single command may take before the caller gives up and does the
 * un-cached work instead.
 *
 * A same-region Redis answers in single-digit milliseconds, so this is loose
 * enough never to fire in normal operation and tight enough that a stalled
 * server — reachable, TCP alive, not responding — cannot add meaningful latency
 * to a request that has a perfectly good database to fall back on.
 */
const defaultCommandTimeoutMs = 250;

/** Keeps Threadline's keys distinguishable in an instance shared with other applications. */
const defaultKeyPrefix = "threadline:";

/** Raised when the cache is known to be unusable, so callers fall back without waiting. */
export class CacheUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheUnavailableError";
  }
}

/**
 * The subset of the Redis client this module uses.
 *
 * Narrow on purpose: it keeps the driver's surface from leaking into the rest of
 * the file, and it lets {@link RedisCache} be constructed over a stub in tests
 * that exercise the fallback and timeout paths without a server.
 */
export type RedisCommandClient = {
  readonly isReady: boolean;
  sendCommand(args: string[]): Promise<unknown>;
  destroy(): void;
};

/** Redis reports an uncached script by prefixing the error with `NOSCRIPT`. */
const isNoScriptError = (error: unknown) => error instanceof Error && error.message.startsWith("NOSCRIPT");

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new CacheUnavailableError(`Redis did not respond within ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });
  // The losing promise is never awaited again, so an in-flight command that
  // lands after the timeout settles harmlessly. That direction is safe for both
  // callers: a counter that increments after we gave up over-counts slightly,
  // which fails toward a stricter limit, never a looser one.
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
}

/**
 * The production implementation, backed by Redis.
 *
 * Constructed through {@link createRedisCache} rather than directly, so that an
 * unreachable Redis at boot degrades the API instead of stopping it.
 */
export class RedisCache implements Cache {
  private closed = false;

  constructor(
    private readonly client: RedisCommandClient,
    private readonly keyPrefix: string = defaultKeyPrefix,
    private readonly commandTimeoutMs: number = defaultCommandTimeoutMs,
  ) {}

  private async command(args: string[]): Promise<unknown> {
    // Checked before dispatch so a known-down Redis costs nothing rather than a
    // rejected promise per request. `disableOfflineQueue` enforces the same rule
    // inside the driver (it rejects with ClientOfflineError in ~0ms while the
    // socket is reconnecting); this makes the intent explicit at the call site.
    if (this.closed) throw new CacheUnavailableError("The Redis cache is closed.");
    if (!this.client.isReady) throw new CacheUnavailableError("Redis is not connected.");
    return withTimeout(this.client.sendCommand(args), this.commandTimeoutMs);
  }

  /**
   * Run a cached script, teaching the server the body only when it has
   * forgotten it.
   *
   * `EVALSHA` first because the script body is larger than the reply and this
   * runs on every rate-limited request; `EVAL` on `NOSCRIPT` because a Redis
   * restart or a `SCRIPT FLUSH` clears the cache under us, and on a shared
   * instance neither is ours to control.
   */
  private async evaluate(keys: string[], args: string[]): Promise<unknown> {
    const tail = [String(keys.length), ...keys, ...args];
    try {
      return await this.command(["EVALSHA", windowScriptSha, ...tail]);
    } catch (error) {
      if (!isNoScriptError(error)) throw error;
      return this.command(["EVAL", windowScript, ...tail]);
    }
  }

  async incrementWindow(key: string, windowMs: number): Promise<RateLimitEntry> {
    const reply = await this.evaluate([this.keyPrefix + key], [String(windowMs)]);
    if (!Array.isArray(reply) || typeof reply[0] !== "number" || typeof reply[1] !== "number")
      throw new CacheUnavailableError("Redis returned an unexpected reply to the rate-limit script.");
    const [count, remainingMs] = reply;
    return { key, count, resetAt: new Date(Date.now() + remainingMs) };
  }

  async claim(key: string, ttlMs: number): Promise<boolean> {
    // SET … NX PX is the whole claim: atomic, self-expiring, and its reply
    // distinguishes "we set it" (OK) from "someone already had it" (nil).
    const reply = await this.command(["SET", this.keyPrefix + key, "1", "NX", "PX", String(ttlMs)]);
    return reply !== null;
  }

  status(): CacheStatus {
    return !this.closed && this.client.isReady ? "ready" : "unavailable";
  }

  async close() {
    // Guarded because the driver's `destroy()` is not idempotent — a second call
    // throws `ClientClosedError`. Shutdown paths call close more than once often
    // enough (a signal handler racing a test teardown) that this has to absorb it
    // rather than turn a clean exit into a crash.
    if (this.closed) return;
    this.closed = true;
    this.client.destroy();
  }
}

/**
 * Build a Redis-backed cache without ever blocking the caller on the network.
 *
 * The connection is started but deliberately **not awaited**, and that is the
 * whole point of this function. `client.connect()` does not reject when the
 * server is unreachable — it retries according to `reconnectStrategy`, so
 * awaiting it with a strategy that always returns a delay never returns at all.
 * Awaiting here would therefore mean an unreachable Redis prevents the API from
 * booting, which is the exact failure this module exists to make impossible:
 * Redis holds nothing this service cannot recompute, and every caller already
 * has a working path through the repository.
 *
 * So the cache is returned immediately and reports `unavailable` until the
 * socket is ready. Calls made in the meantime fail fast (`isReady` is false, and
 * the driver rejects in about a millisecond) and fall back. When Redis does come
 * up — at boot, or after an outage — the driver reconnects on its own and the
 * cache starts serving with no restart and no redeploy.
 *
 * `undefined` is returned only for a URL that can never work, since retrying a
 * malformed URL forever would just be a quieter way to be misconfigured.
 *
 * The URL is a secret — it carries the password — so it is never logged, not
 * even redacted, and not on the failure path where it would be most tempting.
 */
export function createRedisCache(
  url: string,
  options: { keyPrefix?: string; commandTimeoutMs?: number } = {},
): Cache | undefined {
  let client: ReturnType<typeof createClient>;
  try {
    client = createClient({
      url,
      // Reject immediately instead of queueing while the socket is down. Queued
      // commands would resolve long after the request that issued them gave up,
      // turning a Redis outage into request latency rather than a clean fallback.
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 5_000,
        reconnectStrategy: (retries) => Math.min(500 * 2 ** Math.min(retries, 5), 15_000),
      },
    });
  } catch (error) {
    // A malformed URL throws synchronously out of createClient.
    console.error(
      "[threadline] REDIS_URL could not be parsed, so the cache is disabled. Rate limits and session " +
        "bookkeeping will use MongoDB directly, which is correct but slower. Expected a redis:// or " +
        `rediss:// URL.\n  underlying error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }

  // node-redis throws out of the process if nothing listens for `error`, and it
  // fires on every reconnect attempt — which, during an outage, is forever. Log
  // the first failure of each outage and the recovery, so an incident is visible
  // without producing a line every fifteen seconds for as long as it lasts.
  let outageReported = false;
  client.on("error", (error: Error) => {
    if (outageReported) return;
    outageReported = true;
    console.error(
      `[threadline] Redis is unreachable, so rate limits and session bookkeeping are falling back to MongoDB — ` +
        `correct, just slower. Retrying in the background. Cause: ${error.message}`,
    );
  });
  client.on("ready", () => {
    if (outageReported) console.error("[threadline] Redis reconnected; the cache is serving again.");
    outageReported = false;
  });
  // Not awaited — see above. The catch is insurance: a reconnectStrategy that
  // gave up would reject here, and the `error` listener has already reported it.
  client.connect().catch(() => undefined);

  return new RedisCache(
    {
      get isReady() {
        return client.isReady;
      },
      sendCommand: (args) => client.sendCommand(args),
      destroy: () => client.destroy(),
    },
    options.keyPrefix ?? defaultKeyPrefix,
    options.commandTimeoutMs ?? defaultCommandTimeoutMs,
  );
}
