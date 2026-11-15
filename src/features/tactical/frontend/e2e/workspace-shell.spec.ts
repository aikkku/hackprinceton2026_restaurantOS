import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test("laptop sidebar exposes all pages, source disclosure and purple AI navigation", async ({ page }) => {
  await page.goto("/tactical");
  const nav = page.getByRole("navigation", { name: "Tactical sections" });
  await expect(nav.getByRole("link")).toHaveCount(6);
  await expect(page.getByRole("heading", { name: "Floor Plan", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Floor Plan", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByText("Demo data", { exact: true }).click();
  await expect(page.locator(".sprout-source-panel")).toBeVisible();
  await expect(page.locator(".sprout-source-panel")).toContainText("Local mock fixture");
  await page.locator(".sprout-source summary").press("Escape");
  await expect(page.locator(".sprout-source")).not.toHaveAttribute("open", "");
  await nav.getByRole("link", { name: "AI Assistant", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI Assistant", exact: true })).toBeFocused();
  await expect(nav.getByRole("link", { name: "AI Assistant", exact: true })).toHaveCSS("background-color", "rgb(112, 67, 163)");
  await page.locator(".sprout-access summary").click();
  await expect(page.locator(".sprout-access").getByLabel("AI access code")).toBeVisible();
  await page.locator(".sprout-access").getByLabel("AI access code").press("Escape");
  await expect(page.locator(".sprout-access summary")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("section navigation retains an unsaved layout and all exits protect it", async ({ page }) => {
  await page.goto("/tactical");
  await expect(page.locator(".floor-editor")).toHaveAttribute("aria-busy", "false");
  const table = page.locator('[data-object="south-two"]');
  await table.focus();
  await page.keyboard.press("ArrowRight");
  const moved = await table.getAttribute("transform");
  const nav = page.getByRole("navigation", { name: "Tactical sections" });
  await nav.getByRole("link", { name: "HR", exact: true }).click();
  await expect(page.getByRole("heading", { name: "People & operations", exact: true })).toBeVisible();
  await nav.getByRole("link", { name: "Floor Plan", exact: true }).click();
  await expect(table).toHaveAttribute("transform", moved!);
  await expect(page.getByRole("status", { name: "Unsaved changes", exact: true })).toBeVisible();
  let prompts = 0;
  page.on("dialog", async dialog => { prompts++; expect(dialog.message()).toContain("unsaved layout changes"); await dialog.dismiss(); });
  for (const name of ["Explore expansion", "Restaurant setup", "sprout. home"]) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(/\/tactical$/);
    await expect(table).toHaveAttribute("transform", moved!);
  }
  expect(prompts).toBe(3);
});

test("laptop finance tab state survives section changes and Supply does not request AI access", async ({ page }) => {
  await page.goto("/tactical/finance");
  await page.getByRole("button", { name: "Price playground", exact: true }).click();
  const raise = page.locator(".playground-table input").first();
  await raise.fill("1.5");
  const nav = page.getByRole("navigation", { name: "Tactical sections" });
  await nav.getByRole("link", { name: "Supply Management", exact: true }).click();
  await expect(page.locator(".sprout-access")).toHaveCount(0);
  await nav.getByRole("link", { name: "Financial Intelligence", exact: true }).click();
  await expect(raise).toHaveValue("1.5");
  const supplyPage = await page.context().newPage();
  let aiRequests = 0;
  supplyPage.on("request", request => { if (request.url().includes("/api/tactical/ai")) aiRequests++; });
  await supplyPage.goto("/tactical/supply");
  await expect(supplyPage.getByRole("heading", { name: "Everything on hand." })).toBeVisible();
  expect(aiRequests).toBe(0);
  expect(await supplyPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await supplyPage.close();
});
