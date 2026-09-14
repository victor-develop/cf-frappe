import { request, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Both files live under `.wrangler/`, which is gitignored; the webServer reset
// in playwright.config.ts wipes only `playwright-state`, so the storage state
// written here survives long enough for the tests to read it and is rewritten
// on the next run.
const STORAGE_STATE_PATH = ".wrangler/playwright-admin-storage-state.json";

/**
 * Seeds the demo fixtures once per run, over plain HTTP, and captures the Demo
 * Administrator persona cookie into the storage state every browser context
 * starts with.
 *
 * This used to be the first act of every spec: open /demo, click the persona
 * button, click the seed button, and wait for the "Fixtures are ready" heading.
 * That shape had two costs (issue #44). A seed failure looked like four broken
 * journeys, because all four specs hung on the same heading assert instead of
 * one setup step failing. And it spent browser-driven wall clock inside every
 * test, which the 20 s test budget in playwright.config.ts can no longer
 * afford. The browser adds nothing here: the persona is only a cookie
 * (`returns_demo_persona`), and `POST /demo/seed` is the same native form
 * handler the button posts, answering with the same "Fixtures are ready" page.
 *
 * Seeding once per run is equivalent to the per-spec re-seeds it replaces: the
 * seed is idempotent by construction (documents are created only when absent,
 * transitions only run from the state that precedes them), and the webServer
 * reset gives every run a fresh D1 state, so no spec inherits another's
 * mutations between runs.
 *
 * A failed seed must surface as a single setup error naming the cause. The
 * handler answers a seed failure with its own 500 error page rather than a
 * transport-level status, so the check below requires the success heading and
 * quotes whatever body actually came back.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (baseURL === undefined) {
    throw new Error("playwright.config.ts defines no use.baseURL; the demo app cannot be reached");
  }

  const context = await request.newContext({ baseURL });
  try {
    const persona = await context.post("/demo/persona/admin");
    if (!persona.ok()) {
      const body = await persona.text();
      throw new Error(
        `Selecting the Demo Administrator persona failed: HTTP ${String(persona.status())} from ${baseURL}/demo/persona/admin. Body starts: ${body.slice(0, 400)}`
      );
    }

    const seed = await context.post("/demo/seed");
    const body = await seed.text();
    if (!seed.ok() || !body.includes("Fixtures are ready")) {
      throw new Error(
        `Seeding demo fixtures failed: HTTP ${String(seed.status())} from ${baseURL}/demo/seed. Body starts: ${body.slice(0, 400)}`
      );
    }

    mkdirSync(dirname(STORAGE_STATE_PATH), { recursive: true });
    await context.storageState({ path: STORAGE_STATE_PATH });
  } finally {
    await context.dispose();
  }
}
