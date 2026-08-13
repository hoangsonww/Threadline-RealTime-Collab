import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          ROOM_TICKET_SECRET: "test-ticket-secret",
          PERSISTENCE_SECRET: "test-persistence-secret",
        },
      },
    }),
  ],
});
