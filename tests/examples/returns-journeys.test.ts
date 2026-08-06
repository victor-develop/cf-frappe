import {
  AutomationRunConsumer,
  AutomationRunService,
  DocumentService,
  InMemoryDocumentStore,
  fixedClock,
  type Actor,
  type IdGenerator
} from "../../src";
import {
  FINANCE_APPROVER_ROLE,
  RETURNS_AGENT_ROLE,
  RETURNS_MANAGER_ROLE,
  WAREHOUSE_INSPECTOR_ROLE,
  returnsRegistry
} from "../../examples/returns/models";

const tenantId = "default";
const now = "2026-08-05T00:00:00.000Z";

const agent: Actor = { id: "returns.agent@demo.local", roles: [RETURNS_AGENT_ROLE, "User"], tenantId };
const warehouse: Actor = { id: "warehouse.inspector@demo.local", roles: [WAREHOUSE_INSPECTOR_ROLE, "User"], tenantId };
const finance: Actor = { id: "finance.approver@demo.local", roles: [FINANCE_APPROVER_ROLE, "User"], tenantId };
const manager: Actor = {
  id: "returns.manager@demo.local",
  roles: [RETURNS_MANAGER_ROLE, RETURNS_AGENT_ROLE, WAREHOUSE_INSPECTOR_ROLE, FINANCE_APPROVER_ROLE, "User"],
  tenantId
};

describe("ReturnsOS journeys", () => {
  it("enforces cross-workflow guards and completes a refund atomically", async () => {
    const { documents } = createReturnsServices();
    await createMasterData(documents, "CUST-JOURNEY", "ORD-JOURNEY");
    let document = await documents.create({
      actor: agent,
      doctype: "Return Request",
      data: {
        customer: "CUST-JOURNEY",
        order: "ORD-JOURNEY",
        reason: "Damaged",
        details: "Critical journey fixture",
        requested_amount: 280,
        risk_score: 3
      }
    });

    document = await documents.execute({
      actor: agent,
      doctype: document.doctype,
      name: document.name,
      command: "acceptReturn",
      input: {},
      expectedVersion: document.version
    });
    expect(document.data).toMatchObject({ case_state: "Submitted", logistics_state: "Awaiting Shipment" });

    await expect(documents.transition({
      actor: warehouse,
      doctype: document.doctype,
      name: document.name,
      workflow: "inspection",
      action: "pass",
      expectedVersion: document.version
    })).rejects.toThrow("condition");

    document = await documents.update({
      actor: agent,
      doctype: document.doctype,
      name: document.name,
      patch: { tracking_number: "TRACK-JOURNEY" },
      expectedVersion: document.version
    });
    document = await documents.transition({ actor: agent, doctype: document.doctype, name: document.name, workflow: "logistics", action: "markInTransit", expectedVersion: document.version });
    document = await documents.transition({ actor: agent, doctype: document.doctype, name: document.name, workflow: "case", action: "startProcessing", expectedVersion: document.version });
    document = await documents.update({
      actor: warehouse,
      doctype: document.doctype,
      name: document.name,
      patch: { received_at: "2026-08-05T08:00:00.000Z", inspection_notes: "Item received" },
      expectedVersion: document.version
    });
    document = await documents.transition({ actor: warehouse, doctype: document.doctype, name: document.name, workflow: "logistics", action: "receive", expectedVersion: document.version });
    document = await documents.transition({ actor: warehouse, doctype: document.doctype, name: document.name, workflow: "inspection", action: "pass", expectedVersion: document.version });
    document = await documents.transition({ actor: agent, doctype: document.doctype, name: document.name, workflow: "refund", action: "requestApproval", expectedVersion: document.version });

    await expect(documents.transition({
      actor: finance,
      doctype: document.doctype,
      name: document.name,
      workflow: "refund",
      action: "approve",
      expectedVersion: document.version
    })).rejects.toThrow("condition");

    document = await documents.update({
      actor: finance,
      doctype: document.doctype,
      name: document.name,
      patch: { approved_amount: 280, scheduled_refund_at: "2026-08-06T03:00:00.000Z" },
      expectedVersion: document.version
    });
    document = await documents.transition({ actor: finance, doctype: document.doctype, name: document.name, workflow: "refund", action: "approve", expectedVersion: document.version });
    document = await documents.transition({ actor: finance, doctype: document.doctype, name: document.name, workflow: "refund", action: "beginProcessing", expectedVersion: document.version });

    await expect(documents.execute({
      actor: finance,
      doctype: document.doctype,
      name: document.name,
      command: "completeRefundAndResolve",
      input: {},
      expectedVersion: document.version
    })).rejects.toThrow("Refund reference is required");

    document = await documents.update({
      actor: finance,
      doctype: document.doctype,
      name: document.name,
      patch: { refund_reference: "REF-JOURNEY" },
      expectedVersion: document.version
    });
    document = await documents.execute({
      actor: finance,
      doctype: document.doctype,
      name: document.name,
      command: "completeRefundAndResolve",
      input: {},
      expectedVersion: document.version
    });

    expect(document.data).toMatchObject({ refund_state: "Refunded", case_state: "Resolved" });
    await expect(documents.update({
      actor: manager,
      doctype: document.doctype,
      name: document.name,
      patch: { case_state: "Closed" },
      expectedVersion: document.version
    })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "case_state", code: "workflow_state_protected" })]
    });
  });

  it("delivers high-risk and linked-document automation exactly once", async () => {
    const { documents, store } = createReturnsServices();
    await createMasterData(documents, "CUST-AUTO", "ORD-AUTO");
    const source = await documents.create({
      actor: agent,
      doctype: "Return Request",
      data: {
        customer: "CUST-AUTO",
        order: "ORD-AUTO",
        reason: "Other",
        details: "Risk automation fixture",
        requested_amount: 410,
        risk_score: 9
      }
    });
    const runs = new AutomationRunService({ store, projections: store, ids: sequentialIds() });
    const consumer = new AutomationRunConsumer({ runs, documents, events: store, projections: store, clock: fixedClock(now) });

    expect((await runs.list(tenantId)).map((run) => run.status)).toEqual(["pending", "pending"]);
    const firstDrain = await consumer.drain({ tenantId, claimId: "claim-auto", limit: 10 });
    expect(firstDrain).toMatchObject({ claimed: 2, delivered: 2, failed: 0, dead: 0 });

    const flagged = await store.get(tenantId, "Return Request", source.name);
    const linkedOrder = await store.get(tenantId, "Order", "ORD-AUTO");
    expect(flagged?.data.high_risk).toBe(true);
    expect(linkedOrder?.data).toMatchObject({
      has_open_return: true,
      latest_return: source.name,
      latest_return_state: "Draft",
      latest_refund_state: "Not Eligible"
    });
    const orderVersion = linkedOrder?.version;

    const retryDrain = await consumer.drain({ tenantId, claimId: "claim-retry", limit: 10 });
    expect(retryDrain).toMatchObject({ claimed: 0, delivered: 0, failed: 0, dead: 0 });
    expect((await store.get(tenantId, "Order", "ORD-AUTO"))?.version).toBe(orderVersion);
  });
});

function createReturnsServices() {
  const store = new InMemoryDocumentStore();
  const documents = new DocumentService({
    registry: returnsRegistry,
    store,
    clock: fixedClock(now),
    ids: sequentialIds()
  });
  return { documents, store };
}

async function createMasterData(documents: DocumentService, customerId: string, orderId: string): Promise<void> {
  await documents.create({
    actor: manager,
    doctype: "Customer",
    data: { customer_id: customerId, display_name: "Demo Customer", email: `${customerId.toLowerCase()}@example.test`, segment: "Plus" }
  });
  await documents.create({
    actor: manager,
    doctype: "Order",
    data: { order_id: orderId, customer: customerId, item_summary: "Demo item", order_total: 500, order_status: "Fulfilled" }
  });
}

function sequentialIds(): IdGenerator {
  let value = 0;
  return { next: (prefix = "") => `${prefix}${String(++value).padStart(6, "0")}` };
}
