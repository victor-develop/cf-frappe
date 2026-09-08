import { expect, type Page } from "@playwright/test";

/**
 * Selects the Demo Administrator persona and seeds the fixtures every spec
 * needs.
 *
 * The seed is idempotent by construction rather than by resetting: documents
 * are created only when absent, and a workflow transition runs only when the
 * document is in the state that precedes it. So repeating it does not undo what
 * a previous spec did, and each spec calls it because it needs the fixtures
 * present, not because it needs them pristine.
 *
 * Deliberately no timeout of its own. The click is a native form POST, so it
 * covers the whole seed round trip — measured at 1.8 s cold and 0.4-0.9 s warm,
 * with the assertion under 107 ms — which leaves the default 10 s budget ample
 * headroom. A longer one made things worse in two ways: it can never actually
 * fire, because the test's own 45 s budget expires first, and removing the 10 s
 * bound turned a broken seed from a 10 s failure naming the missing heading into
 * a 45 s generic "test timeout". See issue #44.
 */
export async function seedDemoFixtures(page: Page): Promise<void> {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Demo Administrator", exact: true }).click();
  await expect(page.getByText("Current persona: Demo Administrator", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Seed deterministic demo data", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fixtures are ready", exact: true })).toBeVisible();
}
