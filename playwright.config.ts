import { defineConfig } from "@playwright/test";

export default defineConfig({
  forbidOnly: !!process.env.CI,
  testDir: "./apps/web/components",
  testMatch: "*.spec.ts",
  use: { browserName: "chromium" },
});
