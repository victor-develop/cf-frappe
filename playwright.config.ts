import { defineConfig } from "@playwright/test";

const port = 8_798;
const baseURL = `http://127.0.0.1:${String(port)}`;
const statePath = ".wrangler/playwright-state";

export default defineConfig({
  testDir: "./tests/browser",
  globalSetup: "./tests/browser/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  // Every recorded CI failure in issue #44 is a hard failure, not a slow run:
  // a browser session that died mid-test (`Protocol error
  // (Runtime.callFunctionOn): Internal server error, session closed.`), a
  // detached frame, a navigation to a worker that had stopped answering, or an
  // assertion left waiting on a page that never arrived. And the failure mode
  // that dominates the recordings is a hung `expect`: a wedged renderer never
  // returns from the CDP call behind a locator assertion, which ignores both
  // `expect.timeout` and `actionTimeout`, so the *test* timeout is the only
  // thing that ends it — #60 measured a hung expect at 49.8 s against a 45 s
  // budget. Five of the nine slow operations across the recorded runs were
  // expects, three of them waiting on the "Fixtures are ready" heading — a
  // wait the global setup (global-setup.ts) deletes outright, along with the
  // browser-driven seeding every test used to carry (0.5-1.8 s per test,
  // measured before vs. after).
  //
  // That is what makes the 20 s test timeout below affordable, and it is the
  // number issue #44 asks for: a hung expect now reports at 20 s instead of
  // waiting out the budget. The margin is measured, not guessed, and it is
  // thin rather than generous: locally the heaviest test (kanban) runs at
  // 2.8 s after the move against 4.6 s before, the rest under 2 s against
  // 1.9-2.3 s; the only green CI run with per-test data (34123591232) used
  // 8.2-19.3 s per test with the in-test seed still included, and subtracting
  // only the locally measured seed saving from that 19.3 s peak leaves
  // 17.5-18.8 s — 1-3 s of headroom against the worst test ever recorded
  // green on CI. If CI's slower runner makes its seed proportionally dearer,
  // the headroom is wider; either way the recorded greens fit inside 20 s.
  // If a green run ever trips it, the number — not the bound — is what moves,
  // and it moves on fresh measurements.
  timeout: 20_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    // Written by global-setup.ts: the Demo Administrator persona cookie that
    // the specs used to obtain by clicking through /demo at the start of every
    // test. `related-printing` still switches persona mid-journey with its own
    // explicit click; a storage-state cookie is just the starting point.
    storageState: ".wrangler/playwright-admin-storage-state.json",
    // Slowest single navigation measured on a CI runner is well under 10 s;
    // anything past this is a stuck session rather than a slow page.
    actionTimeout: 20_000,
    navigationTimeout: 20_000
  },
  reporter: "line",
  webServer: {
    // `&&` means a failure in the reset or the migrations never starts
    // `wrangler dev`, and Playwright then reports only that it could not
    // connect. Each step echoes first so the CI log names the one that failed.
    command: [
      `echo "[webServer] resetting ${statePath}"`,
      `node -e "require('node:fs').rmSync('${statePath}',{recursive:true,force:true})"`,
      `echo "[webServer] applying migrations"`,
      `npx wrangler d1 migrations apply cf-frappe-dev --local --persist-to=${statePath}`,
      `echo "[webServer] starting wrangler dev on ${String(port)}"`,
      `npx wrangler dev --persist-to=${statePath} --port ${String(port)}`
    ].join(" && "),
    // Without this the echoes above go nowhere: `webServer.stdout` defaults to
    // "ignore", and only stderr is piped. A failing step then shows as nothing
    // but "Process from config.webServer was not able to start. Exit code: N".
    stdout: "pipe",
    url: `${baseURL}/demo`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
