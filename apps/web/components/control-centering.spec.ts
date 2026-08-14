import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const stylesheetPath = path.resolve(__dirname, "../app/globals.css");

const icon = (size: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" fill="currentColor" viewBox="0 0 256 256"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"></path></svg>`;

/**
 * Horizontal offset of a control's visible contents from the centre of its own
 * content box, in CSS pixels. Positive means the contents sit right of centre.
 *
 * Text nodes are measured through a Range rather than the element box, because
 * the element box is what stays centred even when the text inside it does not —
 * which is exactly the failure this guards against.
 */
const contentOffset = async (page: Page, selector: string) =>
  page.locator(selector).evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const left = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const right = box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
    let minX = Infinity;
    let maxX = -Infinity;
    const include = (rect: DOMRect) => {
      if (!rect.width && !rect.height) return;
      minX = Math.min(minX, rect.left);
      maxX = Math.max(maxX, rect.right);
    };
    for (const node of element.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) include((node as Element).getBoundingClientRect());
      else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) include(rect as DOMRect);
      }
    }
    return (minX - left - (right - maxX)) / 2;
  });

test("room tool tabs centre their label whether or not the tab is locked", async ({ page }) => {
  const stylesheet = await readFile(stylesheetPath, "utf8");
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.setContent(`
    <style>${stylesheet}</style>
    <aside class="room-panel" style="width: 360px;">
      <div class="room-panel-tabs" role="tablist">
        <button id="open-tab" class="active">chat</button>
        <button id="locked-tab" data-locked>notes</button>
      </div>
    </aside>
  `);

  // A locked tab carries an extra status dot. It must not push the label off
  // centre, or locked and unlocked tabs visibly disagree about where text sits.
  expect(Math.abs(await contentOffset(page, "#open-tab"))).toBeLessThanOrEqual(0.5);
  expect(Math.abs(await contentOffset(page, "#locked-tab"))).toBeLessThanOrEqual(0.5);

  // The dot still has to render — it was previously an inline pseudo-element,
  // so its width collapsed to zero and only its margin survived.
  const dotWidth = await page
    .locator("#locked-tab")
    .evaluate((tab) => parseFloat(getComputedStyle(tab, "::after").width));
  expect(dotWidth).toBeGreaterThan(0);
});

test("fixed-size icon controls centre their icon", async ({ page }) => {
  const stylesheet = await readFile(stylesheetPath, "utf8");
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.setContent(`
    <style>${stylesheet}</style>
    <button id="icon-button" class="button button-ghost button-icon">${icon(17)}</button>
    <button id="call-control" class="control">${icon(18)}</button>
    <div style="position: relative; height: 120px; width: 240px;">
      <button id="panel-reveal" class="room-panel-reveal">${icon(14)}</button>
    </div>
    <label class="member-search"><input /><button id="search-clear">${icon(14)}</button></label>
  `);

  for (const selector of ["#icon-button", "#call-control", "#panel-reveal", "#search-clear"]) {
    expect(Math.abs(await contentOffset(page, selector)), selector).toBeLessThanOrEqual(0.5);
  }
});
