import { defineConfig } from "@playwright/test";

const port = 8_798;
const baseURL = `http://127.0.0.1:${String(port)}`;
const statePath = ".wrangler/playwright-state";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  // Every recorded CI failure in issue #44 is a hard failure, not a slow run:
  // a browser session that died mid-test (`Protocol error
  // (Runtime.callFunctionOn): Internal server error, session closed.`), a
  // detached frame, a navigation to a worker that had stopped answering, or an
  // assertion left waiting on a page that never arrived. So the total budget is
  // not what needs widening — my first attempt at this raised it to 120 s, which
  // would only have made the same red take twice as long to report.
  //
  // What the bounds below actually buy, measured rather than assumed: with a
  // wedged renderer a `click` and a `goto` fail at 20 s, but an `expect` runs to
  // the *test* timeout regardless — 49.8 s observed against an `expect.timeout`
  // of 10 s and an `actionTimeout` of 20 s, because nothing preempts a hung CDP
  // call. Five of the nine slow operations across the recorded runs were
  // expects, so this bounds four of nine: run 33637825379 goes from 3m24s to
  // roughly 2m30s, not "seconds".
  //
  // Bounding the expect case as well means lowering the test timeout, which
  // trades against legitimately slow runs — CI uses 8.2-19.3 s of the 45 s in
  // this branch's own green run (34123591232), so there is not much room to give.
  // Left alone deliberately.
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
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
