import { describe, expect, it, vi } from "vitest";
import { CacheUnavailableError, MemoryCache, RedisCache, createRedisCache, type RedisCommandClient } from "./cache.js";

/**
 * A scriptable stand-in for the Redis client.
 *
 * The interesting behaviour of `RedisCache` is what it does when the server
 * misbehaves — forgets a script, stalls, disconnects — and none of that is
 * reachable against a healthy server. Driving the narrow
 * {@link RedisCommandClient} surface directly is the only way to exercise it
 * deterministically.
 */
function stubClient(
  handler: (args: string[]) => Promise<unknown>,
  { isReady = true }: { isReady?: boolean } = {},
): RedisCommandClient & { destroyed: boolean } {
  return {
    isReady,
    destroyed: false,
    sendCommand: (args) => handler(args),
    destroy() {
      this.destroyed = true;
    },
  };
}

describe("MemoryCache", () => {
  it("counts within a window and starts a new one once it elapses", async () => {
    vi.useFakeTimers();
    try {
      const cache = new MemoryCache();

      expect((await cache.incrementWindow("k", 1_000)).count).toBe(1);
      expect((await cache.incrementWindow("k", 1_000)).count).toBe(2);

      vi.advanceTimersByTime(1_001);
      const restarted = await cache.incrementWindow("k", 1_000);
      expect(restarted.count).toBe(1);
      expect(restarted.resetAt.getTime()).toBe(Date.now() + 1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps separate keys in separate windows", async () => {
    const cache = new MemoryCache();
    await cache.incrementWindow("a", 1_000);
    await cache.incrementWindow("a", 1_000);

    expect((await cache.incrementWindow("b", 1_000)).count).toBe(1);
  });

  it("grants a claim once, then refuses it until it expires", async () => {
    vi.useFakeTimers();
    try {
      const cache = new MemoryCache();

      expect(await cache.claim("c", 1_000)).toBe(true);
      expect(await cache.claim("c", 1_000)).toBe(false);

      vi.advanceTimersByTime(1_001);
      expect(await cache.claim("c", 1_000)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("RedisCache", () => {
  it("increments through EVALSHA and derives resetAt from the returned TTL", async () => {
    const seen: string[][] = [];
    const cache = new RedisCache(
      stubClient(async (args) => {
        seen.push(args);
        return [3, 42_000];
      }),
      "threadline:",
    );

    const bucket = await cache.incrementWindow("/v1/auth/login:abc", 900_000);

    expect(bucket.count).toBe(3);
    expect(bucket.key).toBe("/v1/auth/login:abc");
    expect(bucket.resetAt.getTime()).toBeGreaterThan(Date.now() + 41_000);
    expect(seen[0][0]).toBe("EVALSHA");
    // One key, prefixed, with the window passed as the only argument.
    expect(seen[0].slice(2)).toEqual(["1", "threadline:/v1/auth/login:abc", "900000"]);
  });

  it("falls back to EVAL when the server has forgotten the script, and keeps the result", async () => {
    const commands: string[] = [];
    const cache = new RedisCache(
      stubClient(async (args) => {
        commands.push(args[0]);
        if (args[0] === "EVALSHA" && commands.filter((command) => command === "EVALSHA").length === 1)
          throw new Error("NOSCRIPT No matching script. Please use EVAL.");
        return [1, 900_000];
      }),
    );

    expect((await cache.incrementWindow("k", 900_000)).count).toBe(1);
    expect(commands).toEqual(["EVALSHA", "EVAL"]);

    // The server has the script again, so the next call must not re-send the body.
    await cache.incrementWindow("k", 900_000);
    expect(commands).toEqual(["EVALSHA", "EVAL", "EVALSHA"]);
  });

  it("does not swallow errors that are not NOSCRIPT", async () => {
    const cache = new RedisCache(
      stubClient(async () => {
        throw new Error("OOM command not allowed when used memory > 'maxmemory'.");
      }),
    );

    await expect(cache.incrementWindow("k", 1_000)).rejects.toThrow(/OOM/);
  });

  it("rejects a reply it cannot trust rather than inventing a count", async () => {
    const cache = new RedisCache(stubClient(async () => "unexpected"));

    await expect(cache.incrementWindow("k", 1_000)).rejects.toBeInstanceOf(CacheUnavailableError);
  });

  it("fails fast without dispatching while the client is disconnected", async () => {
    const send = vi.fn(async () => [1, 1_000]);
    const cache = new RedisCache(stubClient(send, { isReady: false }));

    await expect(cache.incrementWindow("k", 1_000)).rejects.toBeInstanceOf(CacheUnavailableError);
    expect(send).not.toHaveBeenCalled();
    expect(cache.status()).toBe("unavailable");
  });

  it("gives up on a stalled command instead of holding the request open", async () => {
    const cache = new RedisCache(
      stubClient(() => new Promise(() => {})),
      "threadline:",
      20,
    );

    await expect(cache.incrementWindow("k", 1_000)).rejects.toBeInstanceOf(CacheUnavailableError);
  });

  it("reads a claim from SET NX PX, mapping a nil reply to a lost claim", async () => {
    const replies: unknown[] = ["OK", null];
    const seen: string[][] = [];
    const cache = new RedisCache(
      stubClient(async (args) => {
        seen.push(args);
        return replies.shift();
      }),
      "tl:",
    );

    expect(await cache.claim("use:session:s1", 60_000)).toBe(true);
    expect(await cache.claim("use:session:s1", 60_000)).toBe(false);
    expect(seen[0]).toEqual(["SET", "tl:use:session:s1", "1", "NX", "PX", "60000"]);
  });

  it("reports ready and releases the connection on close", async () => {
    const client = stubClient(async () => "OK");
    const cache = new RedisCache(client);

    expect(cache.status()).toBe("ready");
    await cache.close();
    expect(client.destroyed).toBe(true);
  });

  it("absorbs a second close instead of crashing a shutdown", async () => {
    // The driver's own destroy() throws ClientClosedError the second time, so a
    // signal handler racing a teardown would turn a clean exit into a crash.
    const destroy = vi.fn(() => {
      if (destroy.mock.calls.length > 1) throw new Error("The client is closed");
    });
    const cache = new RedisCache({ isReady: true, sendCommand: async () => "OK", destroy });

    await cache.close();
    await expect(cache.close()).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("does not block on an unreachable server, and reports itself unavailable meanwhile", async () => {
    // The regression this guards is severe and non-obvious: node-redis's
    // connect() does not reject when the server is down, it retries forever, so
    // awaiting it here made an unreachable Redis block the API's boot outright.
    // Port 1 is reserved and never listening. The connection failure logs
    // asynchronously, so it is silenced here rather than left to race the run.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const started = Date.now();
      const cache = createRedisCache("redis://127.0.0.1:1");

      expect(cache).toBeDefined();
      // Returning at all is the assertion; the budget only catches a re-introduced await.
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(cache?.status()).toBe("unavailable");
      await expect(cache?.incrementWindow("k", 1_000)).rejects.toBeInstanceOf(CacheUnavailableError);
      await cache?.close();
    } finally {
      logged.mockRestore();
    }
  });

  it("disables itself for a URL no amount of retrying could fix", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(createRedisCache("not-a-redis-url")).toBeUndefined();
      // The URL carries a password, so the diagnostic must never contain it.
      expect(logged).toHaveBeenCalledTimes(1);
      expect(String(logged.mock.calls[0][0])).not.toContain("not-a-redis-url");
    } finally {
      logged.mockRestore();
    }
  });

  it("stops serving after close rather than using a destroyed connection", async () => {
    const send = vi.fn(async () => [1, 1_000]);
    const cache = new RedisCache(stubClient(send));

    await cache.close();
    expect(cache.status()).toBe("unavailable");
    await expect(cache.incrementWindow("k", 1_000)).rejects.toBeInstanceOf(CacheUnavailableError);
    await expect(cache.claim("k", 1_000)).rejects.toBeInstanceOf(CacheUnavailableError);
    expect(send).not.toHaveBeenCalled();
  });
});
