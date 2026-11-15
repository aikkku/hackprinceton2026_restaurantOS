import { test, expect } from "@playwright/test";

test("named layouts preserve metadata, baseline and original configuration across reload", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  await page.goto("/tactical");
  const library = page.locator(".layout-library").first();
  await expect(library.getByRole("button", { name: "Duplicate", exact: true })).toBeEnabled();
  await library.getByLabel("Name for rename or duplicate").fill("Comfortable Dining");
  await library.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(library.locator("tbody tr")).toHaveCount(2);
  await library.locator("tbody tr").last().getByRole("button", { name: "Use as baseline" }).click();
  await page.getByRole("button", { name: "Custom object", exact: true }).click();
  await page.getByRole("button", { name: "Place in clear spot" }).click();
  await page.getByLabel("Object name", { exact: true }).fill("Large refrigerator");
  await page.getByRole("textbox", { name: "Description", exact: true }).fill("Beside kitchen entrance");
  await page.getByRole("button", { name: "Apply furniture details" }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.reload();
  await expect(library.getByText("Comfortable Dining · Active · Baseline")).toBeVisible();
  const picker = page.getByLabel("Select furniture");
  const fridge = picker.locator("option").filter({ hasText: "Large refrigerator" });
  await expect(fridge).toHaveCount(1);
  await picker.selectOption((await fridge.getAttribute("value"))!);
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Beside kitchen entrance");
  await library.locator("tbody tr").first().getByRole("button", { name: "Open", exact: true }).click();
  await expect(picker.locator("option").filter({ hasText: "Large refrigerator" })).toHaveCount(0);
  await library.getByLabel("Name for rename or duplicate").fill("Spacious");
  await library.locator("tbody tr").last().getByRole("button", { name: "Rename", exact: true }).click();
  await expect(library.getByText("Spacious · Baseline")).toBeVisible();
  await library.locator("tbody tr").last().getByRole("button", { name: "Delete", exact: true }).click();
  await expect(library.locator("tbody tr")).toHaveCount(1);
  await page.reload();
  await expect(library.locator("tbody tr")).toHaveCount(1);
});

test("photo selection works, invalid imports preserve the draft, old routes redirect", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/tactical/analyze");
  await expect(page).toHaveURL(/\/tactical$/);
  await page.getByText("Estimate a separate draft from photos", { exact: true }).click();
  await page.getByRole("button", { name: "Sample plan", exact: true }).click();
  await page.locator('.draft-svg [data-id="T1"]').click();
  await expect(page.locator(".selected-fields")).toBeVisible();
  await page.locator('.analyze-header-actions input[type=file]').setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"room":{"width":30,"depth":20},"tables":[]}') });
  await expect(page.getByText("Could not read plan file.")).toBeVisible();
  await expect(page.locator('.draft-svg [data-id="T1"]')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const route of ["reviews", "hr", "supply", "finance", "ai"]) {
    await page.goto(`/tactical/${route}`);
    await expect(page.getByRole("navigation", { name: "Tactical sections" }).getByRole("link")).toHaveCount(6);
  }
  expect(errors).toEqual([]);
});

test("reload restores React button states without browser-persisted disabled attributes", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && /hydrat|server rendered|didn't match/i.test(message.text())) hydrationErrors.push(message.text());
  });
  page.on("pageerror", error => hydrationErrors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  await page.goto("/tactical");
  const undo = page.getByRole("button", { name: "Undo", exact: true }).first();
  const redo = page.getByRole("button", { name: "Redo", exact: true }).first();
  const reset = page.getByRole("button", { name: "Reset draft", exact: true });
  await expect(page.getByRole("button", { name: "Open saved draft" })).toBeEnabled();
  await expect(undo).toBeDisabled();
  await page.getByRole("button", { name: "Plant", exact: true }).click();
  await page.getByRole("button", { name: "Place in clear spot" }).click();
  await expect(undo).toBeEnabled();
  await expect(reset).toBeEnabled();
  await expect(undo).toHaveAttribute("autocomplete", "off");
  await page.reload();
  await expect(page.getByRole("button", { name: "Open saved draft" })).toBeEnabled();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await expect(reset).toBeDisabled();
  await expect(page.locator(".layout-library").first().getByRole("button", { name: "Duplicate", exact: true })).toBeEnabled();
  expect(hydrationErrors).toEqual([]);
});

test("central mock records feed financial filters, pricing, HR and supply", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/tactical/finance");
  await page.getByRole("button", { name: "Transactions", exact: true }).click();
  await page.getByRole("combobox", { name: "Month", exact: true }).selectOption("2026-11");
  await expect(page.locator(".transaction-table tbody tr")).toHaveCount(15);
  await page.getByRole("combobox", { name: "Record type", exact: true }).selectOption("expense");
  await expect(page.locator(".transaction-table tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: "Menu Pricing", exact: true }).click();
  await expect(page.locator(".pricing-table tbody tr")).toHaveCount(8);
  await page.getByRole("button", { name: "Simulator", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Price and demand experiment" })).toBeVisible();
  await page.getByRole("combobox", { name: "Pricing channel", exact: true }).selectOption("delivery");
  await expect(page.getByText(/Candidate price/)).toBeVisible();
  await page.goto("/tactical/hr");
  await expect(page.getByText(/Estimated scheduled base labor/)).toBeVisible();
  await page.goto("/tactical/supply");
  await expect(page.locator(".inventory-table tbody tr")).toHaveCount(15);
  await expect(page.getByText(/Rule-based demo summary/)).toBeVisible();
  expect(errors).toEqual([]);
});
