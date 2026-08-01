import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.ts"],
    environment: "node",
    clearMocks: true,
  },
});
