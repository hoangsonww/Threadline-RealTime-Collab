import { describe, expect, it, vi } from "vitest";
import { createIceServerProvider } from "./turn.js";

describe("Cloudflare TURN credential provider", () => {
  it("keeps port 5349, removes only port 53, and caches credentials per user", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        iceServers: [
          { urls: ["turn:turn.example.test:53?transport=udp", "turns:turn.example.test:5349?transport=tcp"] },
          {
            urls: "turn:turn.example.test:3478?transport=udp",
            username: "temporary-user",
            credential: "temporary-secret",
          },
        ],
      }),
    );
    const provider = createIceServerProvider({ keyId: "key-id", apiToken: "key-secret", fetcher });

    const first = await provider?.("user-a");
    const cached = await provider?.("user-a");
    await provider?.("user-b");

    expect(first?.[0].urls).toEqual(["turns:turn.example.test:5349?transport=tcp"]);
    expect(first?.[1]).toEqual({
      urls: ["turn:turn.example.test:3478?transport=udp"],
      username: "temporary-user",
      credential: "temporary-secret",
    });
    expect(cached).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({ ttl: 14_400 });
  });

  it("evicts a failed request so a later ticket can retry the provider", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ iceServers: [{ urls: "stun:stun.example.test:3478" }] }));
    const provider = createIceServerProvider({ keyId: "key-id", apiToken: "key-secret", fetcher });

    await expect(provider?.("user-a")).rejects.toThrow("status 503");
    await expect(provider?.("user-a")).resolves.toEqual([{ urls: ["stun:stun.example.test:3478"] }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
