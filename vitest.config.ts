import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.ts"],
    // The realtime worker runs its Durable Object tests through
    // @cloudflare/vitest-pool-workers (see apps/realtime/vitest.config.ts),
    // which needs the workerd runtime rather than this project's Node
    // environment.
    exclude: ["**/node_modules/**", "apps/realtime/**"],
    environment: "node",
    clearMocks: true,
  },
});
