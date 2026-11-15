import { test, expect } from "@playwright/test";
import demo from "../data/demo-restaurant.json" with { type: "json" };

test("photo selection works and invalid imports preserve its draft", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/tactical/analyze");
  await expect(page).toHaveURL(/\/tactical\/analyze$/);
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
  await expect(page.getByLabel("Saved versions")).toBeEnabled();
  await expect(undo).toBeDisabled();
  await page.getByText("Furniture", { exact: true }).click();
  await page.locator(".floor-palette-menu").getByRole("button", { name: "Plant", exact: true }).click();
  await page.getByRole("button", { name: "Place in clear spot" }).click();
  await expect(undo).toBeEnabled();
  await expect(reset).toBeEnabled();
  await expect(undo).toHaveAttribute("autocomplete", "off");
  await page.reload();
  await expect(page.getByLabel("Saved versions")).toBeEnabled();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await expect(reset).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  expect(hydrationErrors).toEqual([]);
});

test("central mock records feed financial filters, pricing, HR and supply", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/tactical/finance");
  await page.getByRole("button", { name: "Transactions", exact: true }).click();
  await page.getByRole("combobox", { name: "Month", exact: true }).selectOption("2026-11");
  const november = demo.operations.transactions.filter(row => row.date.startsWith("2026-11"));
  const ledgerRows = page.locator(".finance-page .transaction-table tbody tr");
  await expect(ledgerRows).toHaveCount(november.length);
  await page.getByRole("combobox", { name: "Record type", exact: true }).selectOption("expense");
  await expect(ledgerRows).toHaveCount(november.filter(row => row.kind === "expense").length);
  await page.getByRole("button", { name: "Menu Pricing", exact: true }).click();
  await expect(page.locator(".pricing-table tbody tr")).toHaveCount(demo.operations.menu.length);
  await page.getByRole("button", { name: "Simulator", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Price and demand experiment" })).toBeVisible();
  await page.getByRole("combobox", { name: "Pricing channel", exact: true }).selectOption("delivery");
  await expect(page.getByText(/Candidate price/)).toBeVisible();
  await page.goto("/tactical/hr");
  await page.getByText("Data & assumptions", { exact: true }).click();
  await expect(page.getByText(/Estimated scheduled base labor/)).toBeVisible();
  await page.goto("/tactical/supply");
  await expect(page.locator(".inventory-table tbody tr")).toHaveCount(demo.operations.inventory.length);
  await expect(page.getByText(/Rule-based demo summary/)).toBeVisible();
  expect(errors).toEqual([]);
});
