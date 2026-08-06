import { defineConfig } from "@playwright/test";

const port = 8_798;
const baseURL = `http://127.0.0.1:${String(port)}`;

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "line",
  use: {
    baseURL,
    trace: "retain-on-failure"
  },
  webServer: {
    command: `npm run d1:migrate:local && npm run dev -- --port ${String(port)}`,
    url: `${baseURL}/demo`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
