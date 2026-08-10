import { expect, test, type Page } from "@playwright/test";

/**
 * Progressive-enhancement acceptance: core Desk pages stay usable with
 * JavaScript disabled. Every page in this journey is exercised with
 * `javaScriptEnabled: false`, so nothing here can be rescued by the island
 * loader, the desk client bundle, or any other script.
 */
test.use({ javaScriptEnabled: false });

const BOARD_PATH = "/desk/kanbans/Return%20Case%20Board";

test("no-JS Desk journey: kanban fallback board, and list -> form -> native POST submit", async ({ page }) => {
  // The demo shell is script-free by design: persona selection and seeding
  // are native form POSTs guarded by CSP `default-src 'none'`.
  await page.goto("/demo");
  await page.getByRole("button", { name: "Demo Administrator", exact: true }).click();
  await expect(page.getByText("Current persona: Demo Administrator", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Seed deterministic demo data", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fixtures are ready", exact: true })).toBeVisible();

  const returnName = await seededReturnNameForOrder(page, "ORD-1001");
  const encodedReturnName = encodeURIComponent(returnName);

  // Kanban board: the island never mounts, the server-rendered fallback
  // stays visible, and its card links navigate to the document form.
  await page.goto(BOARD_PATH);
  const mount = page.locator('[data-cf-frappe-island="kanban"]');
  await expect(mount).toBeVisible();
  await expect(page.locator("[data-island-ready]")).toHaveCount(0);
  const fallback = mount.locator("[data-island-fallback]");
  await expect(fallback).toBeVisible();
  await expect(fallback.locator(".kanban-column").first()).toBeVisible();
  const cardLink = fallback.locator(`a.kanban-card[href="/desk/Return%20Request/${encodedReturnName}"]`);
  await expect(cardLink).toBeVisible();
  await cardLink.click();
  await expect(page).toHaveURL(new RegExp(`/desk/Return%20Request/${encodedReturnName}$`));
  await expect(page.getByRole("heading", { name: returnName, exact: true, level: 1 })).toBeVisible();

  // Generic DocType journey: list -> form -> edit a field -> native POST
  // submit -> 303 back to the form with the change persisted.
  await page.goto("/desk/Return%20Request");
  await page.getByRole("link", { name: returnName, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/desk/Return%20Request/${encodedReturnName}$`));

  const tracking = page.getByLabel("Tracking Number", { exact: true });
  await tracking.fill("NOJS-TRACK-0001");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();

  await expect(page).toHaveURL(new RegExp(`/desk/Return%20Request/${encodedReturnName}$`));
  await expect(page.getByLabel("Tracking Number", { exact: true })).toHaveValue("NOJS-TRACK-0001");
});

async function seededReturnNameForOrder(page: Page, order: string): Promise<string> {
  const response = await page.request.get(
    `/api/resource/Return%20Request?default_filters=0&filter_order=${encodeURIComponent(order)}&limit=1`
  );
  if (!response.ok()) {
    throw new Error(`Could not query the seeded return for ${order}: ${String(response.status())}`);
  }

  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("The seeded return query returned an invalid response body");
  }
  const data = (body as Record<string, unknown>).data;
  const first = Array.isArray(data) ? data[0] : undefined;
  if (typeof first !== "object" || first === null || Array.isArray(first)) {
    throw new Error(`No seeded return was found for ${order}`);
  }
  const name = (first as Record<string, unknown>).name;
  if (typeof name !== "string" || !/^RMA-[A-Za-z0-9-]{1,60}$/.test(name)) {
    throw new Error(`The seeded return for ${order} has an invalid name`);
  }
  return name;
}
