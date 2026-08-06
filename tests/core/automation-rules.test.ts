import {
  automationActionId,
  automationActionsFromDomainEvent,
  automationRuleMatches,
  defineDocType,
  documentChangeContext
} from "../../src";
import type {
  AutomationRuleDefinition,
  DomainEvent,
  DocumentData,
  DocumentSnapshot,
  PredicateExpression
} from "../../src";
import { owner } from "../helpers";
import { afterField } from "../predicate-fixtures.js";

const occurredAt = "2026-01-01T00:00:00.000Z";

describe("automation rules", () => {
  it("normalizes stable ids, matches semantic changes, and resolves snapshotted actions", () => {
    const doctype = defineDocType({
      name: "Source",
      fields: sourceFields(),
      automationRules: [{
        id: "mirror-status",
        name: "Mirror Status",
        trigger: {
          events: ["DocumentUpdated"],
          touchedFields: ["status"],
          changes: [{ field: "status", from: "Open", to: "Done" }]
        },
        runWhen: {
          kind: "group",
          match: "all",
          predicates: [
            afterField("status", "Done"),
            {
              kind: "compare",
              left: { kind: "path", scope: "actor", path: ["id"] },
              operator: "eq",
              right: { kind: "literal", value: owner.id }
            }
          ]
        },
        actions: [{
          id: "mirror",
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
    const before = sourceSnapshot({ status: "Open", target: "Target One" }, 1);
    const after = sourceSnapshot({ status: "Done", target: "Target One" }, 2);
    const event = updatedEvent({ status: "Done" });
    const context = {
      event,
      change: documentChangeContext(before, after, ["status"]),
      input: { status: "Done" },
      actor: owner
    };

    expect(Object.isFrozen(doctype.automationRules)).toBe(true);
    expect(Object.isFrozen(rule?.trigger.changes)).toBe(true);
    expect(Object.isFrozen(rule?.actions)).toBe(true);
    expect(rule === undefined ? undefined : automationRuleMatches(rule, context)).toBe(true);
    expect(automationActionsFromDomainEvent({
      ...context,
      rules: doctype.automationRules ?? []
    })).toEqual([{
      runId: "evt_source:mirror-status:mirror",
      ruleId: "mirror-status",
      ruleName: "Mirror Status",
      actionId: "mirror",
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
    expect(automationActionId("evt", "rule", "action")).toBe("evt:rule:action");
    expect(automationActionId("evt", "a:b", "c")).toBe("evt:a%3Ab:c");
    expect(automationActionId("evt", "a", "b:c")).toBe("evt:a:b%3Ac");
    expect(automationActionId("evt:a", "b", "c")).not.toBe(automationActionId("evt", "a:b", "c"));
  });

  it("distinguishes touched fields from semantic changes", () => {
    const doctype = defineDocType({
      name: "Source",
      fields: sourceFields(),
      automationRules: [
        ruleDefinition("touched", { events: ["DocumentUpdated"], touchedFields: ["status"] }),
        ruleDefinition("changed", { events: ["DocumentUpdated"], changes: [{ field: "status" }] })
      ]
    });
    const before = sourceSnapshot({ status: "Open", target: "Target One" }, 1);
    const after = sourceSnapshot({ status: "Open", target: "Target One" }, 2);
    const actions = automationActionsFromDomainEvent({
      event: updatedEvent({ status: "Open" }),
      change: documentChangeContext(before, after, ["status"]),
      input: { status: "Open" },
      actor: owner,
      rules: doctype.automationRules ?? []
    });

    expect(actions.map((action) => action.ruleId)).toEqual(["touched"]);
  });

  it("matches workflow and domain-command identities without treating them as predicates", () => {
    const workflowRule = defineDocType({
      name: "Source",
      fields: sourceFields(),
      automationRules: [{
        ...ruleDefinition("review-approved", {
          events: ["WorkflowTransitioned"],
          workflow: "review",
          workflowAction: "approve"
        })
      }]
    }).automationRules?.[0];
    const commandRule = defineDocType({
      name: "Source",
      fields: sourceFields(),
      automationRules: [{
        ...ruleDefinition("close-command", {
          events: ["DomainCommandApplied"],
          domainCommand: "close"
        })
      }]
    }).automationRules?.[0];
    const compositeWorkflowRule = defineDocType({
      name: "Source",
      fields: sourceFields(),
      automationRules: [{
        ...ruleDefinition("review-approved-by-command", {
          events: ["DomainCommandApplied"],
          workflow: "review",
          workflowAction: "approve"
        })
      }]
    }).automationRules?.[0];
    const before = sourceSnapshot({ status: "Open", target: "Target One" }, 1);
    const after = sourceSnapshot({ status: "Done", target: "Target One" }, 2);
    const change = documentChangeContext(before, after, ["status"]);

    expect(workflowRule === undefined ? false : automationRuleMatches(workflowRule, {
      event: workflowEvent("review", "approve"),
      change,
      input: { action: "approve" },
      actor: owner
    })).toBe(true);
    expect(workflowRule === undefined ? true : automationRuleMatches(workflowRule, {
      event: workflowEvent("lifecycle", "approve"),
      change,
      input: { action: "approve" },
      actor: owner
    })).toBe(false);
    expect(commandRule === undefined ? false : automationRuleMatches(commandRule, {
      event: domainCommandEvent("close"),
      change,
      input: {},
      actor: owner
    })).toBe(true);
    expect(compositeWorkflowRule === undefined ? false : automationRuleMatches(compositeWorkflowRule, {
      event: domainCommandEvent("ship", [
        { workflow: "lifecycle", stateField: "lifecycle_state", action: "finish", from: "Open", to: "Done" },
        { workflow: "review", stateField: "review_state", action: "approve", from: "Pending", to: "Approved" }
      ]),
      change,
      input: {},
      actor: owner
    })).toBe(true);
    expect(compositeWorkflowRule === undefined ? true : automationRuleMatches(compositeWorkflowRule, {
      event: domainCommandEvent("ship", [
        { workflow: "review", stateField: "review_state", action: "reject", from: "Pending", to: "Rejected" }
      ]),
      change,
      input: {},
      actor: owner
    })).toBe(false);
  });

  it("does not match disabled rules, unsupported events, false predicates, or deleted snapshots", () => {
    const falsePredicate: PredicateExpression = afterField("status", "Done");
    const rules = defineDocType({
      name: "Source",
      fields: sourceFields(),
      automationRules: [
        { ...ruleDefinition("disabled", { events: ["DocumentUpdated"] }), enabled: false },
        { ...ruleDefinition("condition", { events: ["DocumentUpdated"] }), runWhen: falsePredicate }
      ]
    }).automationRules ?? [];
    const before = sourceSnapshot({ status: "Open" }, 1);
    const after = sourceSnapshot({ status: "Open" }, 2);
    const context = {
      change: documentChangeContext(before, after, ["title"]),
      input: { title: "Changed" },
      actor: owner,
      rules
    };

    expect(automationActionsFromDomainEvent({ ...context, event: updatedEvent({ title: "Changed" }) })).toEqual([]);
    expect(automationActionsFromDomainEvent({
      ...context,
      event: { ...updatedEvent({}), payload: { kind: "DocumentCommentAdded", text: "No automation" } } as DomainEvent
    })).toEqual([]);
    expect(automationActionsFromDomainEvent({
      ...context,
      event: updatedEvent({ title: "Changed" }),
      change: documentChangeContext(before, { ...after, docstatus: "deleted" }, ["title"])
    })).toEqual([]);
  });

  it("skips actions when target names or patches resolve empty", () => {
    const doctype = defineDocType({
      name: "Source",
      fields: sourceFields(),
      automationRules: [
        {
          ...ruleDefinition("missing-target", { events: ["DocumentUpdated"] }),
          actions: [{
            id: "update",
            kind: "updateDocument",
            target: { doctype: "Target", name: { kind: "field", field: "missing" } },
            patch: { title: { kind: "literal", value: "Ignored" } }
          }]
        },
        {
          ...ruleDefinition("empty-patch", { events: ["DocumentUpdated"] }),
          actions: [{
            id: "update",
            kind: "updateDocument",
            target: { doctype: "Target", name: { kind: "field", field: "target" } },
            patch: { title: { kind: "field", field: "missing" } }
          }]
        }
      ]
    });
    const before = sourceSnapshot({ target: "Target One" }, 1);
    const after = sourceSnapshot({ target: "Target One" }, 2);

    expect(automationActionsFromDomainEvent({
      event: updatedEvent({ title: "Changed" }),
      change: documentChangeContext(before, after, ["title"]),
      input: { title: "Changed" },
      actor: owner,
      rules: doctype.automationRules ?? []
    })).toEqual([]);
  });

  it("rejects removed contracts and invalid stable ids, triggers, selectors, and actions", () => {
    expect(() => defineDocType({
      name: "Bad",
      fields: [{ name: "title", type: "text" }],
      automationRules: "bad"
    } as never)).toThrow("must be an array");
    expect(() => badDocType([
      ruleDefinition("dup", { events: ["DocumentUpdated"] }),
      ruleDefinition("dup", { events: ["DocumentUpdated"] })
    ])).toThrow("id 'dup' is duplicated");
    expect(() => badDocType([
      { ...ruleDefinition("first", { events: ["DocumentUpdated"] }), name: "Same name" },
      { ...ruleDefinition("second", { events: ["DocumentUpdated"] }), name: "Same name" }
    ])).toThrow("name 'Same name' is duplicated");
    expect(() => badDocType([null] as never)).toThrow("must be an object");
    expect(() => badDocType([{
      ...ruleDefinition("bad id", { events: ["DocumentUpdated"] })
    }])).toThrow("stable identifier");
    expect(() => badDocType([{
      ...ruleDefinition("enabled", { events: ["DocumentUpdated"] }),
      enabled: "yes"
    } as never])).toThrow("must be a boolean");
    expect(() => badDocType([{
      ...ruleDefinition("empty-events", { events: ["DocumentUpdated"] }),
      trigger: { events: [] }
    }])).toThrow("at least one event kind");
    expect(() => badDocType([{
      ...ruleDefinition("bad-event", { events: ["DocumentUpdated"] }),
      trigger: { events: ["UnknownEvent"] }
    } as never])).toThrow("is not supported");
    expect(() => badDocType([{
      ...ruleDefinition("event", { events: ["DocumentUpdated"] }),
      trigger: { events: ["DocumentUpdated", "DocumentUpdated"] }
    }])).toThrow("duplicate");
    expect(() => badDocType([{
      ...ruleDefinition("workflow-action", { events: ["DomainCommandApplied"] }),
      trigger: { events: ["DomainCommandApplied"], workflowAction: "approve" }
    }])).toThrow("requires workflow");
    expect(() => badDocType([{
      ...ruleDefinition("empty-touched", { events: ["DocumentUpdated"] }),
      trigger: { events: ["DocumentUpdated"], touchedFields: [] }
    }])).toThrow("touchedFields must contain at least one field");
    expect(() => badDocType([{
      ...ruleDefinition("field", { events: ["DocumentUpdated"] }),
      trigger: { events: ["DocumentUpdated"], touchedFields: ["missing"] }
    }])).toThrow("not defined on Bad");
    expect(() => badDocType([{
      ...ruleDefinition("bad-change", { events: ["DocumentUpdated"] }),
      trigger: { events: ["DocumentUpdated"], changes: [null] }
    } as never])).toThrow("must be an object");
    expect(() => badDocType([{
      ...ruleDefinition("workflow", { events: ["DocumentUpdated"] }),
      trigger: { events: ["DocumentUpdated"], workflow: "review" }
    }])).toThrow("require WorkflowTransitioned");
    expect(() => badDocType([{
      ...ruleDefinition("command", { events: ["DocumentUpdated"] }),
      trigger: { events: ["DocumentUpdated"], domainCommand: "close" }
    }])).toThrow("requires DomainCommandApplied");
    expect(() => badDocType([{
      ...ruleDefinition("actions", { events: ["DocumentUpdated"] }),
      actions: [updateSelfAction("same"), updateSelfAction("same")]
    }])).toThrow("action id 'same' is duplicated");
    expect(() => badDocType([{
      ...ruleDefinition("empty-actions", { events: ["DocumentUpdated"] }),
      actions: []
    }])).toThrow("at least one action");
    expect(() => badDocType([{
      ...ruleDefinition("bad-action", { events: ["DocumentUpdated"] }),
      actions: [{ id: "send", kind: "sendEmail" }]
    } as never])).toThrow("is not supported");
    expect(() => badDocType([{
      ...ruleDefinition("empty-patch", { events: ["DocumentUpdated"] }),
      actions: [{
        id: "update",
        kind: "updateDocument",
        target: { doctype: "Bad", name: { kind: "documentName" } },
        patch: {}
      }]
    }])).toThrow("patch must contain at least one field");
    expect(() => badDocType([{
      ...ruleDefinition("old", { events: ["DocumentUpdated"] }),
      trigger: undefined,
      events: ["DocumentUpdated"],
      changedFields: ["title"],
      condition: afterField("title", "x")
    } as never])).toThrow("trigger must be an object");
  });

  it("enforces configurable Automation rule and action bounds", () => {
    expect(() => defineDocType({
      name: "Bounded Rules",
      fields: sourceFields(),
      automationRules: [
        ruleDefinition("first", { events: ["DocumentUpdated"] }),
        ruleDefinition("second", { events: ["DocumentUpdated"] })
      ]
    }, { automationLimits: { maxRules: 1 } })).toThrow("cannot define more than 1 Automation rules");

    expect(() => defineDocType({
      name: "Bounded Actions",
      fields: sourceFields(),
      automationRules: [{
        ...ruleDefinition("bounded", { events: ["DocumentUpdated"] }),
        actions: [updateSelfAction("first"), updateSelfAction("second")]
      }]
    }, { automationLimits: { maxActionsPerRule: 1 } })).toThrow("cannot define more than 1 actions");

    expect(() => defineDocType({
      name: "Invalid Bounds",
      fields: sourceFields(),
      automationRules: [ruleDefinition("only", { events: ["DocumentUpdated"] })]
    }, { automationLimits: { maxRules: 0 } })).toThrow("must be a positive integer");
  });
});

function sourceFields() {
  return [
    { name: "title", type: "text" as const },
    { name: "target", type: "text" as const },
    { name: "status", type: "select" as const, options: ["Open", "Done"] },
    { name: "missing", type: "text" as const }
  ];
}

function ruleDefinition(
  id: string,
  trigger: AutomationRuleDefinition["trigger"]
): AutomationRuleDefinition {
  return {
    id,
    name: id,
    trigger,
    actions: [updateSelfAction("update")]
  };
}

function updateSelfAction(id: string) {
  return {
    id,
    kind: "updateDocument" as const,
    target: { doctype: "Source", name: { kind: "documentName" as const } },
    patch: { title: { kind: "literal" as const, value: "Changed" } }
  };
}

function badDocType(automationRules: readonly AutomationRuleDefinition[]) {
  return defineDocType({
    name: "Bad",
    fields: [{ name: "title", type: "text" }],
    automationRules
  });
}

function updatedEvent(patch: DocumentData): DomainEvent {
  return {
    id: "evt_source",
    tenantId: "acme",
    stream: "acme:Source:Source%20One",
    sequence: 2,
    type: "SourceUpdated",
    doctype: "Source",
    documentName: "Source One",
    actorId: owner.id,
    occurredAt,
    payload: { kind: "DocumentUpdated", patch },
    metadata: {}
  } as DomainEvent;
}

function workflowEvent(workflow: string, action: string): DomainEvent {
  return {
    ...updatedEvent({ status: "Done" }),
    payload: {
      kind: "WorkflowTransitioned",
      workflow,
      stateField: "status",
      action,
      from: "Open",
      to: "Done",
      patch: { status: "Done" }
    }
  } as unknown as DomainEvent;
}

function domainCommandEvent(
  command: string,
  transitions: readonly {
    readonly workflow: string;
    readonly stateField: string;
    readonly action: string;
    readonly from: string;
    readonly to: string;
  }[] = []
): DomainEvent {
  return {
    ...updatedEvent({ status: "Done" }),
    payload: { kind: "DomainCommandApplied", command, input: {}, patch: { status: "Done" }, transitions }
  } as DomainEvent;
}

function sourceSnapshot(data: DocumentData, version: number): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Source",
    name: "Source One",
    version,
    docstatus: "draft",
    data,
    createdAt: occurredAt,
    updatedAt: occurredAt
  };
}
