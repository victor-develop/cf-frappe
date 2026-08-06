import {
  DocumentHistoryService,
  DocumentService,
  InMemoryDocumentStore,
  QueryService,
  createResourceApi,
  fixedClock,
  unsafeHeaderActorResolver,
  type Actor,
  type IdGenerator
} from "../../src";
import { handleReturnsOperationsRequest } from "../../examples/returns/operations-app";
import { returnsRegistry } from "../../examples/returns/models";
import { seedReturnsDemo, type ReturnsDemoTransport } from "../../examples/returns/seed";
import { demoPersonas } from "../../examples/returns/worker";

describe("ReturnsOS standalone operations app", () => {
  it("renders a branded command center and case page outside the generic Desk shell", async () => {
    const harness = await makeHarness();
    const options = harness.optionsFor("returns-agent");

    const home = await handleReturnsOperationsRequest(new Request("http://localhost/returns"), options);
    expect(home.status).toBe(200);
    const homeBody = await home.text();
    expect(homeBody).toContain("Return command center");
    expect(homeBody).toContain("Lifecycle pulse");
    expect(homeBody).toContain("RMA-2026-000006");
    expect(homeBody).toContain("/returns/cases/RMA-2026-000001");
    expect(homeBody).not.toContain("cf-frappe Desk");
    expect(homeBody).toContain('action="/returns" method="get"');
    expect(homeBody).not.toContain('href="/demo/automation-runs"');

    const search = await handleReturnsOperationsRequest(
      new Request("http://localhost/returns?q=4K%20monitor"),
      options
    );
    const searchBody = await search.text();
    expect(searchBody).toContain("Cases matching");
    expect(searchBody).toContain("RMA-2026-000006");
    expect(searchBody).not.toContain("/returns/cases/RMA-2026-000001");

    const adminHome = await handleReturnsOperationsRequest(
      new Request("http://localhost/returns"),
      harness.optionsFor("admin")
    );
    expect(await adminHome.text()).toContain('href="/demo/automation-runs"');

    const detail = await handleReturnsOperationsRequest(
      new Request("http://localhost/returns/cases/RMA-2026-000001"),
      options
    );
    expect(detail.status).toBe(200);
    const detailBody = await detail.text();
    expect(detailBody).toContain("Independent lifecycles");
    expect(detailBody).toContain("Accept return");
    expect(detailBody).toContain("Customer and order");
    expect(detailBody).toContain("Immutable activity");
  });

  it("executes agent, warehouse, and finance journeys through versioned domain commands", async () => {
    const harness = await makeHarness();

    const accepted = await submit(
      harness.optionsFor("returns-agent"),
      "/returns/cases/RMA-2026-000001/command/acceptReturn",
      { expected_version: "1" }
    );
    expect(accepted.status).toBe(303);
    await expect(harness.store.get("default", "Return Request", "RMA-2026-000001")).resolves.toMatchObject({
      version: 2,
      data: { case_state: "Submitted", logistics_state: "Awaiting Shipment" }
    });

    const dispatched = await submit(
      harness.optionsFor("returns-agent"),
      "/returns/cases/RMA-2026-000001/command/dispatchReturn",
      { expected_version: "2", tracking_number: "demo-track-new" }
    );
    expect(dispatched.status).toBe(303);
    await expect(harness.store.get("default", "Return Request", "RMA-2026-000001")).resolves.toMatchObject({
      version: 3,
      data: { logistics_state: "In Transit", tracking_number: "DEMO-TRACK-NEW" }
    });

    const inspectionBefore = await harness.store.get("default", "Return Request", "RMA-2026-000003");
    const inspected = await submit(
      harness.optionsFor("warehouse-inspector"),
      "/returns/cases/RMA-2026-000003/command/inspectReturn",
      {
        expected_version: String(inspectionBefore?.version),
        outcome: "Passed",
        inspection_notes: "Verified in the standalone operations app.",
        deduction_amount: "0"
      }
    );
    expect(inspected.status).toBe(303);
    await expect(harness.store.get("default", "Return Request", "RMA-2026-000003")).resolves.toMatchObject({
      data: { logistics_state: "Received", inspection_state: "Passed", deduction_amount: 0 }
    });

    const approvalBefore = await harness.store.get("default", "Return Request", "RMA-2026-000004");
    const approved = await submit(
      harness.optionsFor("finance-approver"),
      "/returns/cases/RMA-2026-000004/command/approveAndScheduleRefund",
      {
        expected_version: String(approvalBefore?.version),
        approved_amount: "139",
        scheduled_refund_at: "2026-08-06T11:00"
      }
    );
    expect(approved.status).toBe(303);
    await expect(harness.store.get("default", "Return Request", "RMA-2026-000004")).resolves.toMatchObject({
      data: {
        approved_amount: 139,
        refund_state: "Processing",
        scheduled_refund_at: "2026-08-06T11:00:00.000Z"
      }
    });

    const refundBefore = await harness.store.get("default", "Return Request", "RMA-2026-000005");
    const refunded = await submit(
      harness.optionsFor("finance-approver"),
      "/returns/cases/RMA-2026-000005/command/completeRefundAndResolve",
      {
        expected_version: String(refundBefore?.version),
        refund_reference: "standalone-refund-1005"
      }
    );
    expect(refunded.status).toBe(303);
    await expect(harness.store.get("default", "Return Request", "RMA-2026-000005")).resolves.toMatchObject({
      data: {
        case_state: "Resolved",
        refund_state: "Refunded",
        refund_reference: "STANDALONE-REFUND-1005"
      }
    });
  });

  it("keeps authorization in the framework command boundary", async () => {
    const harness = await makeHarness();
    const response = await submit(
      harness.optionsFor("finance-approver"),
      "/returns/cases/RMA-2026-000001/command/acceptReturn",
      { expected_version: "1" }
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("cannot execute acceptReturn");
    await expect(harness.store.get("default", "Return Request", "RMA-2026-000001")).resolves.toMatchObject({
      version: 1,
      data: { case_state: "Draft", logistics_state: "Not Started" }
    });
  });

  it("schedules a refund that was already approved in an earlier session", async () => {
    const harness = await makeHarness();
    const finance = harness.optionsFor("finance-approver");
    const before = await harness.store.get("default", "Return Request", "RMA-2026-000004");
    const updated = await finance.transport.request("/api/resource/Return%20Request/RMA-2026-000004", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved_amount: 139, expectedVersion: before?.version })
    });
    expect(updated.status).toBe(200);
    const updatedBody = await updated.json() as { readonly data: { readonly version: number } };
    const approved = await finance.transport.request(
      "/api/resource/Return%20Request/RMA-2026-000004/workflows/refund/transition/approve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: updatedBody.data.version })
      }
    );
    expect(approved.status).toBe(200);
    const approvedBody = await approved.json() as { readonly data: { readonly version: number } };

    const scheduled = await submit(
      finance,
      "/returns/cases/RMA-2026-000004/command/approveAndScheduleRefund",
      {
        expected_version: String(approvedBody.data.version),
        approved_amount: "139",
        scheduled_refund_at: "2026-08-06T12:00"
      }
    );

    expect(scheduled.status).toBe(303);
    await expect(harness.store.get("default", "Return Request", "RMA-2026-000004")).resolves.toMatchObject({
      data: { refund_state: "Processing", approved_amount: 139 }
    });
  });

  it("rejects unsupported actions and malformed form input before dispatch", async () => {
    const harness = await makeHarness();
    const warehouse = harness.optionsFor("warehouse-inspector");

    const unknown = await submit(
      warehouse,
      "/returns/cases/RMA-2026-000003/command/dropEverything",
      { expected_version: "1" }
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("Unknown ReturnsOS command");

    const invalidOutcome = await submit(
      warehouse,
      "/returns/cases/RMA-2026-000003/command/inspectReturn",
      { expected_version: "4", outcome: "Maybe", inspection_notes: "No", deduction_amount: "0" }
    );
    expect(invalidOutcome.status).toBe(400);
    expect(await invalidOutcome.text()).toContain("outcome is invalid");

    const unsafeName = await handleReturnsOperationsRequest(
      formRequest("/returns/cases/RMA%5C1003/command/inspectReturn", {
        expected_version: "4",
        outcome: "Passed",
        deduction_amount: "0"
      }),
      warehouse
    );
    expect(unsafeName.status).toBe(400);
    expect(await unsafeName.text()).toContain("Return name is invalid");

    const invalidSearch = await handleReturnsOperationsRequest(
      new Request("http://localhost/returns?q=%00"),
      warehouse
    );
    expect(invalidSearch.status).toBe(400);
    expect(await invalidSearch.text()).toContain("Search query is invalid");

    const finance = harness.optionsFor("finance-approver");
    const invalidDate = await submit(
      finance,
      "/returns/cases/RMA-2026-000004/command/approveAndScheduleRefund",
      {
        expected_version: "2",
        approved_amount: "139",
        scheduled_refund_at: "2026-02-30T12:00"
      }
    );
    expect(invalidDate.status).toBe(400);
    expect(await invalidDate.text()).toContain("scheduled_refund_at must be a valid date and time");

    const returnsAgent = harness.optionsFor("returns-agent");
    const beforeOversizedCommand = await harness.store.get("default", "Return Request", "RMA-2026-000001");
    const oversizedBody = new URLSearchParams({
      expected_version: String(beforeOversizedCommand?.version),
      padding: "x".repeat(9_000)
    });
    const oversizedRequest = new Request("http://localhost/returns/cases/RMA-2026-000001/command/acceptReturn", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: oversizedBody
    });
    expect(oversizedRequest.headers.get("content-length")).toBeNull();

    const oversized = await handleReturnsOperationsRequest(oversizedRequest, returnsAgent);
    expect(oversized.status).toBe(413);
    expect(await oversized.text()).toContain("action form is too large");
    await expect(harness.store.get("default", "Return Request", "RMA-2026-000001")).resolves.toEqual(beforeOversizedCommand);
  });
});

async function makeHarness() {
  const store = new InMemoryDocumentStore();
  const documents = new DocumentService({
    registry: returnsRegistry,
    store,
    clock: fixedClock("2026-08-05T12:00:00.000Z"),
    ids: sequentialIds()
  });
  const queries = new QueryService({ registry: returnsRegistry, projections: store });
  const app = createResourceApi({
    registry: returnsRegistry,
    documents,
    queries,
    timeline: new DocumentHistoryService({ events: store, queries }),
    actor: unsafeHeaderActorResolver
  });
  const transportFor = (actor: Actor): ReturnsDemoTransport => ({
    async request(path, init = {}) {
      const headers = new Headers(init.headers);
      headers.set("x-cf-frappe-user", actor.id);
      headers.set("x-cf-frappe-roles", actor.roles.join(","));
      headers.set("x-cf-frappe-tenant", actor.tenantId ?? "default");
      return await app.request(path, { ...init, headers });
    }
  });

  await seedReturnsDemo(transportFor(demoPersonas.admin.actor));

  return {
    store,
    optionsFor(slug: keyof typeof demoPersonas) {
      const persona = demoPersonas[slug];
      return {
        persona,
        personas: Object.values(demoPersonas),
        transport: transportFor(persona.actor)
      };
    }
  };
}

async function submit(
  options: ReturnType<Awaited<ReturnType<typeof makeHarness>>["optionsFor"]>,
  path: string,
  data: Readonly<Record<string, string>>
): Promise<Response> {
  return await handleReturnsOperationsRequest(formRequest(path, data), options);
}

function formRequest(path: string, data: Readonly<Record<string, string>>): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data)
  });
}

function sequentialIds(): IdGenerator {
  let value = 0;
  return {
    next(prefix = "") {
      value += 1;
      return `${prefix}${String(value).padStart(8, "0")}`;
    }
  };
}
