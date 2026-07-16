import {
  automationActionId,
  automationActionsFromDomainEvent,
  automationChangedFields,
  automationRuleMatches,
  defineDocType
} from "../../src";
import type { DomainEvent, DocumentSnapshot } from "../../src";

const occurredAt = "2026-01-01T00:00:00.000Z";

describe("automation rules", () => {
  it("normalizes, freezes, matches, and resolves updateDocument actions", () => {
    const doctype = defineDocType({
      name: "Source",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "target", type: "link", linkTo: "Target" },
        { name: "status", type: "select", options: ["Open", "Done"] }
      ],
      automationRules: [{
        name: "Mirror Status",
        events: ["DocumentUpdated"],
        changedFields: ["status"],
        condition: { field: "status", value: "Done" },
        actions: [{
          kind: "updateDocument",
          target: {
            doctype: "Target",
            name: { kind: "field", field: "target" }
          },
          patch: {
            mirrored_status: { kind: "field", field: "status" },
            source_name: { kind: "documentName" },
            changed_by: { kind: "actor" },
            static_flag: { kind: "literal", value: true }
          }
        }]
      }]
    });
    const rule = doctype.automationRules?.[0];
    const event = updatedEvent({ status: "Done" });
    const snapshot = sourceSnapshot({ status: "Done", target: "Target One" });

    expect(Object.isFrozen(doctype.automationRules)).toBe(true);
    expect(Object.isFrozen(rule?.actions)).toBe(true);
    expect(rule === undefined ? undefined : automationRuleMatches(rule, event, snapshot)).toBe(true);
    expect(automationActionsFromDomainEvent({
      event,
      snapshot,
      rules: doctype.automationRules ?? []
    })).toEqual([{
      actionId: "evt_source:Mirror Status:0",
      ruleName: "Mirror Status",
      actionIndex: 0,
      action: {
        kind: "updateDocument",
        target: { doctype: "Target", name: "Target One" },
        patch: {
          mirrored_status: "Done",
          source_name: "Source One",
          changed_by: "owner@example.com",
          static_flag: true
        }
      }
    }]);
    expect(automationActionId("evt", "Rule", 2)).toBe("evt:Rule:2");
  });

  it("does not match disabled rules, unchanged fields, deleted snapshots, unsupported events, or false conditions", () => {
    const doctype = defineDocType({
      name: "Source",
      fields: [
        { name: "title", type: "text" },
        { name: "status", type: "select", options: ["Open", "Done"] }
      ],
      automationRules: [
        {
          name: "Disabled",
          enabled: false,
          events: ["DocumentUpdated"],
          actions: [updateSelfAction()]
        },
        {
          name: "Changed Field",
          events: ["DocumentUpdated"],
          changedFields: ["status"],
          actions: [updateSelfAction()]
        },
        {
          name: "Condition",
          events: ["DocumentUpdated"],
          condition: { field: "status", value: "Done" },
          actions: [updateSelfAction()]
        }
      ]
    });

    expect(automationActionsFromDomainEvent({
      event: updatedEvent({ title: "Only title" }),
      snapshot: sourceSnapshot({ status: "Open" }),
      rules: doctype.automationRules ?? []
    })).toEqual([]);
    expect(automationActionsFromDomainEvent({
      event: {
        ...updatedEvent({ status: "Done" }),
        payload: { kind: "DocumentCommentAdded", text: "No automation" }
      } as DomainEvent,
      snapshot: sourceSnapshot({ status: "Done" }),
      rules: doctype.automationRules ?? []
    })).toEqual([]);
    expect(automationActionsFromDomainEvent({
      event: updatedEvent({ status: "Done" }),
      snapshot: { ...sourceSnapshot({ status: "Done" }), docstatus: "deleted" },
      rules: doctype.automationRules ?? []
    })).toEqual([]);
  });

  it("derives changed fields for create, update, workflow, and domain-command events", () => {
    expect(automationChangedFields({
      ...updatedEvent({ title: "Created", status: "Open" }),
      payload: { kind: "DocumentCreated", data: { title: "Created", status: "Open" }, docstatus: "draft" }
    })).toEqual(["title", "status"]);
    expect(automationChangedFields({
      ...updatedEvent({ status: "Done" }, ["obsolete"]),
      payload: { kind: "WorkflowTransitioned", action: "close", from: "Open", to: "Done", patch: { status: "Done" } }
    })).toEqual(["status"]);
    expect(automationChangedFields({
      ...updatedEvent({ status: "Done" }),
      payload: { kind: "DomainCommandApplied", command: "close", input: {}, patch: { status: "Done" } }
    })).toEqual(["status"]);
    expect(automationChangedFields(updatedEvent({ status: "Done" }, ["obsolete"]))).toEqual(["obsolete", "status"]);
  });

  it("skips actions when target names or patches resolve empty", () => {
    const doctype = defineDocType({
      name: "Source",
      fields: [
        { name: "title", type: "text" },
        { name: "target", type: "text" },
        { name: "missing", type: "text" }
      ],
      automationRules: [
        {
          name: "Missing Target",
          events: ["DocumentUpdated"],
          actions: [{
            kind: "updateDocument",
            target: { doctype: "Target", name: { kind: "field", field: "missing" } },
            patch: { title: { kind: "literal", value: "Ignored" } }
          }]
        },
        {
          name: "Empty Patch",
          events: ["DocumentUpdated"],
          actions: [{
            kind: "updateDocument",
            target: { doctype: "Target", name: { kind: "field", field: "target" } },
            patch: { title: { kind: "field", field: "missing" } }
          }]
        }
      ]
    });

    expect(automationActionsFromDomainEvent({
      event: updatedEvent({ title: "Changed" }),
      snapshot: sourceSnapshot({ target: "Target One" }),
      rules: doctype.automationRules ?? []
    })).toEqual([]);
  });

  it("rejects invalid automation rule definitions", () => {
    expect(() => defineDocType({
      name: "Bad",
      fields: [{ name: "title", type: "text" }],
      automationRules: "bad"
    } as never)).toThrow("must be an array");
    expect(() => defineDocType({
      name: "Bad",
      fields: [{ name: "title", type: "text" }],
      automationRules: [
        { name: "Dup", events: ["DocumentUpdated"], actions: [updateSelfAction()] },
        { name: "Dup", events: ["DocumentUpdated"], actions: [updateSelfAction()] }
      ]
    })).toThrow("duplicated");
    expect(() => defineDocType({
      name: "Bad",
      fields: [{ name: "title", type: "text" }],
      automationRules: [{
        name: "Dup",
        events: ["DocumentUpdated", "DocumentUpdated"],
        actions: [updateSelfAction()]
      }]
    })).toThrow("duplicate");
    expect(() => defineDocType({
      name: "Bad",
      fields: [{ name: "title", type: "text" }],
      automationRules: [{
        name: "Dup",
        events: ["DocumentUpdated"],
        changedFields: ["title", "title"],
        actions: [updateSelfAction()]
      }]
    })).toThrow("duplicate");
    expect(() => defineDocType({
      name: "Bad",
      fields: [{ name: "title", type: "text" }],
      automationRules: [{
        name: "Empty",
        events: [],
        actions: [updateSelfAction()]
      }]
    })).toThrow("at least one");
    expect(() => defineDocType({
      name: "Bad",
      fields: [{ name: "title", type: "text" }],
      automationRules: [{
        name: "No Actions",
        events: ["DocumentUpdated"],
        actions: []
      }]
    })).toThrow("at least one");
    expect(() => defineDocType({
      name: "Bad",
      fields: [{ name: "title", type: "text" }],
      automationRules: [{
        name: "Bad Event",
        events: ["Unsupported"],
        actions: [updateSelfAction()]
      }]
    } as never)).toThrow("not supported");
    expect(() => defineDocType({
      name: "Bad",
      fields: [{ name: "title", type: "text" }],
      automationRules: [{
        name: "Bad Enabled",
        enabled: "yes",
        events: ["DocumentUpdated"],
        actions: [updateSelfAction()]
      }]
    } as never)).toThrow("must be a boolean");
    expect(() => defineDocType({
      name: "Bad",
      fields: [{ name: "title", type: "text" }],
      automationRules: [{
        name: "Bad Action",
        events: ["DocumentUpdated"],
        actions: [{ kind: "webhook" }]
      }]
    } as never)).toThrow("not supported");
    expect(() => defineDocType({
      name: "Bad",
      fields: [{ name: "title", type: "text" }],
      automationRules: [{
        name: "Bad Patch",
        events: ["DocumentUpdated"],
        actions: [{
          kind: "updateDocument",
          target: { doctype: "Target", name: { kind: "documentName" } },
          patch: []
        }]
      }]
    } as never)).toThrow("must be an object");
    expect(() => defineDocType({
      name: "Bad",
      fields: [{ name: "title", type: "text" }],
      automationRules: [{
        name: "Empty Patch",
        events: ["DocumentUpdated"],
        actions: [{
          kind: "updateDocument",
          target: { doctype: "Target", name: { kind: "documentName" } },
          patch: {}
        }]
      }]
    })).toThrow("at least one field");
    expect(() => defineDocType({
      name: "Bad",
      fields: [{ name: "title", type: "text" }],
      automationRules: [{
        name: "Bad Expression",
        events: ["DocumentUpdated"],
        actions: [{
          kind: "updateDocument",
          target: { doctype: "Target", name: { kind: "documentName" } },
          patch: { title: { kind: "unknown" } }
        }]
      }]
    } as never)).toThrow("expression is invalid");
    expect(() => defineDocType({
      name: "Bad",
      fields: [{ name: "title", type: "text" }],
      automationRules: [{
        name: " ",
        events: ["DocumentUpdated"],
        actions: [updateSelfAction()]
      }]
    })).toThrow("required");
  });
});

function updateSelfAction() {
  return {
    kind: "updateDocument" as const,
    target: { doctype: "Source", name: { kind: "documentName" as const } },
    patch: { title: { kind: "literal" as const, value: "Changed" } }
  };
}

function updatedEvent(patch: Record<string, unknown>, unset: readonly string[] = []): DomainEvent {
  return {
    id: "evt_source",
    tenantId: "acme",
    stream: "acme:Source:Source%20One",
    sequence: 2,
    type: "SourceUpdated",
    doctype: "Source",
    documentName: "Source One",
    actorId: "owner@example.com",
    occurredAt,
    payload: {
      kind: "DocumentUpdated",
      patch: patch as DomainEvent["payload"] extends { readonly patch: infer TPatch } ? TPatch : never,
      ...(unset.length === 0 ? {} : { unset })
    },
    metadata: {}
  } as DomainEvent;
}

function sourceSnapshot(data: Record<string, unknown>): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Source",
    name: "Source One",
    version: 2,
    docstatus: "draft",
    data: data as DocumentSnapshot["data"],
    createdAt: occurredAt,
    updatedAt: occurredAt
  };
}
