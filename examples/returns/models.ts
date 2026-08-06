import {
  FrameworkError,
  SYSTEM_MANAGER_ROLE,
  createRegistryFromApps,
  defineApp,
  defineCalendar,
  defineDashboard,
  defineDocType,
  defineKanban,
  definePrintFormat,
  defineReport,
  defineWebForm,
  defineWorkspace,
  type FieldPermissionRule,
  type PermissionAction,
  type PermissionRule,
  type PredicateExpression
} from "../../src";

export const RETURNS_AGENT_ROLE = "Returns Agent";
export const WAREHOUSE_INSPECTOR_ROLE = "Warehouse Inspector";
export const FINANCE_APPROVER_ROLE = "Finance Approver";
export const RETURNS_MANAGER_ROLE = "Returns Manager";
export const PUBLIC_RETURN_INTAKE_ROLE = "Public Return Intake";

export const RETURNS_STAFF_ROLES = Object.freeze([
  RETURNS_AGENT_ROLE,
  WAREHOUSE_INSPECTOR_ROLE,
  FINANCE_APPROVER_ROLE,
  RETURNS_MANAGER_ROLE
]);

const allDocumentActions: readonly PermissionAction[] = [
  "read",
  "rendition",
  "create",
  "metadata",
  "update",
  "delete",
  "submit",
  "cancel",
  "transition",
  "comment",
  "assign",
  "activity",
  "tag",
  "follow",
  "share"
];

const staffRead: PermissionRule = {
  roles: RETURNS_STAFF_ROLES,
  actions: ["read", "metadata"]
};

const managerFullAccess: PermissionRule = {
  roles: [RETURNS_MANAGER_ROLE],
  actions: allDocumentActions
};

const staffFieldRead: FieldPermissionRule = {
  roles: RETURNS_STAFF_ROLES,
  actions: ["read"]
};

const createFor = (roles: readonly string[]): FieldPermissionRule => ({
  roles,
  actions: ["read", "create"]
});

const updateFor = (roles: readonly string[]): FieldPermissionRule => ({
  roles,
  actions: ["read", "create", "update"]
});

const afterField = (field: string) => ({ kind: "field", scope: "after", field } as const);
const beforeField = (field: string) => ({ kind: "field", scope: "before", field } as const);
const literal = (value: string | number | boolean | readonly string[]) => ({ kind: "literal", value } as const);
const compare = (
  left: ReturnType<typeof afterField> | ReturnType<typeof beforeField>,
  operator: "eq" | "ne" | "in" | "gt" | "gte" | "lt" | "is",
  right: ReturnType<typeof literal>
): PredicateExpression => ({ kind: "compare", left, operator, right });
const all = (...predicates: readonly PredicateExpression[]): PredicateExpression => ({
  kind: "group",
  match: "all",
  predicates
});

const logisticsReceived = compare(beforeField("logistics_state"), "eq", literal("Received"));
const inspectionAccepted = compare(
  beforeField("inspection_state"),
  "in",
  literal(["Passed", "Partial"])
);
const refundFinished = compare(
  beforeField("refund_state"),
  "in",
  literal(["Refunded", "Rejected"])
);

function requiredCommandString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new FrameworkError("BAD_REQUEST", `${label} is required`, { status: 400 });
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new FrameworkError("BAD_REQUEST", `${label} must contain between 1 and ${String(maxLength)} characters`, {
      status: 400
    });
  }
  return normalized;
}

function commandAmount(value: unknown, label: string, options: { readonly allowZero?: boolean } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new FrameworkError("BAD_REQUEST", `${label} must be a valid amount`, { status: 400 });
  }
  if (!options.allowZero && value === 0) {
    throw new FrameworkError("BAD_REQUEST", `${label} must be greater than zero`, { status: 400 });
  }
  return value;
}

function inspectionTransition(value: unknown): { readonly state: "Passed" | "Partial" | "Failed"; readonly action: "pass" | "markPartial" | "fail" } {
  if (value === "Passed") return { state: "Passed", action: "pass" };
  if (value === "Partial") return { state: "Partial", action: "markPartial" };
  if (value === "Failed") return { state: "Failed", action: "fail" };
  throw new FrameworkError("BAD_REQUEST", "Inspection outcome must be Passed, Partial, or Failed", { status: 400 });
}

export const Customer = defineDocType({
  name: "Customer",
  label: "Customer",
  module: "Returns",
  version: 1,
  naming: { kind: "field", field: "customer_id" },
  fields: [
    { name: "customer_id", label: "Customer ID", type: "text", required: true, unique: true },
    { name: "display_name", label: "Name", type: "text", required: true },
    { name: "email", label: "Email", type: "text", required: true },
    { name: "segment", label: "Segment", type: "select", options: ["Standard", "Plus", "VIP"], defaultValue: "Standard" },
    { name: "latest_return", label: "Latest Return", type: "link", linkTo: "Return Request" },
    { name: "latest_return_state", label: "Latest Return State", type: "text", defaultValue: "No Return" },
    { name: "last_refunded_amount", label: "Last Refunded Amount", type: "number", defaultValue: 0, min: 0 }
  ],
  formView: {
    sections: [
      { heading: "Customer", columns: 2, fields: ["customer_id", "display_name", "email", "segment"] },
      { heading: "Returns", columns: 2, fields: ["latest_return", "latest_return_state", "last_refunded_amount"] }
    ]
  },
  listView: {
    columns: ["customer_id", "display_name", "segment", "latest_return_state"],
    filterFields: ["customer_id", "display_name", "email", "segment", "latest_return_state"],
    orderBy: "customer_id",
    order: "asc",
    pageSize: 25
  },
  permissions: [
    { roles: [PUBLIC_RETURN_INTAKE_ROLE], actions: ["read", "metadata"] },
    staffRead,
    managerFullAccess
  ],
  indexes: [["email"], ["segment"]]
});

export const Order = defineDocType({
  name: "Order",
  label: "Order",
  module: "Returns",
  version: 1,
  naming: { kind: "field", field: "order_id" },
  fields: [
    { name: "order_id", label: "Order ID", type: "text", required: true, unique: true },
    { name: "customer", label: "Customer", type: "link", linkTo: "Customer", required: true },
    { name: "item_summary", label: "Items", type: "text", required: true },
    { name: "order_total", label: "Order Total", type: "number", required: true, min: 0 },
    { name: "order_status", label: "Order Status", type: "select", options: ["Fulfilled", "Partially Returned", "Returned"], defaultValue: "Fulfilled" },
    { name: "has_open_return", label: "Has Open Return", type: "boolean", defaultValue: false },
    { name: "latest_return", label: "Latest Return", type: "link", linkTo: "Return Request" },
    { name: "latest_return_state", label: "Latest Return State", type: "text", defaultValue: "No Return" },
    { name: "latest_refund_state", label: "Latest Refund State", type: "text", defaultValue: "Not Eligible" },
    { name: "returned_amount", label: "Returned Amount", type: "number", defaultValue: 0, min: 0 }
  ],
  formView: {
    sections: [
      { heading: "Order", columns: 2, fields: ["order_id", "customer", "item_summary", "order_total", "order_status"] },
      { heading: "Return Summary", columns: 2, fields: ["has_open_return", "latest_return", "latest_return_state", "latest_refund_state", "returned_amount"] }
    ]
  },
  listView: {
    columns: ["order_id", "customer", "order_total", "has_open_return", "latest_return_state"],
    filterFields: ["order_id", "customer", "order_status", "has_open_return", "latest_return_state", "latest_refund_state"],
    orderBy: "order_id",
    order: "asc",
    pageSize: 25
  },
  permissions: [
    { roles: [PUBLIC_RETURN_INTAKE_ROLE], actions: ["read", "metadata"] },
    staffRead,
    managerFullAccess
  ],
  indexes: [["customer"], ["has_open_return"], ["latest_return_state"]]
});

const intakeRoles = ["Guest", RETURNS_AGENT_ROLE, RETURNS_MANAGER_ROLE];
const agentFields = [RETURNS_AGENT_ROLE, RETURNS_MANAGER_ROLE];
const warehouseFields = [WAREHOUSE_INSPECTOR_ROLE, RETURNS_MANAGER_ROLE];
const financeFields = [FINANCE_APPROVER_ROLE, RETURNS_MANAGER_ROLE];

export const ReturnRequest = defineDocType({
  name: "Return Request",
  label: "Return Request",
  module: "Returns",
  version: 1,
  naming: {
    kind: "series",
    pattern: "RMA-{YYYY}-{sequence:6}",
    targetField: "return_id",
    counter: "returns",
    reset: "year",
    start: 1,
    step: 1,
    maxAttempts: 10_000
  },
  description: "A return case with independently governed case, logistics, inspection, and refund lifecycles.",
  fields: [
    { name: "return_id", label: "Return ID", type: "text", required: true, unique: true, readOnly: true, noCopy: true, permissions: [staffFieldRead] },
    { name: "customer", label: "Customer", type: "link", linkTo: "Customer", required: true, permissions: [staffFieldRead, createFor(intakeRoles)] },
    { name: "order", label: "Order", type: "link", linkTo: "Order", required: true, unique: true, permissions: [staffFieldRead, createFor(intakeRoles)] },
    {
      name: "reason",
      label: "Return Reason",
      type: "select",
      options: ["Damaged", "Wrong Item", "Not as Described", "Changed Mind", "Other"],
      required: true,
      permissions: [staffFieldRead, updateFor(agentFields), createFor(["Guest"])]
    },
    { name: "details", label: "Customer Notes", type: "longText", permissions: [staffFieldRead, updateFor(agentFields), createFor(["Guest"])] },
    { name: "requested_amount", label: "Requested Amount", type: "number", required: true, min: 0, permissions: [staffFieldRead, updateFor(agentFields), createFor(["Guest"])] },
    { name: "approved_amount", label: "Approved Amount", type: "number", defaultValue: 0, min: 0, permissions: [staffFieldRead, updateFor(financeFields)] },
    { name: "risk_score", label: "Risk Score", type: "integer", defaultValue: 0, min: 0, max: 10, permissions: [staffFieldRead, updateFor(agentFields)] },
    { name: "high_risk", label: "High Risk", type: "boolean", defaultValue: false, permissions: [{ roles: RETURNS_STAFF_ROLES, actions: ["read"] }, { roles: [SYSTEM_MANAGER_ROLE], actions: ["read", "create", "update"] }] },
    {
      name: "case_state",
      label: "Case State",
      type: "select",
      options: ["Draft", "Submitted", "Processing", "Resolved", "Closed"],
      defaultValue: "Draft"
    },
    {
      name: "logistics_state",
      label: "Logistics State",
      type: "select",
      options: ["Not Started", "Awaiting Shipment", "In Transit", "Received", "Lost"],
      defaultValue: "Not Started"
    },
    {
      name: "inspection_state",
      label: "Inspection State",
      type: "select",
      options: ["Pending", "Passed", "Partial", "Failed"],
      defaultValue: "Pending"
    },
    {
      name: "refund_state",
      label: "Refund State",
      type: "select",
      options: ["Not Eligible", "Pending Approval", "Approved", "Processing", "Refunded", "Rejected"],
      defaultValue: "Not Eligible"
    },
    { name: "tracking_number", label: "Tracking Number", type: "text", permissions: [staffFieldRead, updateFor([...agentFields, WAREHOUSE_INSPECTOR_ROLE])] },
    { name: "received_at", label: "Received At", type: "datetime", permissions: [staffFieldRead, updateFor(warehouseFields)] },
    { name: "inspection_notes", label: "Inspection Notes", type: "longText", permissions: [staffFieldRead, updateFor(warehouseFields)] },
    { name: "deduction_amount", label: "Deduction Amount", type: "number", defaultValue: 0, min: 0, permissions: [staffFieldRead, updateFor(warehouseFields)] },
    { name: "scheduled_refund_at", label: "Scheduled Refund", type: "datetime", permissions: [staffFieldRead, updateFor(financeFields)] },
    { name: "refund_reference", label: "Refund Reference", type: "text", permissions: [staffFieldRead, updateFor(financeFields)] },
    { name: "submitted_by", label: "Submitted By", type: "text", readOnly: true, defaultValue: ({ actor }) => actor.id }
  ],
  formView: {
    sections: [
      { heading: "Return", columns: 2, fields: ["return_id", "customer", "order", "reason", "requested_amount", "submitted_by"] },
      { heading: "Case", columns: 2, fields: ["case_state", "risk_score", "high_risk", "details"] },
      { heading: "Logistics", columns: 2, fields: ["logistics_state", "tracking_number", "received_at"] },
      { heading: "Inspection", columns: 2, fields: ["inspection_state", "inspection_notes", "deduction_amount"] },
      { heading: "Refund", columns: 2, fields: ["refund_state", "approved_amount", "scheduled_refund_at", "refund_reference"] }
    ]
  },
  listView: {
    columns: ["return_id", "order", "reason", "case_state", "logistics_state", "inspection_state", "refund_state", "high_risk"],
    filterFields: ["return_id", "customer", "order", "reason", "case_state", "logistics_state", "inspection_state", "refund_state", "high_risk"],
    orderBy: "return_id",
    order: "asc",
    pageSize: 50
  },
  workflows: [
    {
      name: "case",
      label: "Case Lifecycle",
      stateField: "case_state",
      initialState: "Draft",
      states: ["Draft", "Submitted", "Processing", "Resolved", "Closed"],
      transitions: [
        { action: "submit", from: "Draft", to: "Submitted", roles: agentFields },
        { action: "startProcessing", from: "Submitted", to: "Processing", roles: agentFields },
        {
          action: "resolve",
          from: "Processing",
          to: "Resolved",
          roles: [RETURNS_AGENT_ROLE, FINANCE_APPROVER_ROLE, RETURNS_MANAGER_ROLE],
          allowWhen: refundFinished
        },
        { action: "close", from: "Resolved", to: "Closed", roles: [RETURNS_MANAGER_ROLE] }
      ]
    },
    {
      name: "logistics",
      label: "Reverse Logistics",
      stateField: "logistics_state",
      initialState: "Not Started",
      states: ["Not Started", "Awaiting Shipment", "In Transit", "Received", "Lost"],
      transitions: [
        { action: "prepareShipment", from: "Not Started", to: "Awaiting Shipment", roles: agentFields },
        {
          action: "markInTransit",
          from: "Awaiting Shipment",
          to: "In Transit",
          roles: agentFields,
          allowWhen: compare(beforeField("tracking_number"), "is", literal("set"))
        },
        { action: "receive", from: "In Transit", to: "Received", roles: warehouseFields },
        { action: "reportLost", from: "In Transit", to: "Lost", roles: [RETURNS_MANAGER_ROLE] }
      ]
    },
    {
      name: "inspection",
      label: "Warehouse Inspection",
      stateField: "inspection_state",
      initialState: "Pending",
      states: ["Pending", "Passed", "Partial", "Failed"],
      transitions: [
        { action: "pass", from: "Pending", to: "Passed", roles: warehouseFields, allowWhen: logisticsReceived },
        { action: "markPartial", from: "Pending", to: "Partial", roles: warehouseFields, allowWhen: logisticsReceived },
        { action: "fail", from: "Pending", to: "Failed", roles: warehouseFields, allowWhen: logisticsReceived }
      ]
    },
    {
      name: "refund",
      label: "Refund Lifecycle",
      stateField: "refund_state",
      initialState: "Not Eligible",
      states: ["Not Eligible", "Pending Approval", "Approved", "Processing", "Refunded", "Rejected"],
      transitions: [
        {
          action: "requestApproval",
          from: "Not Eligible",
          to: "Pending Approval",
          roles: agentFields,
          allowWhen: all(logisticsReceived, inspectionAccepted)
        },
        {
          action: "approve",
          from: "Pending Approval",
          to: "Approved",
          roles: financeFields,
          allowWhen: compare(beforeField("approved_amount"), "gt", literal(0))
        },
        { action: "reject", from: "Pending Approval", to: "Rejected", roles: financeFields },
        {
          action: "beginProcessing",
          from: "Approved",
          to: "Processing",
          roles: financeFields,
          allowWhen: compare(beforeField("scheduled_refund_at"), "is", literal("set"))
        },
        {
          action: "markRefunded",
          from: "Processing",
          to: "Refunded",
          roles: financeFields,
          allowWhen: all(
            compare(beforeField("refund_reference"), "is", literal("set")),
            compare(beforeField("refund_reference"), "ne", literal(""))
          )
        }
      ]
    }
  ],
  commands: [
    {
      name: "acceptReturn",
      eventType: "ReturnAccepted",
      roles: agentFields,
      permissionAction: "transition",
      buildPlan: () => ({
        patch: { case_state: "Submitted", logistics_state: "Awaiting Shipment" },
        transitions: [
          { workflow: "case", action: "submit" },
          { workflow: "logistics", action: "prepareShipment" }
        ]
      })
    },
    {
      name: "dispatchReturn",
      eventType: "ReturnDispatched",
      fields: ["tracking_number"],
      roles: agentFields,
      permissionAction: "transition",
      buildPlan: ({ input }) => ({
        patch: {
          tracking_number: requiredCommandString(input.tracking_number, "Tracking number", 80),
          logistics_state: "In Transit"
        },
        transitions: [{ workflow: "logistics", action: "markInTransit" }]
      })
    },
    {
      name: "inspectReturn",
      eventType: "ReturnInspected",
      fields: ["outcome", "inspection_notes", "deduction_amount"],
      roles: warehouseFields,
      permissionAction: "transition",
      buildPlan: ({ document, input, now }) => {
        const inspection = inspectionTransition(input.outcome);
        const shouldReceive = document.data.logistics_state === "In Transit";
        return {
          patch: {
            ...(shouldReceive ? { logistics_state: "Received" } : {}),
            inspection_state: inspection.state,
            received_at: typeof document.data.received_at === "string" && document.data.received_at.length > 0
              ? document.data.received_at
              : now,
            inspection_notes: typeof input.inspection_notes === "string" ? input.inspection_notes.trim() : "",
            deduction_amount: commandAmount(input.deduction_amount ?? 0, "Deduction amount", { allowZero: true })
          },
          transitions: [
            ...(shouldReceive ? [{ workflow: "logistics", action: "receive" } as const] : []),
            { workflow: "inspection", action: inspection.action }
          ]
        };
      }
    },
    {
      name: "approveAndScheduleRefund",
      eventType: "ReturnRefundApprovedAndScheduled",
      fields: ["approved_amount", "scheduled_refund_at"],
      roles: financeFields,
      permissionAction: "transition",
      buildPlan: ({ document, input }) => {
        const scheduled = requiredCommandString(input.scheduled_refund_at, "Scheduled refund time", 40);
        if (Number.isNaN(new Date(scheduled).valueOf())) {
          throw new FrameworkError("BAD_REQUEST", "Scheduled refund time must be a valid date and time", { status: 400 });
        }
        const requiresApproval = document.data.refund_state === "Pending Approval";
        return {
          patch: {
            approved_amount: commandAmount(input.approved_amount, "Approved amount"),
            scheduled_refund_at: scheduled,
            refund_state: "Processing"
          },
          transitions: [
            ...(requiresApproval ? [{ workflow: "refund", action: "approve" } as const] : []),
            { workflow: "refund", action: "beginProcessing" }
          ]
        };
      }
    },
    {
      name: "completeRefundAndResolve",
      eventType: "ReturnRefundedAndResolved",
      fields: ["refund_reference"],
      roles: financeFields,
      permissionAction: "transition",
      buildPlan: ({ input, document }) => ({
        patch: {
          refund_reference: requiredCommandString(
            input.refund_reference ?? document.data.refund_reference,
            "Refund reference",
            80
          ),
          refund_state: "Refunded",
          case_state: "Resolved"
        },
        transitions: [
          { workflow: "refund", action: "markRefunded" },
          { workflow: "case", action: "resolve" }
        ]
      })
    }
  ],
  assignmentRules: [
    {
      name: "Assign new returns to the returns desk",
      events: ["DocumentCreated"],
      assignees: [{ kind: "user", userId: "returns.agent@demo.local" }],
      excludeActor: true
    },
    {
      name: "Assign pending refunds to finance",
      events: ["WorkflowTransitioned", "DomainCommandApplied"],
      assignees: [{ kind: "user", userId: "finance.approver@demo.local" }],
      condition: compare(afterField("refund_state"), "eq", literal("Pending Approval")),
      excludeActor: true
    }
  ],
  automationRules: [
    {
      id: "flag-high-risk",
      name: "Flag high-risk returns",
      trigger: { events: ["DocumentCreated", "DocumentUpdated"], touchedFields: ["risk_score"] },
      runWhen: all(
        compare(afterField("risk_score"), "gte", literal(7)),
        compare(afterField("high_risk"), "eq", literal(false))
      ),
      actions: [{
        id: "set-high-risk",
        kind: "updateDocument",
        target: { doctype: "Return Request", name: { kind: "documentName" } },
        patch: { high_risk: { kind: "literal", value: true } }
      }]
    },
    {
      id: "clear-high-risk",
      name: "Clear a reduced risk flag",
      trigger: { events: ["DocumentUpdated"], touchedFields: ["risk_score"] },
      runWhen: all(
        compare(afterField("risk_score"), "lt", literal(7)),
        compare(afterField("high_risk"), "eq", literal(true))
      ),
      actions: [{
        id: "unset-high-risk",
        kind: "updateDocument",
        target: { doctype: "Return Request", name: { kind: "documentName" } },
        patch: { high_risk: { kind: "literal", value: false } }
      }]
    },
    {
      id: "open-order-return",
      name: "Link a new return to its order",
      trigger: { events: ["DocumentCreated"] },
      actions: [{
        id: "mark-order-open",
        kind: "updateDocument",
        target: { doctype: "Order", name: { kind: "field", field: "order" } },
        patch: {
          has_open_return: { kind: "literal", value: true },
          latest_return: { kind: "documentName" },
          latest_return_state: { kind: "field", field: "case_state" },
          latest_refund_state: { kind: "field", field: "refund_state" }
        }
      }]
    },
    {
      id: "sync-case-state-to-order",
      name: "Sync case state to the linked order",
      trigger: { events: ["WorkflowTransitioned", "DomainCommandApplied"], workflow: "case" },
      actions: [{
        id: "sync-case-state",
        kind: "updateDocument",
        target: { doctype: "Order", name: { kind: "field", field: "order" } },
        patch: { latest_return_state: { kind: "field", field: "case_state" } }
      }]
    },
    {
      id: "sync-refund-state-to-order",
      name: "Sync refund state to the linked order",
      trigger: { events: ["WorkflowTransitioned", "DomainCommandApplied"], workflow: "refund" },
      actions: [{
        id: "sync-refund-state",
        kind: "updateDocument",
        target: { doctype: "Order", name: { kind: "field", field: "order" } },
        patch: { latest_refund_state: { kind: "field", field: "refund_state" } }
      }]
    },
    {
      id: "record-completed-refund",
      name: "Record a completed refund on customer and order",
      trigger: { events: ["DomainCommandApplied"], domainCommand: "completeRefundAndResolve" },
      actions: [
        {
          id: "close-order-return",
          kind: "updateDocument",
          target: { doctype: "Order", name: { kind: "field", field: "order" } },
          patch: {
            has_open_return: { kind: "literal", value: false },
            returned_amount: { kind: "field", field: "approved_amount" },
            latest_return_state: { kind: "field", field: "case_state" },
            latest_refund_state: { kind: "field", field: "refund_state" }
          }
        },
        {
          id: "record-customer-refund",
          kind: "updateDocument",
          target: { doctype: "Customer", name: { kind: "field", field: "customer" } },
          patch: {
            latest_return: { kind: "documentName" },
            latest_return_state: { kind: "field", field: "case_state" },
            last_refunded_amount: { kind: "field", field: "approved_amount" }
          }
        }
      ]
    }
  ],
  permissions: [
    { roles: ["Guest"], actions: ["create"] },
    {
      roles: [RETURNS_AGENT_ROLE],
      actions: ["read", "metadata", "create", "update", "transition", "comment", "assign", "activity", "tag", "follow", "share"]
    },
    {
      roles: [WAREHOUSE_INSPECTOR_ROLE],
      actions: ["read", "metadata", "update", "transition", "comment", "activity", "tag", "follow"]
    },
    {
      roles: [FINANCE_APPROVER_ROLE],
      actions: ["read", "metadata", "update", "transition", "comment", "assign", "activity", "tag", "follow"]
    },
    managerFullAccess
  ],
  indexes: [
    ["customer"],
    ["order"],
    ["case_state", "high_risk"],
    ["logistics_state", "inspection_state"],
    ["refund_state", "scheduled_refund_at"]
  ]
});

export const ReturnsFinanceQueue = defineReport({
  name: "Returns Finance Queue",
  label: "Returns Finance Queue",
  module: "Returns",
  description: "Refund approvals and processing work ordered by scheduled refund time.",
  doctype: "Return Request",
  columns: [
    { name: "return_id", label: "Return", field: "return_id", type: "text" },
    { name: "order", label: "Order", field: "order", type: "link" },
    { name: "reason", label: "Reason", field: "reason", type: "select" },
    { name: "requested_amount", label: "Requested", field: "requested_amount", type: "number" },
    { name: "approved_amount", label: "Approved", field: "approved_amount", type: "number" },
    { name: "refund_state", label: "Refund State", field: "refund_state", type: "select" },
    { name: "scheduled_refund_at", label: "Scheduled", field: "scheduled_refund_at", type: "datetime" },
    { name: "high_risk", label: "High Risk", field: "high_risk", type: "boolean" }
  ],
  filters: [
    { name: "refund_state", label: "Refund State", field: "refund_state", type: "select", defaultValue: "Pending Approval" },
    { name: "reason", label: "Reason", field: "reason", type: "select" },
    { name: "high_risk", label: "High Risk", field: "high_risk", type: "boolean" }
  ],
  summaries: [
    { name: "case_count", label: "Cases", aggregate: "count" },
    { name: "requested_total", label: "Requested Total", aggregate: "sum", field: "requested_amount", type: "number" },
    { name: "approved_total", label: "Approved Total", aggregate: "sum", field: "approved_amount", type: "number" }
  ],
  groups: [{
    name: "by_refund_state",
    label: "By Refund State",
    field: "refund_state",
    summaries: [
      { name: "case_count", label: "Cases", aggregate: "count" },
      { name: "approved_total", label: "Approved Total", aggregate: "sum", field: "approved_amount", type: "number" }
    ]
  }],
  charts: [{
    name: "refund_queue_by_state",
    label: "Refund Queue by State",
    type: "bar",
    group: "by_refund_state",
    summary: "case_count",
    showValues: true,
    colors: ["#2563EB", "#D97706", "#059669", "#DC2626"]
  }],
  orderBy: "scheduled_refund_at",
  order: "asc",
  roles: [FINANCE_APPROVER_ROLE, RETURNS_MANAGER_ROLE]
});

export const ReturnsOperationsDashboard = defineDashboard({
  name: "Returns Operations",
  label: "Returns Operations",
  module: "Returns",
  description: "Operational health across the independent return lifecycles.",
  roles: RETURNS_STAFF_ROLES,
  cards: [
    {
      name: "open_returns",
      label: "Open Returns",
      indicator: "blue",
      source: { kind: "documentCount", doctype: "Return Request", filters: [{ field: "case_state", operator: "ne", value: "Closed" }] }
    },
    {
      name: "high_risk",
      label: "High Risk",
      indicator: "red",
      source: { kind: "documentCount", doctype: "Return Request", filters: [{ field: "high_risk", value: true }] }
    },
    {
      name: "pending_inspection",
      label: "Pending Inspection",
      indicator: "amber",
      source: {
        kind: "documentCount",
        doctype: "Return Request",
        filterExpression: {
          kind: "group",
          match: "all",
          filters: [
            { field: "logistics_state", value: "Received" },
            { field: "inspection_state", value: "Pending" }
          ]
        }
      }
    },
    {
      name: "refund_queue",
      label: "Refund Queue",
      indicator: "green",
      source: {
        kind: "documentCount",
        doctype: "Return Request",
        filterExpression: {
          kind: "group",
          match: "any",
          filters: [
            { field: "refund_state", value: "Pending Approval" },
            { field: "refund_state", value: "Approved" },
            { field: "refund_state", value: "Processing" }
          ]
        }
      }
    },
    {
      name: "requested_total",
      label: "Requested Total",
      source: { kind: "documentAggregate", doctype: "Return Request", aggregate: "sum", field: "requested_amount" }
    },
    {
      name: "refunded_total",
      label: "Refunded Total",
      source: {
        kind: "documentAggregate",
        doctype: "Return Request",
        aggregate: "sum",
        field: "approved_amount",
        filters: [{ field: "refund_state", value: "Refunded" }]
      }
    }
  ]
});

export const ReturnCaseBoard = defineKanban({
  name: "Return Case Board",
  label: "Return Case Board",
  module: "Returns",
  description: "Return cases grouped by the case lifecycle without flattening logistics, inspection, or refund state.",
  roles: RETURNS_STAFF_ROLES,
  doctype: "Return Request",
  columnField: "case_state",
  titleField: "return_id",
  maxCardsPerColumn: 50
});

export const RefundSchedule = defineCalendar({
  name: "Refund Schedule",
  label: "Refund Schedule",
  module: "Returns",
  description: "Approved refunds with a scheduled processing time.",
  roles: [FINANCE_APPROVER_ROLE, RETURNS_MANAGER_ROLE],
  doctype: "Return Request",
  startField: "scheduled_refund_at",
  titleField: "return_id",
  colorField: "refund_state",
  maxEvents: 200
});

export const ReturnIntake = defineWebForm({
  name: "Return Intake",
  label: "Start a Return",
  module: "Returns",
  route: "returns/intake",
  description: "Submit a return request for an existing demo order.",
  published: true,
  doctype: "Return Request",
  fields: [
    { field: "customer", required: true },
    { field: "order", required: true },
    { field: "reason", required: true },
    { field: "details" },
    { field: "requested_amount", required: true }
  ],
  submitLabel: "Submit Return",
  successMessage: "Your return request was created."
});

export const ReturnAuthorizationPrint = definePrintFormat({
  name: "Return Authorization",
  label: "Return Authorization",
  module: "Returns",
  description: "Operational return authorization and refund summary.",
  doctype: "Return Request",
  sections: [
    { heading: "Return", fields: [{ field: "return_id" }, { field: "customer" }, { field: "order" }, { field: "reason" }, { field: "requested_amount" }] },
    { heading: "Lifecycles", fields: [{ field: "case_state" }, { field: "logistics_state" }, { field: "inspection_state" }, { field: "refund_state" }] },
    { heading: "Resolution", fields: [{ field: "approved_amount" }, { field: "deduction_amount" }, { field: "refund_reference" }] }
  ],
  roles: RETURNS_STAFF_ROLES
});

export const ReturnsWorkspace = defineWorkspace({
  name: "Returns Operations",
  label: "Returns Operations",
  module: "Returns",
  description: "Daily return, warehouse, and finance operations.",
  roles: RETURNS_STAFF_ROLES,
  sections: [
    {
      name: "operations",
      label: "Operations",
      shortcuts: [
        { name: "return_requests", label: "Return Requests", kind: "doctype", target: "Return Request" },
        { name: "new_return", label: "New Return", kind: "newDoc", target: "Return Request", roles: [RETURNS_AGENT_ROLE, RETURNS_MANAGER_ROLE] },
        { name: "case_board", label: "Case Board", kind: "kanban", target: "Return Case Board" },
        { name: "operations_dashboard", label: "Operations Dashboard", kind: "dashboard", target: "Returns Operations" }
      ]
    },
    {
      name: "finance",
      label: "Finance",
      shortcuts: [
        { name: "finance_queue", label: "Finance Queue", kind: "report", target: "Returns Finance Queue", roles: [FINANCE_APPROVER_ROLE, RETURNS_MANAGER_ROLE] },
        { name: "refund_schedule", label: "Refund Schedule", kind: "calendar", target: "Refund Schedule", roles: [FINANCE_APPROVER_ROLE, RETURNS_MANAGER_ROLE] }
      ]
    },
    {
      name: "master_data",
      label: "Master Data",
      shortcuts: [
        { name: "customers", label: "Customers", kind: "doctype", target: "Customer" },
        { name: "orders", label: "Orders", kind: "doctype", target: "Order" }
      ]
    },
    {
      name: "inbox",
      label: "Inbox",
      shortcuts: [
        { name: "notifications", label: "Notifications", kind: "notifications" }
      ]
    }
  ]
});

export const returnsApp = defineApp({
  name: "returns-os",
  label: "ReturnsOS",
  version: "1.0.0",
  modules: ["Returns"],
  doctypes: [Customer, Order, ReturnRequest],
  printFormats: [ReturnAuthorizationPrint],
  reports: [ReturnsFinanceQueue],
  dashboards: [ReturnsOperationsDashboard],
  kanbans: [ReturnCaseBoard],
  calendars: [RefundSchedule],
  webForms: [ReturnIntake],
  workspaces: [ReturnsWorkspace],
  hooks: {
    "Return Request": [{
      beforeValidate: ({ data }) => ({
        tracking_number: typeof data.tracking_number === "string" ? data.tracking_number.trim().toUpperCase() : data.tracking_number,
        refund_reference: typeof data.refund_reference === "string" ? data.refund_reference.trim().toUpperCase() : data.refund_reference
      }),
      validate: ({ data }) => {
        const requested = typeof data.requested_amount === "number" ? data.requested_amount : 0;
        const approved = typeof data.approved_amount === "number" ? data.approved_amount : 0;
        const deduction = typeof data.deduction_amount === "number" ? data.deduction_amount : 0;
        return [
          ...(approved > requested
            ? [{ field: "approved_amount", code: "approved_exceeds_requested", message: "Approved amount cannot exceed requested amount" }]
            : []),
          ...(deduction > requested
            ? [{ field: "deduction_amount", code: "deduction_exceeds_requested", message: "Deduction cannot exceed requested amount" }]
            : [])
        ];
      }
    }]
  }
});

export const returnsRegistry = createRegistryFromApps([returnsApp]);
