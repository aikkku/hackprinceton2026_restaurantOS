import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./src/features/tactical/frontend/e2e",
  use: { baseURL: "http://127.0.0.1:3057" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env.PLAYWRIGHT_CHANNEL } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: { command: "npm run start -- --port 3057 --hostname 127.0.0.1", url: "http://127.0.0.1:3057", reuseExistingServer: !process.env.CI },
});
