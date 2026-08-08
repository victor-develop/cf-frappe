import { expect, test, type Page } from "@playwright/test";

const BOARD_PATH = "/desk/kanbans/Return%20Case%20Board";

test("Kanban island: keyboard card moves persist, with a working no-JS style fallback boundary", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Demo Administrator", exact: true }).click();
  await expect(page.getByText("Current persona: Demo Administrator", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Seed deterministic demo data", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fixtures are ready", exact: true })).toBeVisible();

  const draftReturn = await seededReturnNameForOrder(page, "ORD-1006");

  // Non-island pages ship zero island/React bytes (bundle isolation).
  const listResponse = await page.request.get("/desk/Return%20Request");
  expect(listResponse.ok()).toBe(true);
  expect(await listResponse.text()).not.toContain("/desk/islands/");

  // Desktop: the server-rendered board progressively enhances into the island.
  await page.goto(BOARD_PATH);
  const mount = page.locator('[data-cf-frappe-island="kanban"]');
  await expect(mount).toHaveAttribute("data-island-ready", "");
  await expect(mount.locator("[data-island-fallback]")).toBeHidden();

  const card = page.locator(`[data-card-name="${draftReturn}"]`);
  await expect(card).toHaveAttribute("data-card-column", "Draft");
  const cardTitle = (await card.locator("strong").innerText()).trim();

  // Keyboard journey: pick up, target the next column, drop.
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".kanban-live")).toContainText(`Picked up ${cardTitle} from Draft.`);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".kanban-live")).toContainText("targeting Submitted");
  await page.keyboard.press("Enter");
  await expect(page.locator(".kanban-live")).toContainText(`Moved ${cardTitle} to Submitted.`);
  await expect(card).toHaveAttribute("data-card-column", "Submitted");

  // The server is the authority: the move survives a full reload.
  await page.reload();
  await expect(mount).toHaveAttribute("data-island-ready", "");
  await expect(page.locator(`[data-card-name="${draftReturn}"]`)).toHaveAttribute(
    "data-card-column",
    "Submitted"
  );

  // Mobile viewport: the island stays usable and the move persists too.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BOARD_PATH);
  await expect(mount).toHaveAttribute("data-island-ready", "");
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);

  const mobileCard = page.locator(`[data-card-name="${draftReturn}"]`);
  await mobileCard.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".kanban-live")).toContainText("targeting Processing");
  await page.keyboard.press("Enter");
  await expect(page.locator(".kanban-live")).toContainText(`Moved ${cardTitle} to Processing.`);

  await page.reload();
  await expect(page.locator(`[data-card-name="${draftReturn}"]`)).toHaveAttribute(
    "data-card-column",
    "Processing"
  );

  // Blocked transitions are announced and never posted: Processing -> Closed
  // has no direct workflow transition.
  const blockedCard = page.locator(`[data-card-name="${draftReturn}"]`);
  await blockedCard.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".kanban-live")).toContainText("targeting Closed");
  await page.keyboard.press("Enter");
  await expect(page.locator(".kanban-live")).toContainText("No workflow transition from Processing to Closed");
  await expect(blockedCard).toHaveAttribute("data-card-column", "Processing");
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
