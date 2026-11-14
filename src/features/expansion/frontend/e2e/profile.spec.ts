import { expect, test } from "@playwright/test";

const PROFILE_KEY = "restaurantos.expansion.profile.draft.v1";

test("profile journey: example, review, invalid input, correct, save, reload, restore, explorer", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/expansion");
  await expect(
    page.getByRole("heading", { name: "Know the requirements before you scout." }),
  ).toBeVisible();
  await expect(page.getByText("Fictional example profile")).toBeVisible();

  // 1. Choose the example.
  await page.getByRole("button", { name: "Use example restaurant" }).click();
  await expect(page.locator(".profile-facts")).toContainText("Cedar Kitchen");
  await expect(page.locator(".profile-facts")).toContainText("Mediterranean");
  await expect(page.locator(".answer-list article")).toHaveCount(7);
  await expect(page.locator(".answer-list")).toContainText(
    "Around $100,000 total, but I want to keep some of that for emergencies.",
  );
  await expect(page.locator(".answer-list")).toContainText("answer_6");
  await expect(page.locator(".requirement-table")).toContainText("5,000");
  await expect(page.locator(".requirement-table")).toContainText("40–50");
  await expect(page.locator(".requirement-table")).toContainText("hard");
  await expect(page.locator(".requirement-table")).toContainText("soft");
  await expect(page.locator(".requirement-table")).toContainText("Unknown");

  // 2. Edit with invalid input: reversed seats, then a reserve above funds.
  await page.getByRole("button", { name: "Edit requirements" }).click();
  await page.getByLabel("Preferred seats — minimum (preference)").fill("60");
  await page.getByLabel("Preferred seats — maximum (preference)").fill("40");
  await page.getByRole("button", { name: "Save profile draft" }).click();
  await expect(page.locator(".profile-error-summary")).toBeVisible();
  await expect(page.locator(".profile-error-summary")).toContainText(
    "cannot exceed",
  );
  await expect(page.locator(".profile-error-summary")).toBeFocused();
  await page.getByLabel("Preferred seats — minimum (preference)").fill("35");
  await page.getByLabel("Preferred seats — maximum (preference)").fill("45");
  await page.getByLabel("Emergency reserve (optional follow-up)").fill("150000");
  await page.getByRole("button", { name: "Save profile draft" }).click();
  await expect(page.locator(".profile-error-summary")).toContainText(
    "emergency reserve cannot exceed",
  );
  await expect(page.locator("#reserve-error")).toContainText(
    "cannot exceed the total available funds",
  );

  // 3. Correct the values and save.
  await page.getByLabel("Emergency reserve (optional follow-up)").fill("20000");
  await page.getByRole("button", { name: "Save profile draft" }).click();
  await expect(page.locator(".notice-toast")).toContainText(
    "Profile draft saved",
  );
  await expect(page.getByText("Saved revision 1", { exact: false })).toBeVisible();
  await expect(page.locator(".revision-list article")).toHaveCount(2);
  await expect(page.locator(".requirement-table")).toContainText("35–45");
  await expect(page.locator(".requirement-table")).toContainText("20,000");
  await expect(page.locator(".requirement-table")).toContainText("edited");
  // Original interview answers are preserved verbatim.
  await expect(page.locator(".answer-list")).toContainText(
    "Ideally around 40 to 50 seats.",
  );
  await expect(page.locator(".answer-list article")).toHaveCount(7);

  // 4. Reload and restore the saved revision.
  await page.reload();
  await expect(page.getByText("Saved revision 1", { exact: false })).toBeVisible();
  await expect(page.locator(".requirement-table")).toContainText("35–45");
  await expect(page.locator(".requirement-table")).toContainText("20,000");
  await expect(page.locator(".answer-list article")).toHaveCount(7);
  await page.getByRole("button", { name: "Edit requirements" }).click();
  await expect(
    page.getByLabel("Total monthly occupancy limit (hard)"),
  ).toHaveValue("5000");
  await expect(
    page.getByLabel("Preferred seats — minimum (preference)"),
  ).toHaveValue("35");
  await expect(
    page.getByLabel("Emergency reserve (optional follow-up)"),
  ).toHaveValue("20000");

  // 5. Continue to the existing explorer without breaking it.
  await page.getByRole("button", { name: "Continue to the scouting map" }).click();
  await expect(page.locator(".property-card")).toHaveCount(4);
  await expect(page.locator(".profile-strip")).toContainText("Cedar Kitchen");
  await expect(page.locator(".profile-strip")).toContainText("profile revision 1");
  await page.getByRole("button", { name: /Canopy Corner/ }).click();
  await page.getByRole("button", { name: "Try opening here" }).click();
  await expect(page.locator(".required-sales")).toHaveText("$30,714");
  // The explorer's own scenario save still works alongside the profile.
  await page.getByRole("button", { name: "Save scenario", exact: true }).click();
  await expect(page.locator(".saved-list article")).toHaveCount(1);
  // Return to the profile from the strip.
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Know the requirements before you scout." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("profile validation rejects unsupported markets and empty limits with accessible feedback", async ({
  page,
}) => {
  await page.goto("/expansion");
  await page.getByRole("button", { name: "Use example restaurant" }).click();
  await page.getByRole("button", { name: "Edit requirements" }).click();
  await page.getByLabel("Total monthly occupancy limit (hard)").fill("");
  await page.getByRole("button", { name: "Save profile draft" }).click();
  await expect(page.locator(".profile-error-summary")).toBeVisible();
  await expect(page.locator(".profile-error-summary")).toContainText(
    "Enter a monthly occupancy limit",
  );
  // Unsupported market is rejected at the same save boundary.
  await page.getByLabel("Total monthly occupancy limit (hard)").fill("5000");
  await page.getByLabel("Target market").selectOption("US-CA-Los Angeles");
  await page.getByRole("button", { name: "Save profile draft" }).click();
  await expect(page.locator(".profile-error-summary")).toContainText(
    "not a supported market",
  );
  // Inline error under the market select.
  await expect(page.locator("#market-error")).toContainText(
    "not a supported market",
  );
  await page.getByLabel("Target market").selectOption("US-TX-Houston");
  await page.getByRole("button", { name: "Save profile draft" }).click();
  await expect(page.locator(".notice-toast")).toContainText(
    "Profile draft saved",
  );
});

test("profile journey works keyboard-only", async ({ page }) => {
  await page.goto("/expansion");
  // Reach "Use example restaurant" with the keyboard alone.
  const exampleButton = page.getByRole("button", { name: "Use example restaurant" });
  for (let i = 0; i < 40 && !(await exampleButton.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(exampleButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".answer-list article")).toHaveCount(7);

  // Reach "Edit requirements" via keyboard.
  const editButton = page.getByRole("button", { name: "Edit requirements" });
  for (let i = 0; i < 40 && !(await editButton.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(editButton).toBeFocused();
  await page.keyboard.press("Enter");

  // Type invalid data with the keyboard only.
  await page.getByLabel("Preferred seats — minimum (preference)").focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("70");
  await page.getByLabel("Preferred seats — maximum (preference)").focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("40");
  const saveButton = page.getByRole("button", { name: "Save profile draft" });
  for (let i = 0; i < 60 && !(await saveButton.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(saveButton).toBeFocused();
  await page.keyboard.press("Enter");
  // Accessible summary receives focus.
  await expect(page.locator(".profile-error-summary")).toBeVisible();
  await expect(page.locator(".profile-error-summary")).toBeFocused();
  await expect(page.locator(".profile-error-summary")).toContainText(
    "cannot exceed",
  );

  // Correct with the keyboard, making a real change so a new revision saves.
  await page.getByLabel("Preferred seats — minimum (preference)").focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("38");
  await page.getByLabel("Preferred seats — maximum (preference)").focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("48");
  for (let i = 0; i < 60 && !(await saveButton.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
  await expect(page.locator(".notice-toast")).toContainText(
    "Profile draft saved",
  );
  await expect(page.getByText("Saved revision 1", { exact: false })).toBeVisible();

  // Continue to the explorer with the keyboard.
  const continueButton = page.getByRole("button", { name: "Continue to the scouting map" });
  for (let i = 0; i < 60 && !(await continueButton.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(continueButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".property-card")).toHaveCount(4);
  await expect(page.locator(".profile-strip")).toContainText("profile revision 1");
});

test("profile corrupt and unsupported storage is preserved until explicit reset", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, "{bad");
  }, PROFILE_KEY);
  await page.goto("/expansion");
  await expect(page.locator(".profile-storage-warning")).toBeVisible();
  await expect(page.locator(".profile-storage-warning")).toContainText(
    "preserved untouched",
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), PROFILE_KEY)).toBe("{bad");

  // Saving stays disabled while corrupt content is preserved.
  await page.getByRole("button", { name: "Use example restaurant" }).click();
  await page.getByRole("button", { name: "Edit requirements" }).click();
  await expect(page.getByRole("button", { name: "Save profile draft" })).toBeDisabled();

  // Explicit reset, then saving works and overwrites the stale key.
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.locator(".profile-storage-warning")).toHaveCount(0);
  await page.getByRole("button", { name: "Use example restaurant" }).click();
  await page.getByRole("button", { name: "Edit requirements" }).click();
  await page.getByRole("button", { name: "Save profile draft" }).click();
  await expect(page.locator(".notice-toast")).toContainText(
    "Profile draft saved",
  );
  expect(await page.evaluate((key) => localStorage.getItem(key)?.startsWith('{"schemaVersion":1'), PROFILE_KEY)).toBe(true);

  // Unknown version is reported and preserved too.
  await page.addInitScript((key) => {
    localStorage.setItem(key, '{"schemaVersion":99,"revisions":[]}');
  }, PROFILE_KEY);
  await page.reload();
  await expect(page.locator(".profile-storage-warning")).toContainText(
    "Unsupported draft version 99",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), PROFILE_KEY),
  ).toBe('{"schemaVersion":99,"revisions":[]}');
});

test("profile save failure keeps in-memory edits and does not lose the form", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (storageKey, value) {
      if (storageKey === key) throw new DOMException("QuotaExceededError");
      return original.call(this, storageKey, value);
    };
  }, PROFILE_KEY);
  await page.goto("/expansion");
  await page.getByRole("button", { name: "Use example restaurant" }).click();
  await page.getByRole("button", { name: "Edit requirements" }).click();
  await page.getByLabel("Total monthly occupancy limit (hard)").fill("4300");
  await page.getByRole("button", { name: "Save profile draft" }).click();
  await expect(page.locator(".notice-toast")).toContainText("Saving failed");
  await expect(
    page.getByLabel("Total monthly occupancy limit (hard)"),
  ).toHaveValue("4300");
  // Reload: nothing was persisted, so the gate returns with a fresh example.
  await page.reload();
  await expect(page.getByRole("button", { name: "Use example restaurant" })).toBeVisible();
});

test("profile gate, review and edit have no horizontal overflow at mobile width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/expansion");
  await expect(page.getByRole("button", { name: "Use example restaurant" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Use example restaurant" }).click();
  await expect(page.locator(".answer-list article")).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Edit requirements" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Save profile draft" }).click();
  await expect(page.locator(".notice-toast")).toContainText("Profile draft saved");
  await page.getByRole("button", { name: "Continue to the scouting map" }).click();
  await expect(page.locator(".property-card")).toHaveCount(4);
  await expect(page.locator(".profile-strip")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
