import { expect, test, type Page } from "@playwright/test";

test("ReturnsOS exposes permission-aware Related resources and Printing journeys", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Demo Administrator", exact: true }).click();
  await expect(page.getByText("Current persona: Demo Administrator", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Seed deterministic demo data", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fixtures are ready", exact: true })).toBeVisible();

  const returnName = await seededReturnNameForOrder(page, "ORD-1001");
  const encodedReturnName = encodeURIComponent(returnName);
  await page.goto(`/desk/Return%20Request/${encodedReturnName}`);
  const related = page.getByRole("region", { name: "Related resources", exact: true });
  await expect(related).toBeVisible();
  await expect(related.getByRole("link", { name: "Order Outgoing via Order DocType", exact: true })).toHaveAttribute(
    "href",
    "/desk/Order/ORD-1001"
  );
  const incomingOrder = related.getByRole("link", {
    name: "Order Incoming via Latest Return DocType",
    exact: true
  });
  const incomingOrderHref = `/desk/Order?filter_latest_return=${encodedReturnName}&default_filters=0`;
  await expect(incomingOrder).toHaveAttribute(
    "href",
    incomingOrderHref
  );
  await incomingOrder.click();
  await expect.poll(() => {
    const url = new URL(page.url());
    return `${url.pathname}${url.search}`;
  }).toBe(incomingOrderHref);
  await expect(page.getByRole("link", { name: "ORD-1001", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "ORD-1002", exact: true })).toHaveCount(0);

  await page.goto(`/desk/Return%20Request/${encodedReturnName}`);
  const printAction = page.getByRole("link", {
    name: "Return Authorization Operational return authorization and refund summary.",
    exact: true
  });
  const printHref = `/desk/print/Return%20Authorization/${encodedReturnName}`;
  await expect(printAction).toHaveAttribute("href", printHref);
  await printAction.click();
  await expect(page.getByRole("heading", { name: returnName, exact: true })).toBeVisible();
  await expect(page.getByText("Return Authorization", { exact: true })).toBeVisible();

  await page.goto("/desk/printing");
  await expect(page.getByRole("heading", { name: "Printing", exact: true })).toBeVisible();
  await page.getByRole("link", {
    name: "Return Authorization Return Request · Operational return authorization and refund summary. Print Format",
    exact: true
  }).click();
  await expect(page.getByRole("heading", { name: "Preview Documents", exact: true })).toBeVisible();
  await expect(page.locator(`a[href="${printHref}"]`)).toBeVisible();
  await expect(page.locator(`a[href="${printHref}/pdf"]`)).toHaveCount(0);

  await page.goto("/desk/admin/print-settings");
  await expect(page).toHaveURL(/\/desk\/printing#default-layout$/);
  await expect(page.getByRole("heading", { name: "Default Print Layout", exact: true })).toBeVisible();

  await page.goto("/demo");
  await page.getByRole("button", { name: "Returns Agent", exact: true }).click();
  await page.goto("/desk/printing");
  await expect(page.getByRole("heading", { name: "Default Print Layout", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Settings", exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/desk/printing");
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
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
