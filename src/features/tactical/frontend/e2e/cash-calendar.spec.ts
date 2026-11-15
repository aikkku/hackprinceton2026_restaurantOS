import {test,expect} from "@playwright/test";
import demo from "../../frontend/data/demo-restaurant.json" with { type: "json" };
const bank={...demo.operations.cashCalendar.bank,source:"nessie-sandbox",fetchedAt:"2026-11-30T13:00:00.000Z"};
test.beforeEach(async({page})=>{
 await page.route("**/api/tactical/ai/session",route=>route.fulfill({json:{unlocked:true}}));
 await page.route("**/api/tactical/ai",route=>route.fulfill({status:503,json:{error:"Something is wrong"}}));
});
async function open(page:import("@playwright/test").Page){await page.goto("/tactical/finance");await page.getByRole("button",{name:"Cash calendar",exact:true}).click();return page.getByRole("region",{name:"Cash calendar",exact:true});}
test("calendar connects source events, edits assumptions, saves and restores original forecast",async({page})=>{
 const cash=await open(page);
 await expect(cash.getByRole("heading",{name:"Know what’s coming."})).toBeVisible();
 await expect(cash.getByText("Local demo · simulated funds",{exact:true})).toBeVisible();
 await cash.getByRole("button",{name:/Lowest projected cash/}).click();
 await expect(cash.getByRole("complementary",{name:"Selected cash day"})).toContainText("Projected close");
 await cash.getByRole("button",{name:"Assumptions",exact:true}).click();
 const settings=cash.getByRole("form",{name:"Cash assumptions"});await settings.getByLabel("Minimum reserve ($)",{exact:true}).fill("50000");
 await settings.getByRole("button",{name:"Apply assumptions"}).click();
 await expect(cash.getByRole("button",{name:/Reserve cushion at low point/})).toContainText("$50,000");
 await cash.getByLabel("Forecast name",{exact:true}).fill("Owner cash plan");await cash.getByRole("button",{name:"Save forecast",exact:true}).click();
 await expect(cash.getByRole("status")).toContainText("saved in this browser");
 await page.reload();await page.getByRole("button",{name:"Cash calendar",exact:true}).click();
 await expect(cash.getByLabel("Forecast name",{exact:true})).toHaveValue("Owner cash plan");
 await expect(cash.getByRole("button",{name:/Reserve cushion at low point/})).toContainText("$50,000");
 await cash.getByRole("button",{name:"Use local demo",exact:true}).click();
 await expect(cash.getByRole("button",{name:/Reserve cushion at low point/})).toContainText("$10,000");
 const savedId=await cash.getByLabel("Saved cash forecasts").locator("option").nth(1).getAttribute("value");await cash.getByLabel("Saved cash forecasts").selectOption(savedId!);
 await expect(cash.getByRole("button",{name:/Reserve cushion at low point/})).toContainText("$50,000");
});
test("live sandbox refresh is explicit and a failed refresh preserves its stale snapshot",async({page})=>{
 let calls=0;await page.route("**/api/tactical/cash-calendar",route=>{calls++;return calls===1?route.fulfill({json:{ok:true,bank,bankSnapshotId:"123e4567-e89b-42d3-a456-426614174000"}}):route.fulfill({status:503,json:{error:"Cash calendar service is unavailable."}});});
 const cash=await open(page);await cash.getByRole("button",{name:"Refresh bank data",exact:true}).click();await expect(cash.getByText("Nessie API · simulated funds",{exact:true})).toBeVisible();
 await expect(cash.locator(".cash-calendar-bar h4")).toHaveText("December 2026");
 await cash.getByRole("button",{name:"Refresh bank data",exact:true}).click();await expect(cash.getByRole("alert")).toContainText("Previous snapshot retained");await expect(cash.getByText("Nessie API · simulated funds",{exact:true})).toBeVisible();await expect(cash.locator(".cash-meta")).toContainText("stale snapshot");
});
test("narrow agenda and keyboard controls work without overflow or calendar AI calls",async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:"reduce"});
 const cash=await open(page);await cash.getByRole("button",{name:"Agenda",exact:true}).click();
 await expect(cash.getByLabel("Cash agenda")).toBeVisible();
 await cash.getByLabel("Cash agenda").getByRole("button",{name:/Nov 21, 2026/}).click();
 await expect(cash.getByRole("complementary",{name:"Selected cash day"})).toBeVisible();
 await page.keyboard.press("Escape");await expect(cash.getByRole("complementary",{name:"Selected cash day"})).toBeHidden();
 await cash.getByLabel("Next cash month",{exact:true}).focus();await page.keyboard.press("Enter");await expect(cash.locator(".cash-calendar-bar h4")).toHaveText("December 2026");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await cash.getByRole("button",{name:"Assumptions",exact:true}).click();await cash.getByRole("button",{name:"Add payment",exact:true}).click();
 const payment=cash.getByRole("group",{name:"New planned payment",exact:true});await payment.getByLabel("Name",{exact:true}).fill("Test equipment");await payment.getByLabel("Amount ($)",{exact:true}).fill("900");await cash.getByRole("button",{name:"Apply assumptions",exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await cash.getByRole("button",{name:"Month",exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
