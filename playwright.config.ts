import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const dataDir = resolve(process.cwd(), "src/features/expansion/data/data");
// Explicit opt-in live-model acceptance still uses only the synthetic cache.
const liveAgentAcceptance = process.env.EXPANSION_E2E_LIVE_MODEL === "1";

export default defineConfig({
  testDir: "./src/features/expansion/frontend/e2e",
  globalSetup: "./src/features/expansion/frontend/e2e/global-setup.ts",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.PLAYWRIGHT_CHANNEL,
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000",
    // Never reuse an existing dev server: the synthetic-cache overrides below
    // only apply to a server Playwright starts itself. Stop any dev server
    // on port 3000 first, or Playwright will report the port as busy.
    reuseExistingServer: false,
    timeout: 120_000,
    // Test-owned synthetic cache: the real backend reads these instead of a
    // developer's imported dataset. Stop any already-running dev server so
    // these overrides take effect.
    env: {
      EXPANSION_E2E_DB_PATH: resolve(dataDir, "e2e-synthetic.sqlite"),
      EXPANSION_E2E_DATASET_ID: "synthetic-e2e-v1",
      EXPANSION_E2E_COSTAR_ROOT: resolve(dataDir, "e2e-kit"),
      EXPANSION_E2E_RUNS_DIR: resolve(dataDir, "runs-e2e"),
      // Phase 3: scripted deterministic model double for the browser journey;
      // a "live" request is forced offline so the outage fallback spec never
      // touches a real provider. Both are documented, labeled test modes.
      EXPANSION_AGENT_DEFAULT_MODE: liveAgentAcceptance ? "live" : "scripted",
      EXPANSION_AGENT_E2E_FORCE_OFFLINE: liveAgentAcceptance ? "0" : "1",
      EXPANSION_SOURCE_NETWORK: "0",
      EXPANSION_AGENT_RUNS_DIR: resolve(dataDir, "runs-e2e"),
      // The browser suite must not depend on the developer's .env.local:
      // Tactical is pinned to its demo fixture (pre-set env wins over
      // .env.local in Next dev, verified 2026-11-14) so a developer's
      // TACTICAL_DATA_SOURCE=mongodb cannot break the shared gate.
      TACTICAL_DATA_SOURCE: "demo",
    },
  },
});
