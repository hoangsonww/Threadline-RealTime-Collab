import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `scripts/` is included because the release planner decides version numbers
    // and tag names from git history — arithmetic that is invisible until it is
    // wrong, and wrong in a way that is awkward to undo once a tag is pushed.
    include: ["apps/**/*.test.ts", "scripts/**/*.test.mjs"],
    // The realtime worker runs its Durable Object tests through
    // @cloudflare/vitest-pool-workers (see apps/realtime/vitest.config.ts),
    // which needs the workerd runtime rather than this project's Node
    // environment.
    exclude: ["**/node_modules/**", "apps/realtime/**"],
    environment: "node",
    clearMocks: true,
  },
});
