import {
  AutomationRunPlanner,
  AutomationRunService,
  DocumentService,
  InMemoryDocumentStore,
  createRegistry,
  defineDocType,
  deterministicIds,
  documentStream,
  fixedClock
} from "../../src";
import type { DocumentSnapshot, DomainEvent, ListDocumentsQuery } from "../../src";
import { owner, now } from "../helpers";

const later = "2026-01-01T00:01:00.000Z";

describe("AutomationRunService", () => {
  it("plans automation run entries and auxiliary snapshots from source events", async () => {
    const planner = new AutomationRunPlanner({
      ids: deterministicIds(["run-event-1"]),
      retry: { maxAttempts: 2, baseDelaySeconds: 5, maxDelaySeconds: 30 }
    });
    const plan = planner.planEnqueueFromDomainEvent({
      event: sourceEvent("evt_source", { status: "Done" }),
      snapshot: sourceSnapshot({ status: "Done", target: "Target One" }),
      rules: [mirrorRule()]
    });

    expect(plan.entries).toHaveLength(1);
    expect(plan.runIds).toEqual(["evt_source:Mirror Status:0"]);
    expect(plan.entries[0]).toMatchObject({
      stream: "acme:__AutomationRuns:evt_source%3AMirror%20Status%3A0",
      expectedVersion: 0
    });
    const saved = [{
      ...plan.entries[0]!.events[0]!,
      sequence: 1
    }] as readonly DomainEvent[];
    expect(plan.auxiliarySnapshots(saved)).toMatchObject([{
      doctype: "__AutomationRuns",
      name: "evt_source:Mirror Status:0",
      data: {
        status: "pending",
        retry: { maxAttempts: 2, baseDelaySeconds: 5, maxDelaySeconds: 30 }
      }
    }]);
  });

  it("returns an empty plan when there are no rules, no snapshot, or no matching actions", () => {
    const planner = new AutomationRunPlanner({ ids: deterministicIds([]) });

    expect(planner.planEnqueueFromDomainEvent({
      event: sourceEvent("evt_source", { status: "Done" }),
      snapshot: sourceSnapshot({ status: "Done" }),
      rules: undefined
    }).entries).toEqual([]);
    expect(planner.planEnqueueFromDomainEvent({
      event: sourceEvent("evt_source", { status: "Done" }),
      snapshot: null,
      rules: [mirrorRule()]
    }).entries).toEqual([]);
    expect(planner.planEnqueueFromDomainEvent({
      event: sourceEvent("evt_source", { title: "Only title" }),
      snapshot: sourceSnapshot({ status: "Open" }),
      rules: [mirrorRule()]
    }).entries).toEqual([]);
  });

  it("enqueues runs atomically with document commits through DocumentService", async () => {
    const { documents, store } = createAutomationServices([
      "target-create",
      "source-create",
      "source-update",
      "automation-enqueue"
    ]);
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

    await expect(store.get("acme", "__AutomationRuns", "evt_source-update:Mirror Status:0")).resolves.toMatchObject({
      doctype: "__AutomationRuns",
      name: "evt_source-update:Mirror Status:0",
      data: { status: "pending", sourceDoctype: "Source", sourceDocumentName: "Source One" }
    });
    await expect(store.readStream(documentStream("acme", "Source", "Source One"))).resolves.toHaveLength(2);
    await expect(store.readStream(documentStream("acme", "__AutomationRuns", "evt_source-update:Mirror Status:0"))).resolves.toHaveLength(1);
  });

  it("claims pending, failed-due, and expired-lease runs in deterministic order", async () => {
    const { documents, store } = createAutomationServices([
      "target-create",
      "source-create",
      "source-update",
      "automation-enqueue",
      "claim-1",
      "fail-1",
      "claim-2",
      "deliver-1"
    ]);
    const runs = new AutomationRunService({
      store,
      projections: store,
      ids: deterministicIds(["claim-event-1", "fail-event-1", "claim-event-2", "deliver-event-1"]),
      clock: fixedClock(now)
    });
    await enqueueOneRun(documents);

    const [claimed] = await runs.claimPending({ tenantId: "acme", claimId: "claim-1", now, leaseSeconds: 30 });
    expect(claimed).toMatchObject({
      id: "evt_source-update:Mirror Status:0",
      status: "claimed",
      claimId: "claim-1",
      attempts: 1,
      claimExpiresAt: "2026-01-01T00:00:30.000Z"
    });
    await expect(runs.claimPending({ tenantId: "acme", claimId: "too-early", now })).resolves.toEqual([]);

    await runs.markFailed({
      tenantId: "acme",
      runId: claimed!.id,
      claimId: "claim-1",
      error: "target conflict",
      retryAt: later
    });
    await expect(runs.claimPending({ tenantId: "acme", claimId: "retry-too-early", now })).resolves.toEqual([]);
    await expect(runs.claimPending({ tenantId: "acme", claimId: "claim-2", now: later })).resolves.toMatchObject([
      { id: claimed!.id, status: "claimed", claimId: "claim-2", attempts: 2 }
    ]);
    await expect(runs.markDelivered({
      tenantId: "acme",
      runId: claimed!.id,
      claimId: "claim-2"
    })).resolves.toMatchObject({ status: "delivered", attempts: 2 });
  });

  it("rejects stale claims and keeps terminal operations idempotent", async () => {
    const { documents, store } = createAutomationServices([
      "target-create",
      "source-create",
      "source-update",
      "automation-enqueue"
    ]);
    const runs = new AutomationRunService({
      store,
      projections: store,
      ids: deterministicIds(["claim-event-1", "deliver-event-1"]),
      clock: fixedClock(now)
    });
    await enqueueOneRun(documents);
    const [claimed] = await runs.claimPending({ tenantId: "acme", claimId: "claim-1", now });

    await expect(runs.markDelivered({
      tenantId: "acme",
      runId: claimed!.id,
      claimId: "stale"
    })).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });

    const delivered = await runs.markDelivered({
      tenantId: "acme",
      runId: claimed!.id,
      claimId: "claim-1"
    });
    await expect(runs.markDelivered({
      tenantId: "acme",
      runId: claimed!.id,
      claimId: "claim-1"
    })).resolves.toEqual(delivered);
  });

  it("handles empty stores, generated claim IDs, automatic retryAt, missing runs, and dead-letter idempotency", async () => {
    const { documents, store } = createAutomationServices([
      "target-create",
      "source-create",
      "source-update",
      "automation-enqueue"
    ]);
    const emptyRuns = new AutomationRunService({
      store: new InMemoryDocumentStore(),
      projections: new InMemoryDocumentStore(),
      ids: deterministicIds(["generated-claim"]),
      clock: fixedClock(now)
    });
    await expect(emptyRuns.get("acme", "missing")).resolves.toBeNull();
    await expect(emptyRuns.list("acme")).resolves.toEqual([]);
    await expect(emptyRuns.claimPending({ tenantId: "acme" })).resolves.toEqual([]);
    await expect(emptyRuns.markDelivered({
      tenantId: "acme",
      runId: "missing",
      claimId: "claim-1"
    })).rejects.toMatchObject({ code: "AUTOMATION_RUN_NOT_FOUND" });

    const runs = new AutomationRunService({
      store,
      projections: store,
      ids: deterministicIds(["generated-claim", "claim-event-1", "fail-event-1", "claim-event-2", "dead-event-1"]),
      clock: fixedClock(now)
    });
    await enqueueOneRun(documents);

    const [claimed] = await runs.claimPending({ tenantId: "acme", now });
    expect(claimed).toMatchObject({
      status: "claimed",
      claimId: "claim_generated-claim"
    });
    await expect(runs.markFailed({
      tenantId: "acme",
      runId: claimed!.id,
      claimId: "claim_generated-claim",
      error: "  retry me  "
    })).resolves.toMatchObject({
      status: "failed",
      error: "retry me",
      retryAt: "2026-01-01T00:00:30.000Z"
    });

    const [reclaimed] = await runs.claimPending({
      tenantId: "acme",
      claimId: "claim-2",
      now: "2026-01-01T00:00:30.000Z"
    });
    const dead = await runs.markDeadLettered({
      tenantId: "acme",
      runId: reclaimed!.id,
      claimId: "claim-2",
      error: "final"
    });
    await expect(runs.markDeadLettered({
      tenantId: "acme",
      runId: reclaimed!.id,
      claimId: "claim-2",
      error: "final"
    })).resolves.toEqual(dead);
  });

  it("skips stale claim candidates after reading the live run stream", async () => {
    const { documents, store } = createAutomationServices([
      "target-create",
      "source-create",
      "source-update",
      "automation-enqueue"
    ]);
    await enqueueOneRun(documents);
    const pendingSnapshot = await store.get("acme", "__AutomationRuns", "evt_source-update:Mirror Status:0");
    expect(pendingSnapshot).not.toBeNull();

    const liveRuns = new AutomationRunService({
      store,
      projections: store,
      ids: deterministicIds(["claim-event-1"]),
      clock: fixedClock(now)
    });
    await liveRuns.claimPending({ tenantId: "acme", claimId: "claim-live", now, leaseSeconds: 60 });

    const staleRuns = new AutomationRunService({
      store,
      projections: staleProjection(pendingSnapshot!),
      ids: deterministicIds([]),
      clock: fixedClock(now)
    });

    await expect(staleRuns.claimPending({ tenantId: "acme", claimId: "claim-stale", now })).resolves.toEqual([]);
  });
});

function staleProjection(snapshot: DocumentSnapshot) {
  return {
    async get() {
      return snapshot;
    },
    async save() {},
    async list(query: ListDocumentsQuery) {
      return {
        data: query.offset && query.offset > 0 ? [] : [snapshot],
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
        total: 1
      };
    }
  };
}

function createAutomationServices(ids: readonly string[]) {
  const registry = createRegistry({ doctypes: [targetDocType, sourceDocType] });
  const store = new InMemoryDocumentStore();
  const documents = new DocumentService({
    registry,
    store,
    clock: fixedClock(now),
    ids: deterministicIds(ids)
  });
  return { documents, store };
}

async function enqueueOneRun(documents: DocumentService): Promise<void> {
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
  automationRules: [mirrorRule()],
  permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
});

function mirrorRule() {
  return {
    name: "Mirror Status",
    events: ["DocumentUpdated"] as const,
    changedFields: ["status"],
    actions: [{
      kind: "updateDocument" as const,
      target: {
        doctype: "Target",
        name: { kind: "field" as const, field: "target" }
      },
      patch: {
        mirrored_status: { kind: "field" as const, field: "status" },
        source_name: { kind: "documentName" as const }
      }
    }]
  };
}

function sourceEvent(id: string, patch: Record<string, unknown>): DomainEvent {
  return {
    id,
    tenantId: "acme",
    stream: "acme:Source:Source%20One",
    sequence: 2,
    type: "SourceUpdated",
    doctype: "Source",
    documentName: "Source One",
    actorId: owner.id,
    occurredAt: now,
    payload: { kind: "DocumentUpdated", patch: patch as DomainEvent["metadata"] },
    metadata: {}
  } as DomainEvent;
}

function sourceSnapshot(data: Record<string, unknown>) {
  return {
    tenantId: "acme",
    doctype: "Source",
    name: "Source One",
    version: 2,
    docstatus: "draft" as const,
    data: data as DomainEvent["metadata"],
    createdAt: now,
    updatedAt: now
  };
}
