import { defineConfig } from "@playwright/test";

const port = 8_798;
const baseURL = `http://127.0.0.1:${String(port)}`;
const statePath = ".wrangler/playwright-state";

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
    command: `node -e "require('node:fs').rmSync('${statePath}',{recursive:true,force:true})" && npx wrangler d1 migrations apply cf-frappe-dev --local --persist-to=${statePath} && npx wrangler dev --persist-to=${statePath} --port ${String(port)}`,
    url: `${baseURL}/demo`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
