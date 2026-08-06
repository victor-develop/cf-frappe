import {
  DocumentService,
  InMemoryDocumentStore,
  NamingService,
  QueryService,
  createRegistry,
  createResourceApi,
  defineDocType,
  fixedClock,
  type Actor
} from "../../src";

const tenantId = "acme";
const admin: Actor = { id: "admin@example.test", roles: ["System Manager"], tenantId };
const user: Actor = { id: "user@example.test", roles: ["User"], tenantId };

const Shipment = defineDocType({
  name: "Shipment",
  fields: [
    { name: "shipment_number", type: "text", required: true, readOnly: true, noCopy: true },
    { name: "region", type: "text" }
  ]
});

describe("naming API", () => {
  it("manages strategies, previews ranges, advances counters, and clears overrides", async () => {
    const fixture = createFixture(admin);
    const saved = await fixture.app.request("/api/naming/Shipment?tenant=acme", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: 0,
        strategy: {
          kind: "series",
          pattern: "SHP-{field:region}-{YYYY}-{sequence:4}",
          targetField: "shipment_number",
          counter: "shipments",
          padding: 4,
          start: 1,
          step: 1,
          reset: "year",
          scopeFields: ["region"],
          exclusions: [
            { type: "exact", value: "never" },
            { type: "prefix", value: "never" },
            { type: "suffix", value: "0002" },
            { type: "contains", value: "never" },
            { type: "range", from: 90, to: 99 },
            { type: "regex", pattern: "^NEVER$", flags: "i" }
          ],
          maxAttempts: 10_000
        }
      })
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      data: { version: 1, source: "runtime" }
    });

    const preview = await fixture.app.request("/api/naming/Shipment/preview?tenant=acme", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { region: "HK" }, count: 3 })
    });
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({
      data: {
        counter: "shipments",
        scope: "date=2026|region=HK",
        candidates: [
          { value: 1, name: "SHP-HK-2026-0001" },
          { value: 3, name: "SHP-HK-2026-0003" },
          { value: 4, name: "SHP-HK-2026-0004" }
        ]
      }
    });

    const adjusted = await fixture.app.request("/api/naming/Shipment/counter?tenant=acme", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { region: "HK" }, current: 50, expectedVersion: 0 })
    });
    expect(adjusted.status).toBe(200);
    const adjustedBody = await adjusted.json() as { data: { current: number; counterVersion: number; candidates: unknown[] } };
    expect(adjustedBody.data).toMatchObject({ current: 50, counterVersion: 1 });
    expect(adjustedBody.data.candidates[0]).toEqual({ value: 51, name: "SHP-HK-2026-0051" });

    expect((await fixture.app.request("/api/naming/Shipment")).status).toBe(200);
    const cleared = await fixture.app.request("/api/naming/Shipment?tenant=acme", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1 })
    });
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toMatchObject({ data: { version: 2, source: "default" } });
  });

  it("rejects malformed strategies and non-admin callers", async () => {
    const adminFixture = createFixture(admin);
    const malformed = await adminFixture.app.request("/api/naming/Shipment", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        strategy: {
          kind: "series",
          pattern: "SHP-{sequence}",
          exclusions: [{ type: "regex", pattern: "(a+)+" }]
        }
      })
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ error: { code: "NAMING_INVALID" } });

    const userFixture = createFixture(user);
    const denied = await userFixture.app.request("/api/naming/Shipment");
    expect(denied.status).toBe(403);
  });

  it("validates preview and counter request shapes at the HTTP boundary", async () => {
    const fixture = createFixture(admin);
    for (const [path, body] of [
      ["/api/naming/Shipment/preview", { count: 1.5 }],
      ["/api/naming/Shipment/counter", { current: "10" }]
    ] as const) {
      const response = await fixture.app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });
    }
  });

  it.each([
    ["uuid", { kind: "uuid" }],
    ["field", { kind: "field", field: "region" }],
    ["provided", { kind: "provided" }],
    ["provided field", { kind: "provided", field: "shipment_number" }]
  ])("accepts the %s strategy shape", async (_label, strategy) => {
    const fixture = createFixture(admin);
    const response = await fixture.app.request("/api/naming/Shipment", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ strategy })
    });
    expect(response.status).toBe(200);
  });

  it.each([
    ["missing strategy", {}],
    ["invalid strategy kind", { strategy: { kind: "unknown" } }],
    ["missing field strategy field", { strategy: { kind: "field" } }],
    ["missing series pattern", { strategy: { kind: "series" } }],
    ["invalid target field", { strategy: { kind: "series", pattern: "S-{sequence}", targetField: 1 } }],
    ["invalid padding", { strategy: { kind: "series", pattern: "S-{sequence}", padding: 1.5 } }],
    ["invalid reset", { strategy: { kind: "series", pattern: "S-{sequence}", reset: "week" } }],
    ["invalid scope fields", { strategy: { kind: "series", pattern: "S-{sequence}", scopeFields: "region" } }],
    ["invalid exclusions", { strategy: { kind: "series", pattern: "S-{sequence}", exclusions: {} } }],
    ["invalid exclusion entry", { strategy: { kind: "series", pattern: "S-{sequence}", exclusions: [null] } }],
    ["invalid exclusion range", {
      strategy: { kind: "series", pattern: "S-{sequence}", exclusions: [{ type: "range", from: "1", to: 2 }] }
    }],
    ["invalid regex flags", {
      strategy: { kind: "series", pattern: "S-{sequence}", exclusions: [{ type: "regex", pattern: "S", flags: "g" }] }
    }],
    ["missing exclusion value", {
      strategy: { kind: "series", pattern: "S-{sequence}", exclusions: [{ type: "exact" }] }
    }],
    ["invalid exclusion type", {
      strategy: { kind: "series", pattern: "S-{sequence}", exclusions: [{ type: "glob", value: "S*" }] }
    }]
  ])("rejects %s", async (_label, body) => {
    const fixture = createFixture(admin);
    const response = await fixture.app.request("/api/naming/Shipment", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(Object) });
  });

  it("supports empty preview, counter, and clear bodies without consuming a preview", async () => {
    const fixture = createFixture(admin);
    const saved = await fixture.app.request("/api/naming/Shipment?tenant=acme", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ strategy: { kind: "series", pattern: "SHP-{sequence:3}", counter: "shipments" } })
    });
    expect(saved.status).toBe(200);

    const preview = await fixture.app.request("/api/naming/Shipment/preview?tenant=acme", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({
      data: { counterVersion: 0, candidates: [{ value: 1, name: "SHP-001" }] }
    });

    const adjusted = await fixture.app.request("/api/naming/Shipment/counter?tenant=acme", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current: 0 })
    });
    expect(adjusted.status).toBe(200);
    await expect(adjusted.json()).resolves.toMatchObject({ data: { current: 0, counterVersion: 1 } });

    const unchanged = await fixture.app.request("/api/naming/Shipment/counter?tenant=acme", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current: 0 })
    });
    expect(unchanged.status).toBe(200);

    const cleared = await fixture.app.request("/api/naming/Shipment?tenant=acme", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(cleared.status).toBe(200);
  });

  it("rejects invalid preview data and enforces an explicit JSON size limit", async () => {
    const fixture = createFixture(admin, 96);
    const invalidData = await fixture.app.request("/api/naming/Shipment/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: [] })
    });
    expect(invalidData.status).toBe(400);

    const oversized = await fixture.app.request("/api/naming/Shipment", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ strategy: { kind: "series", pattern: `SHP-${"X".repeat(100)}-{sequence}` } })
    });
    expect(oversized.status).toBe(400);
  });
});

function createFixture(actor: Actor, maxJsonBytes?: number) {
  const store = new InMemoryDocumentStore();
  const registry = createRegistry({ doctypes: [Shipment] });
  const naming = new NamingService({
    registry,
    events: store,
    store,
    clock: fixedClock("2026-08-06T00:00:00.000Z")
  });
  const documents = new DocumentService({ registry, store });
  const queries = new QueryService({ registry, projections: store });
  return {
    app: createResourceApi({
      registry,
      documents,
      queries,
      naming,
      actor: async () => actor,
      ...(maxJsonBytes === undefined ? {} : { maxJsonBytes })
    })
  };
}
