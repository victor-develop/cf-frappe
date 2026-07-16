import {
  AUTOMATION_RUN_DRAIN_JOB_NAME,
  AutomationRunConsumer,
  AutomationRunPlanner,
  AutomationRunService,
  DocumentService,
  InMemoryDocumentStore,
  automationPatchChangesDocument,
  automationRunDrainResultJson,
  createAutomationRunDrainJob,
  createRegistry,
  defineDocType,
  deterministicIds,
  documentStream,
  fixedClock
} from "../../src";
import type { DocumentData } from "../../src";
import type { AutomationRunRecord, DomainEvent, DocumentSnapshot } from "../../src";
import { now, owner } from "../helpers";

const retryAt = "2026-01-01T00:01:00.000Z";

describe("AutomationRunConsumer", () => {
  it("claims runs, updates target documents, and marks runs delivered", async () => {
    const { documents, store, runs, consumer } = createConsumerServices({
      documentIds: ["target-create", "source-create", "source-update", "automation-enqueue", "target-update"],
      runIds: ["claim-event-1", "deliver-event-1"]
    });
    await enqueueRun(documents);

    await expect(consumer.drain({ tenantId: "acme", claimId: "claim-1", now })).resolves.toMatchObject({
      tenantId: "acme",
      claimed: 1,
      delivered: 1,
      failed: 0,
      dead: 0,
      outcomes: [{ runId: "evt_source-update:Mirror Status:0", status: "delivered", attempts: 1 }]
    });
    await expect(store.get("acme", "Target", "Target One")).resolves.toMatchObject({
      version: 2,
      data: {
        title: "Target One",
        mirrored_status: "Done",
        source_name: "Source One"
      }
    });
    await expect(store.readStream(documentStream("acme", "Target", "Target One"))).resolves.toMatchObject([
      { payload: { kind: "DocumentCreated" } },
      { metadata: { automationActionId: "evt_source-update:Mirror Status:0" } }
    ]);
    await expect(runs.get("acme", "evt_source-update:Mirror Status:0")).resolves.toMatchObject({ status: "delivered" });
  });

  it("recognizes an already-applied action after a worker crash and does not duplicate updates", async () => {
    const { documents, store, runs, consumer } = createConsumerServices({
      documentIds: [
        "target-create",
        "source-create",
        "source-update",
        "automation-enqueue",
        "manual-target-update"
      ],
      runIds: ["claim-event-1", "claim-event-2", "deliver-event-1"]
    });
    await enqueueRun(documents);
    const [claimed] = await runs.claimPending({ tenantId: "acme", claimId: "claim-1", now, leaseSeconds: 1 });
    await documents.update({
      actor: { id: "__automation__", roles: ["System Manager"], tenantId: "acme" },
      tenantId: "acme",
      doctype: "Target",
      name: "Target One",
      patch: { mirrored_status: "Done", source_name: "Source One" },
      expectedVersion: 1,
      metadata: {
        automationActionId: claimed!.id,
        automationRunId: claimed!.id,
        automationRuleName: claimed!.ruleName,
        sourceEventId: claimed!.sourceEventId
      }
    });

    await expect(consumer.drain({
      tenantId: "acme",
      claimId: "claim-2",
      now: "2026-01-01T00:00:02.000Z"
    })).resolves.toMatchObject({
      claimed: 1,
      delivered: 1,
      failed: 0
    });
    await expect(store.readStream(documentStream("acme", "Target", "Target One"))).resolves.toHaveLength(2);
    await expect(runs.get("acme", claimed!.id)).resolves.toMatchObject({ status: "delivered", attempts: 2 });
  });

  it("marks failures retryable and then dead-letters after max attempts", async () => {
    const registry = createRegistry({ doctypes: [targetDocType, missingTargetSourceDocType] });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({
      registry,
      store,
      clock: fixedClock(now),
      ids: deterministicIds(["source-create", "source-update", "automation-enqueue"]),
      automationRuns: new AutomationRunPlanner({
        ids: deterministicIds(["automation-enqueue"]),
        retry: { maxAttempts: 2, baseDelaySeconds: 60, maxDelaySeconds: 60 }
      })
    });
    const runs = new AutomationRunService({
      store,
      projections: store,
      ids: deterministicIds(["claim-event-1", "fail-event-1", "claim-event-2", "dead-event-1"]),
      clock: fixedClock(now)
    });
    const consumer = new AutomationRunConsumer({ runs, documents, events: store, projections: store });
    await documents.create({
      actor: owner,
      doctype: "Missing Source",
      data: { title: "Source One", status: "Open" }
    });
    await documents.update({
      actor: owner,
      doctype: "Missing Source",
      name: "Source One",
      patch: { status: "Done" },
      expectedVersion: 1
    });

    await expect(consumer.drain({ tenantId: "acme", claimId: "claim-1", now })).resolves.toMatchObject({
      claimed: 1,
      delivered: 0,
      failed: 1,
      dead: 0,
      outcomes: [{
        runId: "evt_source-update:Mirror Missing:0",
        status: "failed",
        attempts: 1,
        retryAt
      }]
    });
    await expect(consumer.drain({ tenantId: "acme", claimId: "too-early", now: "2026-01-01T00:00:30.000Z" }))
      .resolves.toMatchObject({ claimed: 0 });
    await expect(consumer.drain({ tenantId: "acme", claimId: "claim-2", now: retryAt })).resolves.toMatchObject({
      claimed: 1,
      delivered: 0,
      failed: 0,
      dead: 1,
      outcomes: [{ runId: "evt_source-update:Mirror Missing:0", status: "dead", attempts: 2 }]
    });
  });

  it("treats no-op patches as delivered without writing a target update", async () => {
    const { documents, store, consumer } = createConsumerServices({
      documentIds: ["target-create", "source-create", "source-update", "automation-enqueue"],
      runIds: ["claim-event-1", "deliver-event-1"]
    });
    await documents.create({
      actor: owner,
      doctype: "Target",
      data: { title: "Target One", mirrored_status: "Done", source_name: "Source One" }
    });
    await documents.create({
      actor: owner,
      doctype: "Source",
      data: { title: "Source One", target: "Target One", status: "Open" }
    });
    await documents.update({
      actor: owner,
      doctype: "Source",
      name: "Source One",
      patch: { status: "Done" },
      expectedVersion: 1
    });

    await expect(consumer.drain({ tenantId: "acme", claimId: "claim-1", now })).resolves.toMatchObject({
      delivered: 1
    });
    await expect(store.readStream(documentStream("acme", "Target", "Target One"))).resolves.toHaveLength(1);
    expect(automationPatchChangesDocument((await store.get("acme", "Target", "Target One"))!, {
      mirrored_status: "Done",
      source_name: "Source One"
    })).toBe(false);
  });

  it("creates a drain job that delegates to the configured consumer", async () => {
    const job = createAutomationRunDrainJob();
    const calls: Array<{ readonly tenantId: string; readonly limit?: number; readonly claimId?: string; readonly leaseSeconds?: number }> = [];

    expect(job.name).toBe(AUTOMATION_RUN_DRAIN_JOB_NAME);
    await expect(job.handler({
      tenantId: "acme",
      payload: { limit: 5, claimId: "claim-job", leaseSeconds: 10 },
      resources: {
        automationRunConsumer: {
          async drain(command) {
            calls.push(command);
            return {
              tenantId: command.tenantId,
              claimed: 0,
              delivered: 0,
              failed: 0,
              dead: 0,
              outcomes: []
            };
          }
        }
      }
    })).resolves.toEqual({
      tenantId: "acme",
      claimed: 0,
      delivered: 0,
      failed: 0,
      dead: 0,
      outcomes: []
    });
    expect(calls).toEqual([{ tenantId: "acme", limit: 5, claimId: "claim-job", leaseSeconds: 10 }]);
  });

  it("uses default drain options and actor resolvers", async () => {
    const { documents, store, consumer } = createConsumerServices({
      documentIds: ["target-create", "source-create", "source-update", "automation-enqueue", "target-update"],
      runIds: ["auto-claim", "claim-event-1", "deliver-event-1"]
    }, {
      actor: (record) => ({ id: `automation:${record.id}`, roles: ["System Manager"], tenantId: record.tenantId })
    });
    await enqueueRun(documents);

    await expect(consumer.drain({ tenantId: "acme", leaseSeconds: 10 })).resolves.toMatchObject({
      claimed: 1,
      delivered: 1
    });
    await expect(store.readStream(documentStream("acme", "Target", "Target One"))).resolves.toMatchObject([
      {},
      { actorId: "automation:evt_source-update:Mirror Status:0" }
    ]);
  });

  it("rejects malformed claimed records before delivery", async () => {
    const consumer = new AutomationRunConsumer({
      runs: {
        async claimPending() {
          const { claimId: _claimId, ...record } = automationRecord();
          return [record as AutomationRunRecord];
        },
        async markDelivered() { throw new Error("should not deliver"); },
        async markFailed() { throw new Error("should not fail"); },
        async markDeadLettered() { throw new Error("should not dead-letter"); },
        shouldDeadLetter() { return false; }
      },
      documents: { async update() { throw new Error("should not update"); } },
      events: { async readStream() { return []; } },
      projections: { async get() { return null; }, async save() {}, async list() { return { data: [], limit: 50, offset: 0, total: 0 }; } }
    });

    await expect(consumer.drain({ tenantId: "acme" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("treats update failures as delivered when the action appears in the target stream", async () => {
    let reads = 0;
    const delivered: string[] = [];
    const consumer = new AutomationRunConsumer({
      runs: {
        async claimPending() { return [automationRecord()]; },
        async markDelivered(command) {
          delivered.push(command.runId);
          return { ...automationRecord(), status: "delivered", attempts: 1, deliveredAt: now, version: 3 };
        },
        async markFailed() { throw new Error("should not fail"); },
        async markDeadLettered() { throw new Error("should not dead-letter"); },
        shouldDeadLetter() { return false; }
      },
      documents: {
        async update() {
          throw new Error("conflict after side effect");
        }
      },
      events: {
        async readStream() {
          reads += 1;
          return reads === 1 ? [] : [targetUpdatedByAutomation()];
        }
      },
      projections: {
        async get() { return targetSnapshot(); },
        async save() {},
        async list() { return { data: [], limit: 50, offset: 0, total: 0 }; }
      }
    });

    await expect(consumer.drain({ tenantId: "acme", now })).resolves.toMatchObject({
      claimed: 1,
      delivered: 1,
      failed: 0
    });
    expect(delivered).toEqual(["run-1"]);
  });

  it("validates drain job payloads and default tenant handling", async () => {
    const job = createAutomationRunDrainJob({ name: "custom.drain" });

    await expect(job.handler({
      payload: {},
      resources: {
        automationRunConsumer: {
          async drain(command) {
            return { tenantId: command.tenantId, claimed: 0, delivered: 0, failed: 0, dead: 0, outcomes: [] };
          }
        }
      }
    })).resolves.toMatchObject({ tenantId: "default" });
    await expect(job.handler({ payload: { limit: "bad" } as DocumentData, resources: {} })).rejects.toMatchObject({
      code: "AUTOMATION_RUN_NOT_FOUND"
    });
    await expect(job.handler({
      payload: { limit: "bad" } as DocumentData,
      resources: { automationRunConsumer: { async drain() { throw new Error("should not drain"); } } }
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(job.handler({
      payload: { claimId: "" } as DocumentData,
      resources: { automationRunConsumer: { async drain() { throw new Error("should not drain"); } } }
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(job.handler({
      payload: { leaseSeconds: "bad" } as DocumentData,
      resources: { automationRunConsumer: { async drain() { throw new Error("should not drain"); } } }
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("detects nested JSON patch changes", async () => {
    const snapshot = {
      ...targetSnapshot(),
      data: {
        title: "Target One",
        nested: { count: 1, tags: ["a", "b"] },
        list: [1, { ok: true }]
      }
    };

    expect(automationPatchChangesDocument(snapshot, { nested: { tags: ["a", "b"], count: 1 } })).toBe(false);
    expect(automationPatchChangesDocument(snapshot, { nested: { count: 2, tags: ["a", "b"] } })).toBe(true);
    expect(automationPatchChangesDocument(snapshot, { list: [1, { ok: true }] })).toBe(false);
    expect(automationPatchChangesDocument(snapshot, { list: [1] })).toBe(true);
    expect(automationPatchChangesDocument(snapshot, { list: { 0: 1 } })).toBe(true);
    expect(automationPatchChangesDocument(snapshot, { list: [1, { ok: false }] })).toBe(true);
    expect(automationPatchChangesDocument(snapshot, { nested: { count: 1 } })).toBe(true);
    expect(automationPatchChangesDocument(snapshot, { missing: null })).toBe(true);
    expect(automationRunDrainResultJson({
      tenantId: "acme",
      claimed: 1,
      delivered: 0,
      failed: 1,
      dead: 0,
      outcomes: [{
        runId: "run-1",
        status: "failed",
        attempts: 1,
        error: "nope",
        retryAt
      }]
    })).toMatchObject({
      outcomes: [{ error: "nope", retryAt }]
    });
  });
});

function createConsumerServices(options: {
  readonly documentIds: readonly string[];
  readonly runIds: readonly string[];
}, overrides: {
  readonly actor?: ConstructorParameters<typeof AutomationRunConsumer>[0]["actor"];
} = {}) {
  const registry = createRegistry({ doctypes: [targetDocType, sourceDocType] });
  const store = new InMemoryDocumentStore();
  const documents = new DocumentService({
    registry,
    store,
    clock: fixedClock(now),
    ids: deterministicIds(options.documentIds)
  });
  const runs = new AutomationRunService({
    store,
    projections: store,
    ids: deterministicIds(options.runIds),
    clock: fixedClock(now)
  });
  const consumer = new AutomationRunConsumer({
    runs,
    documents,
    events: store,
    projections: store,
    ...(overrides.actor === undefined ? {} : { actor: overrides.actor })
  });
  return { documents, store, runs, consumer };
}

async function enqueueRun(documents: DocumentService): Promise<void> {
  await documents.create({
    actor: owner,
    doctype: "Target",
    data: { title: "Target One" }
  });
  await documents.create({
    actor: owner,
    doctype: "Source",
    data: { title: "Source One", target: "Target One", status: "Open" }
  });
  await documents.update({
    actor: owner,
    doctype: "Source",
    name: "Source One",
    patch: { status: "Done" },
    expectedVersion: 1
  });
}

const targetDocType = defineDocType({
  name: "Target",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "mirrored_status", type: "text" },
    { name: "source_name", type: "text" }
  ],
  permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
});

const sourceDocType = defineDocType({
  name: "Source",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "target", type: "link", linkTo: "Target" },
    { name: "status", type: "select", options: ["Open", "Done"] }
  ],
  automationRules: [{
    name: "Mirror Status",
    events: ["DocumentUpdated"],
    changedFields: ["status"],
    actions: [mirrorAction("Mirror Status")]
  }],
  permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
});

const missingTargetSourceDocType = defineDocType({
  name: "Missing Source",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "status", type: "select", options: ["Open", "Done"] }
  ],
  automationRules: [{
    name: "Mirror Missing",
    events: ["DocumentUpdated"],
    changedFields: ["status"],
    actions: [{
      kind: "updateDocument",
      target: { doctype: "Target", name: { kind: "literal", value: "Missing Target" } },
      patch: { mirrored_status: { kind: "field", field: "status" } }
    }]
  }],
  permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
});

function mirrorAction(_ruleName: string) {
  return {
    kind: "updateDocument" as const,
    target: {
      doctype: "Target",
      name: { kind: "field" as const, field: "target" }
    },
    patch: {
      mirrored_status: { kind: "field" as const, field: "status" },
      source_name: { kind: "documentName" as const }
    }
  };
}

function automationRecord(overrides: Partial<AutomationRunRecord> = {}): AutomationRunRecord {
  return {
    id: "run-1",
    tenantId: "acme",
    sourceEventId: "evt_source",
    sourceEventType: "SourceUpdated",
    sourcePayloadKind: "DocumentUpdated",
    sourceDoctype: "Source",
    sourceDocumentName: "Source One",
    sourceActorId: owner.id,
    ruleName: "Mirror",
    actionIndex: 0,
    action: {
      kind: "updateDocument",
      target: { doctype: "Target", name: "Target One" },
      patch: { mirrored_status: "Done" }
    },
    retry: { maxAttempts: 2, baseDelaySeconds: 60, maxDelaySeconds: 60 },
    status: "claimed",
    attempts: 1,
    enqueuedAt: now,
    claimedAt: now,
    claimId: "claim-1",
    claimExpiresAt: "2026-01-01T00:05:00.000Z",
    version: 2,
    ...overrides
  };
}

function targetSnapshot(): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Target",
    name: "Target One",
    version: 1,
    docstatus: "draft",
    data: { title: "Target One" },
    createdAt: now,
    updatedAt: now
  };
}

function targetUpdatedByAutomation(): DomainEvent {
  return {
    id: "evt_target",
    tenantId: "acme",
    stream: documentStream("acme", "Target", "Target One"),
    sequence: 2,
    type: "TargetUpdated",
    doctype: "Target",
    documentName: "Target One",
    actorId: "__automation__",
    occurredAt: now,
    payload: { kind: "DocumentUpdated", patch: { mirrored_status: "Done" } },
    metadata: { automationActionId: "run-1" }
  };
}
