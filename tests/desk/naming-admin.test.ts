import {
  DocumentService,
  InMemoryDocumentStore,
  NamingService,
  QueryService,
  createDeskApp,
  createRegistry,
  defineDocType,
  fixedClock,
  type Actor
} from "../../src";

const tenantId = "acme";
const admin: Actor = { id: "admin@example.test", roles: ["System Manager"], tenantId };
const user: Actor = { id: "user@example.test", roles: ["User"], tenantId };

const Package = defineDocType({
  name: "Package",
  fields: [
    { name: "package_number", label: "Package Number", type: "text", required: true, readOnly: true, noCopy: true },
    { name: "warehouse", type: "text" }
  ],
  permissions: [{ roles: ["System Manager", "User"], actions: ["read", "create"] }]
});

describe("Desk naming administration", () => {
  it("renders metadata-driven controls and supports save, preview, and counter adjustment", async () => {
    const fixture = createFixture(admin);
    const initial = await fixture.app.request("/desk/admin/naming?doctype=Package");
    expect(initial.status).toBe(200);
    const initialHtml = await initial.text();
    expect(initialHtml).toContain("Naming Strategy");
    expect(initialHtml).toContain("Package Number");
    expect(initialHtml).toContain('name="scopeField" value="warehouse"');

    const saved = await fixture.app.request("/desk/admin/naming", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        doctype: "Package",
        expectedVersion: "0",
        pattern: "PKG-{YYYY}-{sequence:4}",
        counter: "packages",
        targetField: "package_number",
        padding: "4",
        start: "1",
        step: "1",
        reset: "year",
        maxAttempts: "1000",
        exclusions: "[]"
      })
    });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/desk/admin/naming?doctype=Package");

    const configured = await fixture.app.request("/desk/admin/naming?doctype=Package");
    const configuredHtml = await configured.text();
    expect(configuredHtml).toContain("PKG-2026-0001");
    expect(configuredHtml).toContain("runtime v1");

    const previewed = await fixture.app.request("/desk/admin/naming/preview", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ doctype: "Package", data: "{}", count: "2" })
    });
    expect(previewed.status).toBe(200);
    const previewHtml = await previewed.text();
    expect(previewHtml).toContain("PKG-2026-0001");
    expect(previewHtml).toContain("PKG-2026-0002");

    const adjusted = await fixture.app.request("/desk/admin/naming/counter", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        doctype: "Package",
        data: "{}",
        current: "20",
        expectedVersion: "0"
      })
    });
    expect(adjusted.status).toBe(303);
    const after = await fixture.app.request("/desk/admin/naming?doctype=Package");
    expect(await after.text()).toContain("PKG-2026-0021");
  });

  it("hides naming administration from non-admin actors", async () => {
    const fixture = createFixture(user);
    const response = await fixture.app.request("/desk/admin/naming?doctype=Package");
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("Naming Strategy");
  });
});

function createFixture(actor: Actor) {
  const registry = createRegistry({ doctypes: [Package] });
  const store = new InMemoryDocumentStore();
  const naming = new NamingService({
    registry,
    events: store,
    store,
    clock: fixedClock("2026-08-06T00:00:00.000Z")
  });
  const queries = new QueryService({
    registry,
    projections: store,
    doctypeResolver: (base, context) => naming.effectiveDocType(base.name, context.tenantId)
  });
  return {
    app: createDeskApp({
      registry,
      documents: new DocumentService({ registry, store }),
      queries,
      naming,
      actor: async () => actor
    })
  };
}
