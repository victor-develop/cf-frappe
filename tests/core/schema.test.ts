import {
  allowedWorkflowTransitions,
  applyDefaults,
  can,
  defineDocType,
  FrameworkError,
  pickCommandFields,
  validateDocumentData
} from "../../src";
import type { DocumentData, DocumentSnapshot, PermissionAction } from "../../src";
import { owner } from "../helpers";

describe("schema", () => {
  const doctype = defineDocType({
    name: "Invoice",
    fields: [
      { name: "customer", type: "text", required: true },
      { name: "amount", type: "number", min: 0 },
      { name: "paid", type: "boolean", defaultValue: false },
      { name: "status", type: "select", options: ["Draft", "Paid"], defaultValue: "Draft" }
    ]
  });

  it("applies scalar defaults without mutating input", () => {
    const input = { customer: "Ada" };
    const result = applyDefaults(doctype, input, { actor: owner, now: "2026-01-01T00:00:00.000Z" });

    expect(result).toEqual({ customer: "Ada", paid: false, status: "Draft" });
    expect(input).toEqual({ customer: "Ada" });
  });

  it("snapshots JSON defaults by value", () => {
    const staticDefault = { nested: { enabled: true } };
    const dynamicDefault = { nested: { actor: "template" } };
    const settings = defineDocType({
      name: "Settings",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "static_json", type: "json", defaultValue: staticDefault },
        { name: "dynamic_json", type: "json", defaultValue: () => dynamicDefault }
      ]
    });

    const result = applyDefaults(settings, { title: "Site" }, { actor: owner, now: "2026-01-01T00:00:00.000Z" });

    ((result.static_json as DocumentData).nested as DocumentData).enabled = false;
    ((result.dynamic_json as DocumentData).nested as DocumentData).actor = "mutated";

    expect(staticDefault).toEqual({ nested: { enabled: true } });
    expect(dynamicDefault).toEqual({ nested: { actor: "template" } });
  });

  it("snapshots declared JSON defaults by value", () => {
    const declaredDefault = { nested: { enabled: true } };
    const settings = defineDocType({
      name: "Declared Settings",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "settings", type: "json", defaultValue: declaredDefault }
      ]
    });

    declaredDefault.nested.enabled = false;
    const result = applyDefaults(settings, { title: "Site" }, { actor: owner, now: "2026-01-01T00:00:00.000Z" });

    expect(result.settings).toEqual({ nested: { enabled: true } });
  });

  it("snapshots list view filters by value", () => {
    const statusFilter = { field: "status", value: "Open" };
    const rangeValue = [1, 3];
    const task = defineDocType({
      name: "Filtered Task",
      fields: [
        { name: "status", type: "select", options: ["Open", "Closed"] },
        { name: "rank", type: "integer" }
      ],
      listView: {
        filters: [
          statusFilter,
          { field: "rank", operator: "between", value: rangeValue }
        ]
      }
    });

    statusFilter.field = "missing";
    rangeValue[0] = 99;

    expect(task.listView?.filters).toEqual([
      { field: "status", value: "Open" },
      { field: "rank", operator: "between", value: [1, 3] }
    ]);
  });

  it("snapshots permission rules by value", () => {
    const roles = ["Reader"];
    const actions: PermissionAction[] = ["read"];
    const note = defineDocType({
      name: "Permissioned Note",
      fields: [{ name: "title", type: "text" }],
      permissions: [{ roles, actions }]
    });

    roles[0] = "Admin";
    actions.push("delete");

    expect(note.permissions).toEqual([{ roles: ["Reader"], actions: ["read"] }]);
    expect(Object.isFrozen(note.permissions)).toBe(true);
    expect(Object.isFrozen(note.permissions?.[0]?.roles)).toBe(true);
    expect(Object.isFrozen(note.permissions?.[0]?.actions)).toBe(true);
    expect(can({ id: "reader@example.com", roles: ["Reader"] }, note, "read")).toBe(true);
    expect(can({ id: "reader@example.com", roles: ["Reader"] }, note, "delete")).toBe(false);
  });

  it("snapshots workflow states and transition roles by value", () => {
    const states = ["Open", "Closed"];
    const transitionRoles = ["User"];
    const task = defineDocType({
      name: "Workflow Task",
      fields: [{ name: "workflow_state", type: "select", options: ["Open", "Closed"] }],
      workflow: {
        initialState: "Open",
        states,
        transitions: [{ action: "close", from: "Open", to: "Closed", roles: transitionRoles }]
      }
    });

    states[0] = "Draft";
    transitionRoles[0] = "Admin";

    const document: DocumentSnapshot = {
      tenantId: "acme",
      doctype: "Workflow Task",
      name: "TASK-1",
      version: 1,
      docstatus: "draft",
      data: { workflow_state: "Open" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };

    expect(task.workflow).toEqual({
      initialState: "Open",
      states: ["Open", "Closed"],
      transitions: [{ action: "close", from: "Open", to: "Closed", roles: ["User"] }]
    });
    expect(Object.isFrozen(task.workflow?.states)).toBe(true);
    expect(Object.isFrozen(task.workflow?.transitions)).toBe(true);
    expect(Object.isFrozen(task.workflow?.transitions[0]?.roles)).toBe(true);
    expect(
      allowedWorkflowTransitions({
        actor: { id: "user@example.com", roles: ["User"], tenantId: "acme" },
        document,
        workflow: task.workflow!
      }).map((transition) => transition.action)
    ).toEqual(["close"]);
    expect(
      allowedWorkflowTransitions({
        actor: { id: "admin@example.com", roles: ["Admin"], tenantId: "acme" },
        document,
        workflow: task.workflow!
      })
    ).toEqual([]);
  });

  it("snapshots domain command field and role metadata by value", () => {
    const commandFields = ["resolution"];
    const commandRoles = ["Support"];
    const buildPatch = () => ({ status: "Closed" });
    const ticket = defineDocType({
      name: "Command Ticket",
      fields: [
        { name: "status", type: "select", options: ["Open", "Closed"] },
        { name: "resolution", type: "text" },
        { name: "internal_note", type: "text" }
      ],
      commands: [
        {
          name: "resolve",
          eventType: "TicketResolved",
          fields: commandFields,
          roles: commandRoles,
          buildPatch
        }
      ]
    });

    commandFields.push("internal_note");
    commandRoles[0] = "Admin";

    const command = ticket.commands?.[0];

    expect(ticket.commands).toEqual([
      expect.objectContaining({
        name: "resolve",
        eventType: "TicketResolved",
        fields: ["resolution"],
        roles: ["Support"],
        buildPatch
      })
    ]);
    expect(Object.isFrozen(ticket.commands)).toBe(true);
    expect(Object.isFrozen(command?.fields)).toBe(true);
    expect(Object.isFrozen(command?.roles)).toBe(true);
    expect(pickCommandFields(command?.fields, { resolution: "Done", internal_note: "secret" })).toEqual({
      resolution: "Done"
    });
  });

  it("reports missing required fields", () => {
    expect(validateDocumentData(doctype, {})).toMatchObject([
      { field: "customer", code: "required" }
    ]);
  });

  it("reports type violations", () => {
    const issues = validateDocumentData(doctype, { customer: "Ada", amount: "lots", paid: "yes" });

    expect(issues.map((issue) => issue.field)).toEqual(["amount", "paid"]);
  });

  it("reports select values outside declared options", () => {
    expect(validateDocumentData(doctype, { customer: "Ada", status: "Void" })).toMatchObject([
      { field: "status", code: "option" }
    ]);
  });

  it("rejects unknown fields by default", () => {
    expect(validateDocumentData(doctype, { customer: "Ada", mystery: true })).toMatchObject([
      { field: "mystery", code: "unknown_field" }
    ]);
  });

  it("allows unknown fields when the doctype opts in", () => {
    const loose = defineDocType({
      name: "Loose",
      allowUnknownFields: true,
      fields: [{ name: "title", type: "text" }]
    });

    expect(validateDocumentData(loose, { title: "ok", extra: true })).toEqual([]);
  });

  it("rejects duplicate fields early", () => {
    expect(() =>
      defineDocType({
        name: "Bad",
        fields: [
          { name: "title", type: "text" },
          { name: "title", type: "text" }
        ]
      })
    ).toThrow("Duplicate field");
  });

  it("requires naming series metadata to include a placeholder", () => {
    expect(() =>
      defineDocType({
        name: "Ticket",
        naming: { kind: "series", pattern: "TICKET" },
        fields: [{ name: "title", type: "text" }]
      })
    ).toThrow(FrameworkError);
  });

  it("requires link fields to declare their target DocType", () => {
    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "project", type: "link" }]
      })
    ).toThrow(FrameworkError);
  });

  it("rejects link targets on non-link fields", () => {
    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "project", type: "text", linkTo: "Project" }]
      })
    ).toThrow(FrameworkError);
  });

  it("requires table fields to declare their child DocType", () => {
    expect(() =>
      defineDocType({
        name: "Invoice",
        fields: [{ name: "items", type: "table" }]
      })
    ).toThrow(FrameworkError);
  });

  it("rejects table targets on non-table fields", () => {
    expect(() =>
      defineDocType({
        name: "Invoice",
        fields: [{ name: "items", type: "json", tableOf: "Invoice Item" }]
      })
    ).toThrow(FrameworkError);
  });

  it("allows unique scalar fields and rejects unique table or JSON fields", () => {
    expect(() =>
      defineDocType({
        name: "Contact",
        fields: [{ name: "email", type: "text", unique: true }]
      })
    ).not.toThrow();
    expect(() =>
      defineDocType({
        name: "Bad JSON",
        fields: [{ name: "metadata", type: "json", unique: true }]
      })
    ).toThrow(FrameworkError);
    expect(() =>
      defineDocType({
        name: "Bad Table",
        fields: [{ name: "items", type: "table", tableOf: "Item", unique: true }]
      })
    ).toThrow(FrameworkError);
  });

  it("validates fetch-from field metadata against local link fields", () => {
    expect(() =>
      defineDocType({
        name: "Task",
        fields: [
          { name: "project", type: "link", linkTo: "Project" },
          { name: "project_title", type: "text", fetchFrom: "project.title", fetchIfEmpty: true }
        ]
      })
    ).not.toThrow();
    expect(() =>
      defineDocType({
        name: "Bad Fetch",
        fields: [
          { name: "project", type: "text" },
          { name: "project_title", type: "text", fetchFrom: "project.title" }
        ]
      })
    ).toThrow(FrameworkError);
    expect(() =>
      defineDocType({
        name: "Bad Fetch If Empty",
        fields: [{ name: "project_title", type: "text", fetchIfEmpty: true }]
      })
    ).toThrow(FrameworkError);
  });

  it("validates conditional mandatory fields from normalized field expressions", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "priority", type: "select", options: ["Low", "High"] },
        {
          name: "escalation_reason",
          type: "text",
          mandatoryDependsOn: { field: "priority", value: "High" }
        }
      ]
    });

    expect(validateDocumentData(Task, { priority: "Low" })).toEqual([]);
    expect(validateDocumentData(Task, { priority: "High" })).toEqual([
      {
        field: "escalation_reason",
        code: "required",
        message: "Field 'escalation_reason' is required"
      }
    ]);
    expect(
      validateDocumentData(
        Task,
        { priority: "High" },
        { partial: true, existing: { priority: "Low" } }
      )
    ).toEqual([
      {
        field: "escalation_reason",
        code: "required",
        message: "Field 'escalation_reason' is required"
      }
    ]);
    expect(Object.isFrozen(Task.fields[1]?.mandatoryDependsOn)).toBe(true);
    expect(() =>
      defineDocType({
        name: "Bad Mandatory",
        fields: [{ name: "reason", type: "text", mandatoryDependsOn: { field: "missing", value: true } }]
      })
    ).toThrow(FrameworkError);
  });

  it("validates conditional read-only field metadata from normalized field expressions", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "status", type: "select", options: ["Draft", "Approved"] },
        {
          name: "approval_note",
          type: "text",
          readOnlyDependsOn: { field: "status", value: "Approved" }
        }
      ]
    });

    expect(Object.isFrozen(Task.fields[1]?.readOnlyDependsOn)).toBe(true);
    expect(() =>
      defineDocType({
        name: "Bad Read Only",
        fields: [{ name: "approval_note", type: "text", readOnlyDependsOn: { field: "missing", value: true } }]
      })
    ).toThrow(FrameworkError);
  });

  it("validates conditional hidden field metadata from normalized field expressions", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "status", type: "select", options: ["Draft", "Closed"] },
        {
          name: "closure_reason",
          type: "text",
          hiddenDependsOn: { field: "status", operator: "ne", value: "Closed" }
        }
      ]
    });

    expect(Object.isFrozen(Task.fields[1]?.hiddenDependsOn)).toBe(true);
    expect(Task.fields[1]?.hiddenDependsOn).toEqual({ field: "status", operator: "ne", value: "Closed" });
    expect(() =>
      defineDocType({
        name: "Bad Hidden",
        fields: [{ name: "closure_reason", type: "text", hiddenDependsOn: { field: "missing", value: true } }]
      })
    ).toThrow(FrameworkError);
  });

  it("validates table rows against child DocType metadata", () => {
    const InvoiceItem = defineDocType({
      name: "Invoice Item",
      fields: [
        { name: "item_code", type: "text", required: true },
        { name: "quantity", type: "integer", required: true, min: 1 }
      ]
    });
    const Invoice = defineDocType({
      name: "Sales Invoice",
      fields: [{ name: "items", type: "table", tableOf: "Invoice Item", required: true }]
    });

    const issues = validateDocumentData(
      Invoice,
      {
        items: [
          { item_code: "SKU-1", quantity: 2 },
          { item_code: "", quantity: 0 },
          "not a row"
        ]
      },
      {
        relatedDocType: (name) => (name === "Invoice Item" ? InvoiceItem : undefined)
      }
    );

    expect(issues).toMatchObject([
      { field: "items[1].item_code", code: "required" },
      { field: "items[1].quantity", code: "min" },
      { field: "items[2]", code: "type" }
    ]);
  });

  it("treats an empty required table as missing", () => {
    const Invoice = defineDocType({
      name: "Sales Invoice",
      fields: [{ name: "items", type: "table", tableOf: "Invoice Item", required: true }]
    });

    expect(validateDocumentData(Invoice, { items: [] })).toMatchObject([
      { field: "items", code: "required" }
    ]);
  });

  it("rejects explicitly empty required fields during partial validation", () => {
    const Invoice = defineDocType({
      name: "Sales Invoice",
      fields: [{ name: "items", type: "table", tableOf: "Invoice Item", required: true }]
    });

    expect(validateDocumentData(Invoice, { items: [] }, { partial: true })).toMatchObject([
      { field: "items", code: "required" }
    ]);
  });
});
