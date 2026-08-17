/**
 * Time-boxed TURN credentials for WebRTC relay.
 *
 * Threadline uses a full-mesh WebRTC topology rather than an SFU
 * ([ADR 0002](../../../docs/decisions/0002-webrtc-mesh-not-sfu.md)), so media
 * normally flows peer to peer. TURN is the fallback for the participants whose
 * networks refuse to let that happen, and it is the only path on which media
 * touches infrastructure at all.
 *
 * Credentials are minted per user, expire on their own, and are never stored —
 * `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` stay server-side and are exchanged for
 * short-lived credentials that are safe to hand to a browser.
 *
 * @module
 */

/** One ICE server entry, in the shape `RTCPeerConnection` expects. */
export type IceServer = { urls: string | string[]; username?: string; credential?: string };

/**
 * How long Cloudflare is asked to make each credential valid.
 *
 * Four hours comfortably outlives any single session while keeping a leaked
 * credential from being a durable capability.
 */
const credentialTtlSeconds = 4 * 60 * 60;
/**
 * How long a credential is reused before being re-minted.
 *
 * Deliberately shorter than {@link credentialTtlSeconds}: the half-hour margin
 * means a credential handed out at the very end of its cache window is still
 * valid for the call that uses it, rather than expiring mid-connection.
 */
const credentialCacheMs = 3.5 * 60 * 60 * 1_000;
/**
 * Cache ceiling.
 *
 * The cache is keyed by user, so without a bound it would grow with total
 * users rather than with concurrent ones — an unbounded map on a long-lived
 * process is a leak with extra steps.
 */
const maxCachedUsers = 1_000;

/**
 * Provider configuration. Every field has a production default; they exist as
 * injection seams so the tests can drive this without network access or a clock.
 */
export type ProviderOptions = {
  keyId?: string;
  apiToken?: string;
  fetcher?: typeof fetch;
  now?: () => number;
};

/**
 * Builds a per-user ICE server provider, or returns `undefined` when TURN is
 * not configured.
 *
 * Returning `undefined` rather than throwing is deliberate: TURN is optional,
 * and a deployment without it still works for every participant whose network
 * permits a direct peer connection. Supplying only one of the two credentials
 * *is* an error, because it is unambiguously a misconfiguration rather than a
 * decision.
 *
 * The returned function caches per user, evicts expired entries opportunistically,
 * and caches the in-flight promise rather than the result — so concurrent calls
 * for the same user coalesce into one upstream request instead of stampeding.
 * A failed request is evicted rather than cached, so an outage does not become
 * sticky.
 *
 * @param options - Overrides for credentials, the fetcher, and the clock.
 * @returns A function from user id to ICE servers, or `undefined` if TURN is unconfigured.
 * @throws If exactly one of `TURN_KEY_ID` / `TURN_KEY_API_TOKEN` is set.
 */
export function createIceServerProvider(options: ProviderOptions = {}) {
  const keyId = options.keyId ?? process.env.TURN_KEY_ID;
  const apiToken = options.apiToken ?? process.env.TURN_KEY_API_TOKEN;
  if (!keyId && !apiToken) return undefined;
  if (!keyId || !apiToken) throw new Error("TURN_KEY_ID and TURN_KEY_API_TOKEN must be configured together.");

  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expiresAt: number; value: Promise<IceServer[]> }>();

  return async (userId: string): Promise<IceServer[]> => {
    const timestamp = now();
    const cached = cache.get(userId);
    if (cached && cached.expiresAt > timestamp) return cached.value;
    if (cached) cache.delete(userId);

    for (const [cachedUserId, entry] of cache) {
      if (entry.expiresAt <= timestamp) cache.delete(cachedUserId);
    }
    if (cache.size >= maxCachedUsers) cache.delete(cache.keys().next().value as string);

    const request = (async () => {
      const response = await fetcher(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
          body: JSON.stringify({ ttl: credentialTtlSeconds }),
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!response.ok) throw new Error(`TURN credential generation failed with status ${response.status}.`);
      const payload = (await response.json()) as { iceServers?: unknown };
      if (!Array.isArray(payload.iceServers)) throw new Error("TURN credential response did not include ICE servers.");

      const servers = payload.iceServers.flatMap((entry): IceServer[] => {
        if (!entry || typeof entry !== "object" || !("urls" in entry)) return [];
        const candidate = entry as { urls: unknown; username?: unknown; credential?: unknown };
        const rawUrls = typeof candidate.urls === "string" ? [candidate.urls] : candidate.urls;
        if (!Array.isArray(rawUrls) || !rawUrls.every((url) => typeof url === "string")) return [];
        // Browsers block TURN on port 53. Match the complete port so the normal
        // secure TURN port 5349 is never removed by accident.
        const urls = rawUrls.filter((url) => !/:53(?:$|\?)/.test(url));
        if (!urls.length) return [];
        return [
          {
            urls,
            ...(typeof candidate.username === "string" ? { username: candidate.username } : {}),
            ...(typeof candidate.credential === "string" ? { credential: candidate.credential } : {}),
          },
        ];
      });
      if (!servers.length) throw new Error("TURN credential response contained no browser-compatible ICE servers.");
      return servers;
    })();

    const entry = { expiresAt: timestamp + credentialCacheMs, value: request };
    cache.set(userId, entry);
    try {
      return await request;
    } catch (error) {
      if (cache.get(userId) === entry) cache.delete(userId);
      throw error;
    }
  };
}
