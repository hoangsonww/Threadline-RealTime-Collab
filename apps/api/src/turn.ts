export type IceServer = { urls: string | string[]; username?: string; credential?: string };

const credentialTtlSeconds = 4 * 60 * 60;
const credentialCacheMs = 3.5 * 60 * 60 * 1_000;
const maxCachedUsers = 1_000;

type ProviderOptions = {
  keyId?: string;
  apiToken?: string;
  fetcher?: typeof fetch;
  now?: () => number;
};

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
