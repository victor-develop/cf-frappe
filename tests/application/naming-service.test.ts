import {
  DocumentService,
  InMemoryDocumentStore,
  NamingService,
  createRegistry,
  defineDocType,
  fixedClock,
  namingSeriesStream,
  type Actor
} from "../../src";

const tenantId = "acme";
const now = "2026-08-06T00:00:00.000Z";
const admin: Actor = { id: "admin@example.test", roles: ["System Manager"], tenantId };
const user: Actor = { id: "user@example.test", roles: ["User"], tenantId };

const Receipt = defineDocType({
  name: "Receipt",
  fields: [
    { name: "receipt_number", type: "text", required: true, readOnly: true, noCopy: true },
    { name: "region", type: "text", required: true },
    { name: "amount", type: "number", required: true }
  ],
  permissions: [{ roles: ["User", "System Manager"], actions: ["read", "create", "update"] }],
  commands: [{
    name: "spoofReceiptNumber",
    eventType: "ReceiptNumberSpoofed",
    allowReadOnlyFields: true,
    buildPatch: () => ({ receipt_number: "SPOOF" })
  }]
});

describe("NamingService", () => {
  it("saves, applies, and clears tenant naming strategies with optimistic versions", async () => {
    const fixture = createFixture();
    const initial = await fixture.naming.get(admin, "Receipt");
    expect(initial).toMatchObject({ version: 0, source: "default" });

    const saved = await fixture.naming.save({
      actor: admin,
      doctype: "Receipt",
      expectedVersion: 0,
      strategy: receiptStrategy("RCT-{YYYY}-{sequence:4}")
    });
    expect(saved).toMatchObject({
      version: 1,
      source: "runtime",
      runtimeStrategy: { kind: "series", counter: "receipts" }
    });
    await expect(fixture.naming.save({
      actor: admin,
      doctype: "Receipt",
      expectedVersion: 1,
      strategy: receiptStrategy("RCT-{YYYY}-{sequence:4}")
    })).resolves.toMatchObject({ version: 1, source: "runtime" });
    await expect(fixture.naming.save({
      actor: admin,
      doctype: "Receipt",
      expectedVersion: 0,
      strategy: receiptStrategy("OTHER-{sequence:4}")
    })).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
    await expect(fixture.naming.effectiveDocType("Receipt", tenantId)).resolves.toMatchObject({
      naming: { pattern: "RCT-{YYYY}-{sequence:4}" }
    });

    const cleared = await fixture.naming.clear({ actor: admin, doctype: "Receipt", expectedVersion: 1 });
    expect(cleared).toMatchObject({ version: 2, source: "default" });
    expect(cleared.runtimeStrategy).toBeUndefined();
  });

  it("authorizes tenant-local administrators only", async () => {
    const fixture = createFixture();
    await expect(fixture.naming.clear({ actor: admin, doctype: "Receipt" })).resolves.toMatchObject({ version: 0 });
    await expect(fixture.naming.get(user, "Receipt")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(fixture.naming.get(admin, "Receipt", "other")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(fixture.naming.get({ id: "global-admin", roles: ["System Manager"] }, "Receipt"))
      .resolves.toMatchObject({ tenantId: "default" });
    await expect(fixture.naming.preview({ actor: admin, doctype: "Receipt" }))
      .rejects.toMatchObject({ code: "NAMING_INVALID" });

    const resolved = new NamingService({
      registry: createRegistry({ doctypes: [Receipt] }),
      events: fixture.store,
      store: fixture.store,
      preNamingDocTypeResolver: async (base) => base
    });
    await expect(resolved.get(admin, "Receipt")).resolves.toMatchObject({ doctype: "Receipt" });
  });

  it("previews without consuming and advances counters forward only", async () => {
    const fixture = createFixture();
    await fixture.naming.save({
      actor: admin,
      doctype: "Receipt",
      strategy: receiptStrategy("RCT-{field:region}-{sequence:4}", ["region"])
    });

    const first = await fixture.naming.preview({ actor: admin, doctype: "Receipt", data: { region: "HK" }, count: 3 });
    const repeated = await fixture.naming.preview({ actor: admin, doctype: "Receipt", data: { region: "HK" }, count: 3 });
    expect(first).toEqual(repeated);
    expect(first).toMatchObject({
      counter: "receipts",
      scope: "region=HK",
      counterVersion: 0,
      candidates: [
        { value: 1, name: "RCT-HK-0001" },
        { value: 2, name: "RCT-HK-0002" },
        { value: 3, name: "RCT-HK-0003" }
      ]
    });

    const advanced = await fixture.naming.adjust({
      actor: admin,
      doctype: "Receipt",
      data: { region: "HK" },
      current: 40,
      expectedVersion: 0
    });
    expect(advanced).toMatchObject({ current: 40, counterVersion: 1 });
    expect(advanced.candidates[0]).toEqual({ value: 41, name: "RCT-HK-0041" });
    await expect(fixture.naming.adjust({
      actor: admin,
      doctype: "Receipt",
      data: { region: "HK" },
      current: 50,
      expectedVersion: 1
    })).resolves.toMatchObject({ current: 50, counterVersion: 2 });
    await expect(fixture.naming.adjust({
      actor: admin,
      doctype: "Receipt",
      data: { region: "HK" },
      current: 39,
      expectedVersion: 2
    })).rejects.toThrow("only move forward");
    await expect(fixture.naming.adjust({
      actor: admin,
      doctype: "Receipt",
      data: { region: "HK" },
      current: -1
    })).rejects.toMatchObject({ code: "NAMING_INVALID" });
  });

  it("keeps pattern changes on the same named counter and creates generated target fields atomically", async () => {
    const fixture = createFixture();
    await fixture.naming.save({ actor: admin, doctype: "Receipt", strategy: receiptStrategy("A-{sequence:3}", []) });
    const first = await fixture.documents.create({
      actor: user,
      doctype: "Receipt",
      data: { region: "HK", amount: 10 }
    });
    expect(first).toMatchObject({ name: "A-001", data: { receipt_number: "A-001" } });

    await fixture.naming.save({
      actor: admin,
      doctype: "Receipt",
      expectedVersion: 1,
      strategy: receiptStrategy("B-{sequence:3}", [])
    });
    const second = await fixture.documents.create({
      actor: user,
      doctype: "Receipt",
      data: { region: "US", amount: 20 }
    });
    expect(second).toMatchObject({ name: "B-002", data: { receipt_number: "B-002" } });
    await expect(fixture.store.readStream(namingSeriesStream(tenantId, "Receipt", "receipts"))).resolves.toHaveLength(2);
    await expect(fixture.store.get(tenantId, "__NamingSeries", "Receipt:receipts")).resolves.toMatchObject({
      data: { pattern: "B-{sequence:3}", counter: "receipts", current: 2 }
    });
  });

  it("allocates concurrent and bulk-style creates without duplicate identifiers", async () => {
    const fixture = createFixture();
    await fixture.naming.save({ actor: admin, doctype: "Receipt", strategy: receiptStrategy("RCT-{sequence:4}", []) });
    const concurrent = await Promise.all(Array.from({ length: 8 }, (_, index) => fixture.documents.create({
      actor: user,
      doctype: "Receipt",
      data: { region: index % 2 === 0 ? "HK" : "US", amount: index + 1 }
    })));
    const sequential = [];
    for (let index = 8; index < 20; index += 1) {
      sequential.push(await fixture.documents.create({
        actor: user,
        doctype: "Receipt",
        data: { region: index % 2 === 0 ? "HK" : "US", amount: index + 1 }
      }));
    }
    const created = [...concurrent, ...sequential];
    expect(new Set(created.map((document) => document.name)).size).toBe(20);
    expect(created.map((document) => document.name).sort()).toEqual(
      Array.from({ length: 20 }, (_, index) => `RCT-${String(index + 1).padStart(4, "0")}`)
    );
  });

  it("rejects caller supplied generated fields", async () => {
    const fixture = createFixture();
    await fixture.naming.save({ actor: admin, doctype: "Receipt", strategy: receiptStrategy("RCT-{sequence:4}", []) });
    await expect(fixture.documents.create({
      actor: user,
      doctype: "Receipt",
      data: { receipt_number: "SPOOF", region: "HK", amount: 10 }
    })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: expect.arrayContaining([expect.objectContaining({ field: "receipt_number", code: "generated_name" })])
    });
  });

  it("keeps generated target fields immutable across updates, unsets, merges, and domain commands", async () => {
    const fixture = createFixture();
    await fixture.naming.save({
      actor: admin,
      doctype: "Receipt",
      strategy: receiptStrategy("RCT-{sequence:4}")
    });
    const created = await fixture.documents.create({
      actor: user,
      doctype: "Receipt",
      data: { region: "HK", amount: 10 }
    });

    await expect(fixture.documents.update({
      actor: user,
      doctype: "Receipt",
      name: created.name,
      patch: { receipt_number: "SPOOF" }
    })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: expect.arrayContaining([expect.objectContaining({ field: "receipt_number", code: "generated_name" })])
    });
    await expect(fixture.documents.merge({
      actor: user,
      doctype: "Receipt",
      name: created.name,
      baseVersion: 1,
      patch: {},
      unset: ["receipt_number"]
    })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: expect.arrayContaining([expect.objectContaining({ field: "receipt_number", code: "generated_name" })])
    });
    await expect(fixture.documents.execute({
      actor: user,
      doctype: "Receipt",
      name: created.name,
      command: "spoofReceiptNumber",
      input: {}
    })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "receipt_number", code: "generated_name" })]
    });
    await expect(fixture.documents.duplicate({
      actor: user,
      doctype: "Receipt",
      name: created.name,
      data: { region: "US", amount: 20 },
      expectedVersion: 1
    })).resolves.toMatchObject({
      name: "RCT-0002",
      data: { receipt_number: "RCT-0002", region: "US", amount: 20 }
    });
  });
});

function createFixture() {
  const store = new InMemoryDocumentStore();
  const registry = createRegistry({ doctypes: [Receipt] });
  const naming = new NamingService({
    registry,
    events: store,
    store,
    clock: fixedClock(now)
  });
  const documents = new DocumentService({
    registry,
    store,
    clock: fixedClock(now),
    doctypeResolver: (base, context) => naming.effectiveDocType(base.name, context.tenantId)
  });
  return { naming, documents, store };
}

function receiptStrategy(
  pattern: string,
  scopeFields: readonly string[] = []
) {
  return {
    kind: "series" as const,
    pattern,
    targetField: "receipt_number",
    counter: "receipts",
    scopeFields
  };
}
