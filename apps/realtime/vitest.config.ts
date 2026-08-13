import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            ROOM_TICKET_SECRET: "test-ticket-secret",
            PERSISTENCE_SECRET: "test-persistence-secret",
          },
        },
      },
    },
  },
});
