import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Mobile-viewport acceptance for the generic DocType slice: every page in
 * this journey runs at a phone-sized viewport (390x844) and asserts the
 * usability essentials alongside the functional flow — no horizontal
 * overflow, tap targets at or above the WCAG 2.5.8 minimum (24x24 CSS px),
 * and form controls reachable through associated labels.
 */
test.use({ viewport: { width: 390, height: 844 } });

const LIST_PATH = "/desk/Return%20Request";

test("mobile DocType journey: quick-filtered list -> form edit -> save persists, with usability essentials", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Demo Administrator", exact: true }).click();
  await expect(page.getByText("Current persona: Demo Administrator", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Seed deterministic demo data", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fixtures are ready", exact: true })).toBeVisible();

  // ORD-1003's return has reason "Damaged"; ORD-1001's has "Changed Mind",
  // so the quick filter below must keep the first and drop the second.
  const damagedReturn = await seededReturnNameForOrder(page, "ORD-1003");
  const changedMindReturn = await seededReturnNameForOrder(page, "ORD-1001");

  // List: renders inside the mobile viewport with both fixtures present.
  await page.goto(LIST_PATH);
  await expect(page.getByRole("heading", { name: "Return Request", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: damagedReturn, exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Quick filter: the Return Reason choice control is reached through its
  // fieldset legend and associated Value label (proving the label wiring),
  // then submitted through a tap-sized Filter button.
  const filtersDisclosure = page.locator("details.list-filters");
  await filtersDisclosure.locator("> summary").click();
  await expect(filtersDisclosure).toHaveJSProperty("open", true);
  const reasonFilter = filtersDisclosure.getByRole("group", { name: "Return Reason", exact: true });
  await expect(reasonFilter).toBeVisible();
  // The combobox takes its accessible name from the wrapping label, so this
  // locator only resolves when the label/control association is intact.
  await reasonFilter.getByRole("combobox", { name: "Value", exact: true }).selectOption("Damaged");
  const filterButton = page.getByRole("button", { name: "Filter", exact: true });
  await expectUsableTapTarget(filterButton);
  await filterButton.click();

  await expect(page.locator(".filter-chip", { hasText: "reason eq Damaged" })).toBeVisible();
  await expect(page.getByRole("link", { name: damagedReturn, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: changedMindReturn, exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  // Form: open the filtered document from the list. (The row link is inline
  // text, which WCAG 2.5.8 exempts from the 24px minimum.)
  await page.getByRole("link", { name: damagedReturn, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/desk/Return%20Request/${encodeURIComponent(damagedReturn)}$`));
  await expect(page.getByRole("heading", { name: damagedReturn, exact: true, level: 1 })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectDocumentFormControlsLabelled(page);

  // Edit through the label association, save through a tap-sized button.
  const tracking = page.getByLabel("Tracking Number", { exact: true });
  await tracking.scrollIntoViewIfNeeded();
  await expectUsableTapTarget(tracking);
  await tracking.fill("MOBILE-TRACK-1003");
  const saveButton = page.getByRole("button", { name: "Save", exact: true }).first();
  await expectUsableTapTarget(saveButton);
  await saveButton.click();

  // POST + 303 lands back on the form; a full reload proves the change is
  // persisted server-side rather than echoed by the client.
  await expect(page).toHaveURL(new RegExp(`/desk/Return%20Request/${encodeURIComponent(damagedReturn)}$`));
  await expect(page.getByLabel("Tracking Number", { exact: true })).toHaveValue("MOBILE-TRACK-1003");
  await page.reload();
  await expect(page.getByLabel("Tracking Number", { exact: true })).toHaveValue("MOBILE-TRACK-1003");
});

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

/** WCAG 2.5.8: interactive targets should be at least 24x24 CSS pixels. */
async function expectUsableTapTarget(target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  if (box === null) {
    throw new Error("The tap target has no bounding box");
  }
  expect(box.width).toBeGreaterThanOrEqual(24);
  expect(box.height).toBeGreaterThanOrEqual(24);
}

/**
 * Every visible control in the document form must be reachable through an
 * associated <label> (wrapping or for/id) or an ARIA label.
 */
async function expectDocumentFormControlsLabelled(page: Page): Promise<void> {
  const unlabelled = await page.evaluate(() => {
    const controls = Array.from(
      document.querySelectorAll("form.document-form input, form.document-form select, form.document-form textarea")
    );
    return controls
      .filter((control) => {
        const field = control as unknown as {
          readonly type?: string;
          readonly labels?: { readonly length: number } | null;
          readonly getAttribute: (name: string) => string | null;
          readonly tagName: string;
        };
        if (field.type === "hidden") {
          return false;
        }
        if (field.labels !== null && field.labels !== undefined && field.labels.length > 0) {
          return false;
        }
        return field.getAttribute("aria-label") === null && field.getAttribute("aria-labelledby") === null;
      })
      .map((control) => {
        const field = control as unknown as {
          readonly getAttribute: (name: string) => string | null;
          readonly tagName: string;
        };
        return `${field.tagName.toLowerCase()}[name="${field.getAttribute("name") ?? ""}"]`;
      });
  });
  expect(unlabelled).toEqual([]);
}

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
