import { SYSTEM_MANAGER_ROLE, type Actor } from "../../src";
import { FINANCE_APPROVER_ROLE, RETURNS_AGENT_ROLE, RETURNS_MANAGER_ROLE, WAREHOUSE_INSPECTOR_ROLE, returnsRegistry } from "../../examples/returns/models";
import type { GoldenFixture } from "./harness";

/**
 * The recorded command histories the golden suite replays (issue #64).
 *
 * Histories are written against the ReturnsOS example model because it is the
 * most realistic model in the repo: four named workflows, a domain command,
 * registry-carried automation rules, and series naming. A history that only
 * a unit-test doctype could express would not earn golden protection.
 *
 * Every step runs against the real D1 engine; nothing here is asserted
 * directly — the replay's transcript is compared against the checked-in
 * golden in replay.test.ts.
 */

const tenantId = "default";

const agent: Actor = { id: "returns.agent@demo.local", roles: [RETURNS_AGENT_ROLE, "User"], tenantId };
const warehouse: Actor = { id: "warehouse.inspector@demo.local", roles: [WAREHOUSE_INSPECTOR_ROLE, "User"], tenantId };
const finance: Actor = { id: "finance.approver@demo.local", roles: [FINANCE_APPROVER_ROLE, "User"], tenantId };
const manager: Actor = {
  id: "returns.manager@demo.local",
  roles: [RETURNS_MANAGER_ROLE, RETURNS_AGENT_ROLE, WAREHOUSE_INSPECTOR_ROLE, FINANCE_APPROVER_ROLE, "User"],
  tenantId
};
// The lifecycle authority: submitting, cancelling, and amending flip
// docstatus, and amending re-validates every field as created, which needs
// the system-manager grant the field permissions ask for.
const admin: Actor = {
  id: "admin@demo.local",
  roles: [SYSTEM_MANAGER_ROLE, RETURNS_MANAGER_ROLE, RETURNS_AGENT_ROLE, WAREHOUSE_INSPECTOR_ROLE, FINANCE_APPROVER_ROLE, "User"],
  tenantId
};

const actors = { agent, warehouse, finance, manager, admin };

function masterData(customerId: string, orderId: string) {
  return [
    {
      op: "create" as const,
      actor: "manager",
      doctype: "Customer",
      as: customerId,
      data: {
        customer_id: customerId,
        display_name: "Golden Customer",
        email: `${customerId.toLowerCase()}@example.test`,
        segment: "Plus"
      }
    },
    {
      op: "create" as const,
      actor: "manager",
      doctype: "Order",
      as: orderId,
      data: {
        order_id: orderId,
        customer: customerId,
        item_summary: "Golden item",
        order_total: 500,
        order_status: "Fulfilled"
      }
    }
  ];
}

export const fixtures: readonly GoldenFixture[] = [
  {
    name: "returns-refund-journey",
    description:
      "One return driven end to end: intake, accept, shipment, receipt, inspection, refund approval, and resolution, across all four named workflows, three actors on the return, and a manager providing the master data.",
    clockStart: "2026-08-05T00:00:00.000Z",
    registry: returnsRegistry,
    actors,
    steps: [
      ...masterData("CUST-GOLD", "ORD-GOLD"),
      { op: "create", actor: "agent", doctype: "Return Request", as: "return", data: {
        customer: "CUST-GOLD",
        order: "ORD-GOLD",
        reason: "Damaged",
        details: "Golden journey fixture",
        requested_amount: 280,
        risk_score: 3
      } },
      { op: "execute", actor: "agent", doctype: "Return Request", name: "return", command: "acceptReturn", input: {} },
      { op: "update", actor: "agent", doctype: "Return Request", name: "return", patch: { tracking_number: "TRACK-GOLD" } },
      { op: "transition", actor: "agent", doctype: "Return Request", name: "return", workflow: "logistics", action: "markInTransit" },
      { op: "transition", actor: "agent", doctype: "Return Request", name: "return", workflow: "case", action: "startProcessing" },
      { op: "comment", actor: "warehouse", doctype: "Return Request", name: "return", text: "Parcel arrived; scheduling inspection." },
      { op: "update", actor: "warehouse", doctype: "Return Request", name: "return", patch: { received_at: "2026-08-05T08:00:00.000Z", inspection_notes: "Item received" } },
      { op: "transition", actor: "warehouse", doctype: "Return Request", name: "return", workflow: "logistics", action: "receive" },
      { op: "transition", actor: "warehouse", doctype: "Return Request", name: "return", workflow: "inspection", action: "pass" },
      { op: "assign", actor: "agent", doctype: "Return Request", name: "return", assignee: "finance.approver@demo.local" },
      { op: "transition", actor: "agent", doctype: "Return Request", name: "return", workflow: "refund", action: "requestApproval" },
      { op: "update", actor: "finance", doctype: "Return Request", name: "return", patch: { approved_amount: 280, scheduled_refund_at: "2026-08-06T03:00:00.000Z" } },
      { op: "transition", actor: "finance", doctype: "Return Request", name: "return", workflow: "refund", action: "approve" },
      { op: "transition", actor: "finance", doctype: "Return Request", name: "return", workflow: "refund", action: "beginProcessing" },
      { op: "tag", actor: "finance", doctype: "Return Request", name: "return", tag: "refund-approved" },
      { op: "update", actor: "finance", doctype: "Return Request", name: "return", patch: { refund_reference: "REF-GOLD" } },
      { op: "execute", actor: "finance", doctype: "Return Request", name: "return", command: "completeRefundAndResolve", input: {} },
      { op: "drainAutomations", claimId: "claim-journey-final" }
    ]
  },
  {
    name: "returns-automation-exactly-once",
    description:
      "A high-risk intake plans automation from the registry rules; one drain delivers both runs, a second drain proves exactly-once by claiming nothing.",
    clockStart: "2026-08-05T00:00:00.000Z",
    registry: returnsRegistry,
    actors,
    steps: [
      ...masterData("CUST-AUTO-GOLD", "ORD-AUTO-GOLD"),
      { op: "create", actor: "agent", doctype: "Return Request", as: "return", data: {
        customer: "CUST-AUTO-GOLD",
        order: "ORD-AUTO-GOLD",
        reason: "Other",
        details: "Risk automation golden fixture",
        requested_amount: 410,
        risk_score: 9
      } },
      { op: "drainAutomations", claimId: "claim-gold-first" },
      { op: "drainAutomations", claimId: "claim-gold-retry" }
    ]
  },
  {
    name: "returns-cancel-amend-collab",
    description:
      "The collaborative surface around one return: comments, assignment, tags, follow, submission, cancellation, amendment back to draft, and resubmission.",
    clockStart: "2026-08-05T00:00:00.000Z",
    registry: returnsRegistry,
    actors,
    steps: [
      ...masterData("CUST-AMEND-GOLD", "ORD-AMEND-GOLD"),
      { op: "create", actor: "agent", doctype: "Return Request", as: "return", data: {
        customer: "CUST-AMEND-GOLD",
        order: "ORD-AMEND-GOLD",
        reason: "Changed Mind",
        details: "Amendment golden fixture",
        requested_amount: 120,
        risk_score: 1
      } },
      { op: "comment", actor: "manager", doctype: "Return Request", name: "return", text: "Customer confirmed the change of mind in writing." },
      { op: "assign", actor: "agent", doctype: "Return Request", name: "return", assignee: "returns.agent@demo.local" },
      { op: "tag", actor: "agent", doctype: "Return Request", name: "return", tag: "low-risk" },
      { op: "follow", actor: "warehouse", doctype: "Return Request", name: "return" },
      { op: "update", actor: "agent", doctype: "Return Request", name: "return", patch: { details: "Amended details before submission" } },
      { op: "submit", actor: "admin", doctype: "Return Request", name: "return" },
      { op: "drainAutomations", claimId: "claim-amend-mid" },
      { op: "create", actor: "manager", doctype: "Order", as: "replacement-order", data: {
        order_id: "ORD-AMEND-GOLD-2",
        customer: "CUST-AMEND-GOLD",
        item_summary: "Replacement item",
        order_total: 95,
        order_status: "Fulfilled"
      } },
      { op: "cancel", actor: "admin", doctype: "Return Request", name: "return" },
      // The cancelled return keeps its `order` unique link, so the amendment
      // points at the replacement order instead.
      { op: "amend", actor: "admin", doctype: "Return Request", name: "return", data: { order: "ORD-AMEND-GOLD-2", reason: "Wrong Item", requested_amount: 95 } },
      { op: "update", actor: "agent", doctype: "Return Request", name: "return", patch: { details: "Resubmitted after amendment" } },
      { op: "submit", actor: "admin", doctype: "Return Request", name: "return" },
      { op: "drainAutomations", claimId: "claim-amend-final" }
    ]
  }
];
