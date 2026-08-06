import {
  FINANCE_APPROVER_ROLE,
  RETURNS_AGENT_ROLE,
  RETURNS_MANAGER_ROLE,
  WAREHOUSE_INSPECTOR_ROLE,
  returnsRegistry
} from "../../examples/returns/models";

describe("ReturnsOS metadata", () => {
  it("registers the complete operational UI surface", () => {
    expect(returnsRegistry.list().map((doctype) => doctype.name)).toEqual([
      "Customer",
      "Order",
      "Return Request"
    ]);
    expect(returnsRegistry.listWorkspaces().map((item) => item.name)).toEqual(["Returns Operations"]);
    expect(returnsRegistry.listDashboards().map((item) => item.name)).toEqual(["Returns Operations"]);
    expect(returnsRegistry.listKanbans().map((item) => item.name)).toEqual(["Return Case Board"]);
    expect(returnsRegistry.listCalendars().map((item) => item.name)).toEqual(["Refund Schedule"]);
    expect(returnsRegistry.listReports().map((item) => item.name)).toEqual(["Returns Finance Queue"]);
    expect(returnsRegistry.listWebForms().map((item) => item.name)).toEqual(["Return Intake"]);
    expect(returnsRegistry.listPrintFormats().map((item) => item.name)).toEqual(["Return Authorization"]);
  });

  it("defines four independent workflows and five explicit composite commands", () => {
    const doctype = returnsRegistry.get("Return Request");

    expect(doctype.workflows?.map((workflow) => [workflow.name, workflow.stateField])).toEqual([
      ["case", "case_state"],
      ["logistics", "logistics_state"],
      ["inspection", "inspection_state"],
      ["refund", "refund_state"]
    ]);
    expect(doctype.commands?.map((command) => command.name)).toEqual([
      "acceptReturn",
      "dispatchReturn",
      "inspectReturn",
      "approveAndScheduleRefund",
      "completeRefundAndResolve"
    ]);
    expect(doctype.fields.find((field) => field.name === "order")).toMatchObject({
      type: "link",
      linkTo: "Order",
      unique: true
    });
    expect(doctype.workflows?.find((workflow) => workflow.name === "inspection")?.transitions[0]).toMatchObject({
      action: "pass",
      roles: [WAREHOUSE_INSPECTOR_ROLE, RETURNS_MANAGER_ROLE],
      allowWhen: expect.any(Object)
    });
    expect(doctype.workflows?.find((workflow) => workflow.name === "refund")?.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "requestApproval", roles: [RETURNS_AGENT_ROLE, RETURNS_MANAGER_ROLE] }),
        expect.objectContaining({ action: "approve", roles: [FINANCE_APPROVER_ROLE, RETURNS_MANAGER_ROLE] })
      ])
    );
  });

  it("uses durable update actions with stable rule and action identities", () => {
    const rules = returnsRegistry.get("Return Request").automationRules ?? [];

    expect(rules.map((rule) => rule.id)).toEqual([
      "flag-high-risk",
      "clear-high-risk",
      "open-order-return",
      "sync-case-state-to-order",
      "sync-refund-state-to-order",
      "record-completed-refund"
    ]);
    expect(rules.flatMap((rule) => rule.actions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "set-high-risk", kind: "updateDocument" }),
        expect.objectContaining({ id: "close-order-return", kind: "updateDocument" }),
        expect.objectContaining({ id: "record-customer-refund", kind: "updateDocument" })
      ])
    );
  });
});
