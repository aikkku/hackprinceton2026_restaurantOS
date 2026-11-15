import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

async function point(canvas: Locator, x: number, y: number) {
  return canvas.evaluate((element, point) => {
    const matrix = (element as SVGSVGElement).getScreenCTM()!;
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, { x, y });
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
}

test("floor toolbar has version history, furniture search and no removed panels", async ({ page }) => {
  await page.goto("/tactical");
  const versions = page.getByLabel("Saved versions");
  await expect(versions.locator("option")).toHaveCount(1);
  await expect(page.locator(".floor-map-tools")).toBeVisible();
  await expect(page.locator(".floor-map-tools")).toHaveText("");
  for (const removed of ["Saved floor plans", "Snap to grid", "Layout insights", "Scenarios", "Zoom in", "Select furniture"]) {
    await expect(page.getByText(removed, { exact: true })).toHaveCount(0);
  }
  await expect(page.locator('[data-object="kitchen"]')).toHaveCount(0);
  await expect(page.locator('[data-object="cashier"]')).toBeVisible();
  await expect(page.getByRole("region", { name: "AI seating analysis" })).toBeHidden();

  await page.getByText("Furniture", { exact: true }).click();
  await page.getByLabel("Search furniture").fill("cashier");
  await expect(page.locator(".floor-palette-menu li")).toHaveCount(1);
  await page.locator(".floor-palette-menu").getByRole("button", { name: "Cashier stand", exact: true }).click();
  await page.getByRole("button", { name: "Place in clear spot" }).click();
  const objects = page.locator(".floor-svg [data-object]");
  const total = await objects.count();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(versions.locator("option")).toHaveCount(2);
  await versions.selectOption({ index: 0 });
  await expect(objects).toHaveCount(total - 1);
  await versions.selectOption({ index: 1 });
  await expect(objects).toHaveCount(total);
  await page.reload();
  await expect(versions.locator("option")).toHaveCount(2);
  await expect(objects).toHaveCount(total);
});

test("free dragging previews yellow warnings and drag resizing adds chair markers", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/tactical");
  const canvas = page.locator("svg.floor-svg");
  await expect(page.locator(".floor-editor")).toHaveAttribute("aria-busy", "false");
  const table = canvas.locator('[data-object="south-two"]');
  const chairs = table.locator("[data-chair-marker]");
  await expect(chairs).toHaveCount(2);
  await table.scrollIntoViewIfNeeded();
  const original = await table.getAttribute("transform");
  await drag(page, await point(canvas, 5.85, 6), await point(canvas, 8.98, 6.13));
  await expect(table.locator(".is-floor-warning")).toHaveCount(1);
  await expect(table.locator(":scope > title")).toContainText("Overlaps");
  await page.mouse.up();
  await expect(table).not.toHaveAttribute("transform", original!);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(table).toHaveAttribute("transform", original!);
  await table.focus();
  const handle = await table.locator("[data-resize]").boundingBox();
  expect(handle).not.toBeNull();
  const from = { x: handle!.x + handle!.width / 2, y: handle!.y + handle!.height / 2 };
  const start = await point(canvas, 6.65, 6.45);
  const target = await point(canvas, 7.4, 6.45);
  await drag(page, from, { x: from.x + target.x - start.x, y: from.y });
  await expect(chairs).toHaveCount(4);
  await page.mouse.up();
  await expect(chairs).toHaveCount(4);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(chairs).toHaveCount(2);
});

test("keyboard edits furniture directly and its properties start collapsed", async ({ page }) => {
  await page.goto("/tactical");
  await expect(page.locator(".floor-editor")).toHaveAttribute("aria-busy", "false");
  const table = page.locator('[data-object="south-two"]');
  await table.focus();
  await expect(table).toBeFocused();
  const original = await table.getAttribute("transform");
  await page.keyboard.press("ArrowRight");
  await expect(table).toHaveAttribute("transform", "translate(5.35 5.55)");
  await page.keyboard.press("r");
  await expect(table.locator(".svg-hit")).toHaveAttribute("width", "0.9");
  await page.keyboard.press("Delete");
  await expect(table).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(table).toHaveCount(1);
  await table.focus();
  await expect(page.getByLabel("Furniture width (m)")).toBeHidden();
  await page.getByText("Furniture details", { exact: true }).click();
  await expect(page.getByLabel("Furniture width (m)")).toBeVisible();
  expect(original).toBe("translate(5.25 5.55)");
});

test("the chosen saved version survives reload without creating another snapshot", async ({ page }) => {
  await page.goto("/tactical");
  await expect(page.locator(".floor-editor")).toHaveAttribute("aria-busy", "false");
  const table = page.locator('[data-object="south-two"]');
  await table.focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const versions = page.getByLabel("Saved versions");
  await expect(versions.locator("option")).toHaveCount(2);
  await versions.selectOption({ index: 0 });
  const initialId = await versions.inputValue();
  await page.reload();
  await expect(page.locator(".floor-editor")).toHaveAttribute("aria-busy", "false");
  await expect(versions).toHaveValue(initialId);
  await expect(versions.locator("option")).toHaveCount(2);
  await expect(table).toHaveAttribute("transform", "translate(5.25 5.55)");
});

test("Escape cancels a live drag, including its warnings, without adding undo history", async ({ page }) => {
  await page.goto("/tactical");
  await expect(page.locator(".floor-editor")).toHaveAttribute("aria-busy", "false");
  const canvas = page.locator("svg.floor-svg");
  const table = canvas.locator('[data-object="south-two"]');
  await table.scrollIntoViewIfNeeded();
  await drag(page, await point(canvas, 5.85, 6), await point(canvas, 8.98, 6.13));
  await expect(page.getByRole("tooltip")).toContainText("Overlaps");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(table).toHaveAttribute("transform", "translate(5.25 5.55)");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
});

test("compact menus work on narrow screens and controls stay inside the canvas", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /hydrat/i.test(message.text())) errors.push(message.text()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tactical");
  await expect(page.locator(".floor-editor")).toHaveAttribute("aria-busy", "false");
  await page.getByText("Furniture", { exact: true }).click();
  await expect(page.getByLabel("Search furniture")).toBeFocused();
  await page.getByLabel("Search furniture").fill("nothing matches");
  await expect(page.getByText("No furniture found.")).toBeVisible();
  await page.getByLabel("Search furniture").fill("plant");
  await page.getByLabel("Search furniture").press("Enter");
  await expect(page.locator(".floor-placement-chip")).toBeVisible();
  await expect(page.locator("svg.floor-svg")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".floor-placement-chip")).toHaveCount(0);
  await page.getByLabel("Plan settings", { exact: true }).click();
  await expect(page.getByLabel("Room width (m)")).toBeVisible();
  await page.getByLabel("Room width (m)").press("Escape");
  await expect(page.getByLabel("Room width (m)")).toBeHidden();
  const canvas = await page.locator(".floor-canvas").boundingBox();
  const toolbar = await page.locator(".floor-map-tools").boundingBox();
  expect(toolbar!.x).toBeGreaterThan(canvas!.x);
  expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width);
  expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(canvas!.y + canvas!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
