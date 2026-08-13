import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/components",
  testMatch: "room-panel-resizer.spec.ts",
  use: { browserName: "chromium" },
});
