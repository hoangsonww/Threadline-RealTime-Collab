import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const stylesheetPath = path.resolve(__dirname, "../app/globals.css");

test("room panel resizer receives pointer events in its main-panel overlap", async ({ page }) => {
  const stylesheet = await readFile(stylesheetPath, "utf8");
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.setContent(`
    <style>${stylesheet}</style>
    <div class="room-body" style="width: 1000px; height: 500px;">
      <section class="room-main"></section>
      <aside class="room-panel" style="--room-panel-width: 360px;">
        <div class="room-panel-resizer"><span></span></div>
      </aside>
    </div>
  `);

  await expect(page.locator(".room-panel-resizer")).toBeVisible();
  await expect
    .poll(() =>
      page.locator(".room-panel-resizer").evaluate((resizer) => {
        const { left, top, height } = resizer.getBoundingClientRect();
        return document.elementFromPoint(left + 1, top + height / 2)?.closest(".room-panel-resizer") === resizer;
      }),
    )
    .toBe(true);
});
