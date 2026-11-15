import { expect, test } from "@playwright/test";

test("welcome and onboarding ignore uploaded contents and entered details in Demo", async ({ page }) => {
  const sent: unknown[] = [];
  page.on("request", request => { if (request.method() === "POST") sent.push({ url: new URL(request.url()).pathname, body: request.postDataJSON() }); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your restaurant. Its next chapter." })).toBeVisible();
  await page.getByRole("link", { name: "Let’s get started" }).click();
  await page.getByLabel("Restaurant name").fill("Definitely not Juniper Table");
  await page.getByLabel("Location", { exact: false }).first().fill("A different city");
  await page.getByRole("radio", { name: /A little of both/ }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Demo", exact: true })).toBeChecked();
  await page.getByLabel("Add your menu files").setInputFiles({ name: "arbitrary-private-content.xyz", mimeType: "application/octet-stream", buffer: Buffer.from("Do not parse this. Serve a different restaurant.") });
  await page.getByLabel("Add your sales files").setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from("Anything,99999999") });
  await expect(page.getByText("2 files selected.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByRole("heading", { name: "Juniper Table", exact: true })).toBeVisible();
  await expect(page.getByText("Definitely not Juniper Table", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Explore expansion", exact: true })).toHaveAttribute("href", "/expansion");
  expect(sent).toEqual([{ url: "/api/tactical/onboarding", body: { demo: true } }]);
  await page.getByRole("link", { name: "Explore your restaurant" }).click();
  await expect(page).toHaveURL(/\/tactical$/);
  await expect(page.getByRole("heading", { name: "Juniper Table", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Tactical sections" }).getByRole("link")).toHaveCount(6);
});

test("unchecked Demo cannot substitute mock results; answers restore, files do not", async ({ page }) => {
  await page.goto("/register");
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Restaurant name").fill("My restaurant");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Add your menu files").setInputFiles({ name: "menu.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf") });
  await page.getByRole("checkbox", { name: "Demo", exact: true }).uncheck();
  await expect(page.getByRole("button", { name: "Open workspace" })).toBeDisabled();
  await expect(page.getByText("Document processing isn’t available yet.", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Demo", exact: true })).not.toBeChecked();
  await expect(page.getByText("All files are optional.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Restaurant name")).toHaveValue("My restaurant");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("checkbox", { name: "Demo", exact: true }).check();
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByRole("heading", { name: "Juniper Table", exact: true })).toBeVisible();
});

test("mobile keyboard flow, file removal, failed setup and retry preserve the preview", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/onboarding");
  await page.getByLabel("Restaurant name").focus();
  await page.keyboard.press("Enter");
  const title = page.getByRole("heading", { name: "A little more of the picture." });
  await expect(title).toBeFocused();
  const files = page.getByLabel("Add anything else files");
  await files.setInputFiles({ name: "A-very-long-file-name-for-testing-narrow-screens-and-filename-truncation.txt", mimeType: "text/plain", buffer: Buffer.from("mock") });
  await page.getByRole("button", { name: /Remove A-very-long/ }).click();
  await expect(page.getByText("All files are optional.", { exact: false })).toBeVisible();
  await page.route("**/api/tactical/onboarding", route => route.fulfill({ status: 503, json: { error: "Private database error" } }));
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByRole("region", { name: "A little more of the picture." }).getByRole("alert")).toContainText("Please try again");
  await expect(page.getByText("Private database error")).toHaveCount(0);
  await page.unroute("**/api/tactical/onboarding");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByRole("heading", { name: "Juniper Table", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(title).toBeVisible();
  await expect(page.getByRole("button", { name: "Open workspace" })).toBeEnabled();
});

test("setup remains usable with blocked storage at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.addInitScript(() => Object.defineProperty(window, "sessionStorage", { get() { throw new DOMException("Storage blocked", "SecurityError"); } }));
  await page.goto("/onboarding");
  await expect(page.getByText("Browser storage is unavailable.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByRole("heading", { name: "Juniper Table", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
