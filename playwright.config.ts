import { defineConfig, devices } from "@playwright/test";

const e2eDistDir = process.env.NEXT_DIST_DIR ?? ".next-e2e";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
  // Serialize WebGL/Rapier release checks. The dedicated 4x CPU-throttle test
  // supplies controlled load without unrelated software-renderer contention.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "pnpm start --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: !process.env.CI,
    env: { NEXT_PUBLIC_E2E_TEST_MODE: "1", NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100", NEXT_DIST_DIR: e2eDistDir },
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox-smoke", testMatch: [ /home\.spec\.ts/, /cross-browser\.spec\.ts/ ], use: { ...devices["Desktop Firefox"] } },
    { name: "webkit-smoke", testMatch: [ /home\.spec\.ts/, /cross-browser\.spec\.ts/ ], use: { ...devices["Desktop Safari"] } },
  ],
});
