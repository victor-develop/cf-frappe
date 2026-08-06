import {
  CustomFieldService,
  InMemoryDocumentStore,
  NamingService,
  createRegistry,
  defineDocType,
  fixedClock,
  type DomainEvent
} from "../../src";
import type { EventAppendBatchEntry } from "../../src/ports/event-store.js";
import { appendMetadataMutation } from "../../src/application/metadata-revision.js";
import { now } from "../helpers.js";

const admin = {
  id: "admin@example.com",
  roles: ["System Manager"],
  tenantId: "acme"
};

describe("metadata revision serialization", () => {
  it("fails closed when an atomic metadata store omits the source event", async () => {
    const sourceEvent = {
      id: "source",
      tenantId: "acme",
      stream: "acme:source",
      type: "SourceCreated",
      doctype: "Source",
      documentName: "one",
      actorId: admin.id,
      occurredAt: now,
      payload: { kind: "DocumentCreated" as const, data: {}, docstatus: "draft" as const },
      metadata: {}
    };
    const events = {
      append: async () => [],
      appendBatch: async () => [],
      readStream: async () => [],
      currentVersion: async () => 0
    };
    await expect(appendMetadataMutation(events, {
      tenantId: "acme",
      doctype: "Source",
      sourceStream: sourceEvent.stream,
      sourceExpectedVersion: 0,
      sourceEvent,
      metadataRevision: 0
    })).rejects.toMatchObject({ code: "DOCUMENT_INVALID" });
  });

  it("allows only one of two concurrently incompatible cross-stream metadata writes", async () => {
    const Receipt = defineDocType({
      name: "Racing Receipt",
      fields: [{ name: "amount", type: "number" }]
    });
    const registry = createRegistry({ doctypes: [Receipt] });
    const store = new MetadataBarrierStore();
    const customFields = new CustomFieldService({ registry, events: store, clock: fixedClock(now) });
    await customFields.saveField({
      actor: admin,
      doctype: "Racing Receipt",
      field: { name: "receipt_number", type: "text", readOnly: true, noCopy: true }
    });
    const naming = new NamingService({
      registry,
      events: store,
      store,
      clock: fixedClock(now),
      preNamingDocTypeResolver: (base, context) => customFields.effectiveDocType(base.name, context.tenantId)
    });

    store.blockNextMetadataPair();
    const outcomes = await Promise.allSettled([
      naming.save({
        actor: admin,
        doctype: "Racing Receipt",
        strategy: { kind: "series", pattern: "RACE-{sequence:4}", targetField: "receipt_number" }
      }),
      customFields.disableField({
        actor: admin,
        doctype: "Racing Receipt",
        fieldName: "receipt_number",
        expectedVersion: 1
      })
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
      reason: { code: "DOCUMENT_CONFLICT" }
    });
    await expect(naming.effectiveDocType("Racing Receipt", "acme")).resolves.toMatchObject({
      name: "Racing Receipt"
    });
  });
});

class MetadataBarrierStore extends InMemoryDocumentStore {
  private blocked = false;
  private arrivals = 0;
  private release: (() => void) | undefined;
  private gate: Promise<void> = Promise.resolve();

  blockNextMetadataPair(): void {
    this.blocked = true;
    this.arrivals = 0;
    this.gate = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  override async appendBatch(entries: readonly EventAppendBatchEntry[]): Promise<readonly DomainEvent[]> {
    if (this.blocked) {
      this.arrivals += 1;
      if (this.arrivals === 2) {
        this.blocked = false;
        this.release?.();
      }
      await this.gate;
    }
    return super.appendBatch(entries);
  }
}
