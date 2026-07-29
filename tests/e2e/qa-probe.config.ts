// QA probe config: runs the SHIPPED e2e specs against an already-running dev
// server, with no webServer of its own, so a bug can be reproduced without a
// production build. Not part of `pnpm test:e2e`.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.QA_BASE_URL ?? "http://127.0.0.1:5361",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
