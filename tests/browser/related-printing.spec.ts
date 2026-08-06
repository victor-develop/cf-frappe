import { expect, test } from "@playwright/test";

test("ReturnsOS exposes permission-aware Related resources and Printing journeys", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Demo Administrator", exact: true }).click();
  await expect(page.getByText("Current persona: Demo Administrator", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Seed deterministic demo data", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fixtures are ready", exact: true })).toBeVisible();

  await page.goto("/desk/Return%20Request/RMA-1001");
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
  await expect(incomingOrder).toHaveAttribute(
    "href",
    "/desk/Order?filter_latest_return=RMA-1001&default_filters=0"
  );
  await incomingOrder.click();
  await expect(page).toHaveURL(/\/desk\/Order\?filter_latest_return=RMA-1001&default_filters=0$/);
  await expect(page.getByRole("link", { name: "ORD-1001", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "ORD-1002", exact: true })).toHaveCount(0);

  await page.goto("/desk/Return%20Request/RMA-1001");
  const printAction = page.getByRole("link", {
    name: "Return Authorization Operational return authorization and refund summary.",
    exact: true
  });
  await expect(printAction).toHaveAttribute("href", "/desk/print/Return%20Authorization/RMA-1001");
  await printAction.click();
  await expect(page.getByRole("heading", { name: "RMA-1001", exact: true })).toBeVisible();
  await expect(page.getByText("Return Authorization", { exact: true })).toBeVisible();

  await page.goto("/desk/printing");
  await expect(page.getByRole("heading", { name: "Printing", exact: true })).toBeVisible();
  await page.getByRole("link", {
    name: "Return Authorization Return Request · Operational return authorization and refund summary. Print Format",
    exact: true
  }).click();
  await expect(page.getByRole("heading", { name: "Preview Documents", exact: true })).toBeVisible();
  await expect(page.locator('a[href="/desk/print/Return%20Authorization/RMA-1001"]')).toBeVisible();
  await expect(page.locator('a[href="/desk/print/Return%20Authorization/RMA-1001/pdf"]')).toHaveCount(0);

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
