import {
  assignmentRuleAssignmentsFromDomainEvent,
  createDocumentAssignmentRuleHooks,
  createRegistry,
  defineDocType,
  deterministicIds,
  DocumentService,
  fixedClock,
  foldDocumentAssignments,
  InMemoryDocumentStore,
  documentStream
} from "../../src";
import { manager, now, owner } from "../helpers";
import type { DocTypeDefinition, DocumentSnapshot, DomainEvent } from "../../src";

describe("assignment rules", () => {
  it("normalizes assignment rule metadata on DocTypes", () => {
    const doctype = defineDocType({
      name: "Ticket",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "priority", type: "select", options: ["Low", "High"] },
        { name: "reviewer", type: "text" }
      ],
      permissions: [{ roles: ["User"], actions: ["read", "create"] }],
      assignmentRules: [
        {
          name: "High priority triage",
          events: ["DocumentCreated"],
          assignees: [
            { kind: "user", userId: " manager@example.com " },
            { kind: "field", field: "reviewer" }
          ],
          condition: { field: "priority", value: "High" }
        }
      ]
    });

    expect(doctype.assignmentRules).toEqual([
      {
        name: "High priority triage",
        events: ["DocumentCreated"],
        assignees: [
          { kind: "user", userId: "manager@example.com" },
          { kind: "field", field: "reviewer" }
        ],
        condition: { field: "priority", value: "High" }
      }
    ]);
    expect(Object.isFrozen(doctype.assignmentRules)).toBe(true);
  });

  it("rejects assignment rules with invalid event and assignee metadata", () => {
    expect(() =>
      defineDocType({
        name: "Ticket",
        fields: [
          { name: "title", type: "text" },
          { name: "count", type: "integer" }
        ],
        assignmentRules: [
          {
            name: "Bad field",
            events: ["DocumentCreated"],
            assignees: [{ kind: "field", field: "count" }]
          }
        ]
      })
    ).toThrow(expect.objectContaining({ code: "ASSIGNMENT_RULE_INVALID" }));

    expect(() =>
      defineDocType({
        name: "Ticket",
        fields: [{ name: "title", type: "text" }],
        assignmentRules: [
          {
            name: "Bad event",
            events: ["DocumentAssigned" as never],
            assignees: [{ kind: "user", userId: "manager@example.com" }]
          }
        ]
      })
    ).toThrow(expect.objectContaining({ code: "ASSIGNMENT_RULE_INVALID" }));
  });

  it("assigns matching documents through afterCommit hooks", async () => {
    const doctype = ticketDocType({
      assignmentRules: [
        {
          name: "High priority triage",
          events: ["DocumentCreated"],
          assignees: [
            { kind: "user", userId: "manager@example.com" },
            { kind: "field", field: "reviewer" }
          ],
          condition: { field: "priority", value: "High" }
        }
      ]
    });
    const registry = createRegistry({ doctypes: [doctype] });
    const store = new InMemoryDocumentStore();
    let documents: DocumentService;
    const hooks = createDocumentAssignmentRuleHooks({
      documents: { assign: (command) => documents.assign(command) },
      actor: manager
    });
    documents = new DocumentService({
      registry,
      store,
      ids: deterministicIds(["create-1", "assign-1", "assign-2"]),
      clock: fixedClock(now),
      ...(hooks.afterCommit === undefined ? {} : { afterCommit: hooks.afterCommit })
    });

    const created = await documents.create({
      actor: owner,
      doctype: "Ticket",
      data: { title: "Escalated", priority: "High", reviewer: "reviewer@example.com" }
    });

    const events = await store.readStream(documentStream("acme", "Ticket", "Escalated"));
    expect(created.version).toBe(3);
    expect(foldDocumentAssignments(events)).toEqual(["manager@example.com", "reviewer@example.com"]);
    expect(events).toMatchObject([
      { payload: { kind: "DocumentCreated" } },
      {
        payload: { kind: "DocumentAssigned", assigneeId: "manager@example.com" },
        metadata: {
          sourceEventId: "evt_create-1",
          sourcePayloadKind: "DocumentCreated",
          assignmentRuleName: "High priority triage"
        }
      },
      {
        payload: { kind: "DocumentAssigned", assigneeId: "reviewer@example.com" },
        metadata: {
          sourceEventId: "evt_create-1",
          sourcePayloadKind: "DocumentCreated",
          assignmentRuleName: "High priority triage"
        }
      }
    ]);
  });

  it("evaluates update conditions and avoids duplicate assignment events", async () => {
    const doctype = ticketDocType({
      assignmentRules: [
        {
          name: "Ready for review",
          events: ["DocumentUpdated"],
          assignees: [{ kind: "field", field: "reviewer" }],
          condition: {
            kind: "group",
            match: "all",
            filters: [
              { field: "priority", value: "High" },
              { field: "status", value: "Ready" }
            ]
          }
        }
      ]
    });
    const registry = createRegistry({ doctypes: [doctype] });
    const store = new InMemoryDocumentStore();
    let documents: DocumentService;
    const hooks = createDocumentAssignmentRuleHooks({
      documents: { assign: (command) => documents.assign(command) },
      actor: () => manager
    });
    documents = new DocumentService({
      registry,
      store,
      ids: deterministicIds(["create-1", "update-1", "assign-1", "update-2"]),
      clock: fixedClock(now),
      ...(hooks.afterCommit === undefined ? {} : { afterCommit: hooks.afterCommit })
    });

    await documents.create({
      actor: owner,
      doctype: "Ticket",
      data: { title: "Feature", priority: "Low", status: "Open", reviewer: "reviewer@example.com" }
    });
    const ready = await documents.update({
      actor: owner,
      doctype: "Ticket",
      name: "Feature",
      patch: { priority: "High", status: "Ready" },
      expectedVersion: 1
    });
    await documents.update({
      actor: owner,
      doctype: "Ticket",
      name: "Feature",
      patch: { status: "Ready" },
      expectedVersion: 3
    });

    const events = await store.readStream(documentStream("acme", "Ticket", "Feature"));
    expect(ready.version).toBe(3);
    expect(foldDocumentAssignments(events)).toEqual(["reviewer@example.com"]);
    expect(events.filter((event) => event.payload.kind === "DocumentAssigned")).toHaveLength(1);
  });

  it("skips disabled rules, actor exclusions, and duplicate assignees across matching rules", async () => {
    const doctype = ticketDocType({
      assignmentRules: [
        {
          name: "Disabled manager",
          enabled: false,
          events: ["DocumentCreated"],
          assignees: [{ kind: "user", userId: "manager@example.com" }]
        },
        {
          name: "Do not assign creator",
          excludeActor: true,
          events: ["DocumentCreated"],
          assignees: [{ kind: "user", userId: owner.id }]
        },
        {
          name: "Reviewer primary",
          events: ["DocumentCreated"],
          assignees: [{ kind: "field", field: "reviewer" }]
        },
        {
          name: "Reviewer fallback",
          events: ["DocumentCreated"],
          assignees: [{ kind: "user", userId: "reviewer@example.com" }]
        }
      ]
    });
    const registry = createRegistry({ doctypes: [doctype] });
    const store = new InMemoryDocumentStore();
    let documents: DocumentService;
    const hooks = createDocumentAssignmentRuleHooks({
      documents: { assign: (command) => documents.assign(command) },
      actor: manager
    });
    documents = new DocumentService({
      registry,
      store,
      ids: deterministicIds(["create-1", "assign-1"]),
      clock: fixedClock(now),
      ...(hooks.afterCommit === undefined ? {} : { afterCommit: hooks.afterCommit })
    });

    const created = await documents.create({
      actor: owner,
      doctype: "Ticket",
      data: { title: "Selective", reviewer: "reviewer@example.com" }
    });

    const events = await store.readStream(documentStream("acme", "Ticket", "Selective"));
    expect(created.version).toBe(2);
    expect(foldDocumentAssignments(events)).toEqual(["reviewer@example.com"]);
    expect(events.filter((event) => event.payload.kind === "DocumentAssigned")).toEqual([
      expect.objectContaining({
        payload: { kind: "DocumentAssigned", assigneeId: "reviewer@example.com" },
        metadata: expect.objectContaining({ assignmentRuleName: "Reviewer primary" })
      })
    ]);
  });

  it("evaluates lifecycle, workflow, and domain-command event kinds", () => {
    for (const kind of ["DocumentSubmitted", "DocumentCancelled", "WorkflowTransitioned", "DomainCommandApplied"] as const) {
      expect(
        assignmentRuleAssignmentsFromDomainEvent({
          event: ticketEvent(kind),
          snapshot: ticketSnapshot(),
          rules: [
            {
              name: `${kind} reviewer`,
              events: [kind],
              assignees: [{ kind: "user", userId: "reviewer@example.com" }]
            }
          ]
        })
      ).toEqual([{ assigneeId: "reviewer@example.com", ruleName: `${kind} reviewer` }]);
    }
  });

  it("does not assign when the source event has no live document snapshot", () => {
    expect(
      assignmentRuleAssignmentsFromDomainEvent({
        event: ticketEvent("DocumentCreated"),
        snapshot: null,
        rules: [{ name: "No snapshot", events: ["DocumentCreated"], assignees: [{ kind: "user", userId: "reviewer@example.com" }] }]
      })
    ).toEqual([]);
    expect(
      assignmentRuleAssignmentsFromDomainEvent({
        event: ticketEvent("DocumentCreated"),
        snapshot: { ...ticketSnapshot(), docstatus: "deleted" },
        rules: [{ name: "Deleted", events: ["DocumentCreated"], assignees: [{ kind: "user", userId: "reviewer@example.com" }] }]
      })
    ).toEqual([]);
  });

  it("routes assignment errors to the configured handler", async () => {
    const doctype = ticketDocType({
      permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }],
      assignmentRules: [
        {
          name: "Needs manager",
          events: ["DocumentCreated"],
          assignees: [{ kind: "user", userId: "manager@example.com" }]
        }
      ]
    });
    const registry = createRegistry({ doctypes: [doctype] });
    const store = new InMemoryDocumentStore();
    const errors: unknown[] = [];
    let documents: DocumentService;
    const hooks = createDocumentAssignmentRuleHooks({
      documents: { assign: (command) => documents.assign(command) },
      actor: owner,
      onAssignmentError(error) {
        errors.push(error);
      }
    });
    documents = new DocumentService({
      registry,
      store,
      ids: deterministicIds(["create-1"]),
      clock: fixedClock(now),
      ...(hooks.afterCommit === undefined ? {} : { afterCommit: hooks.afterCommit })
    });

    await documents.create({ actor: owner, doctype: "Ticket", data: { title: "Unassignable" } });

    expect(errors).toEqual([expect.objectContaining({ code: "PERMISSION_DENIED" })]);
    await expect(store.readStream(documentStream("acme", "Ticket", "Unassignable"))).resolves.toHaveLength(1);
  });
});

function ticketDocType(
  overrides: Partial<DocTypeDefinition> = {}
): DocTypeDefinition {
  return defineDocType({
    name: "Ticket",
    naming: { kind: "field", field: "title" },
    fields: [
      { name: "title", type: "text", required: true },
      { name: "priority", type: "select", options: ["Low", "High"], defaultValue: "Low" },
      { name: "status", type: "select", options: ["Open", "Ready"], defaultValue: "Open" },
      { name: "reviewer", type: "text" },
      { name: "created_by", type: "text", readOnly: true, defaultValue: ({ actor }) => actor.id }
    ],
    permissions: [
      {
        roles: ["User"],
        actions: ["read", "create", "update"],
        when: ({ actor, document }) => !document || document.data.created_by === actor.id
      },
      { roles: ["Task Manager"], actions: ["read", "create", "update", "assign"] }
    ],
    ...overrides
  });
}

function ticketSnapshot(): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Ticket",
    name: "Feature",
    version: 2,
    docstatus: "draft",
    data: { title: "Feature", priority: "High", status: "Ready", reviewer: "reviewer@example.com" },
    createdAt: now,
    updatedAt: now
  };
}

function ticketEvent(kind: DomainEvent["payload"]["kind"]): DomainEvent {
  return {
    id: `evt_${kind}`,
    tenantId: "acme",
    stream: documentStream("acme", "Ticket", "Feature"),
    sequence: 2,
    type: `Ticket${kind}`,
    doctype: "Ticket",
    documentName: "Feature",
    actorId: owner.id,
    occurredAt: now,
    payload: ticketPayload(kind),
    metadata: {}
  };
}

function ticketPayload(kind: DomainEvent["payload"]["kind"]): DomainEvent["payload"] {
  switch (kind) {
    case "DocumentCreated":
      return { kind, data: { title: "Feature" }, docstatus: "draft" };
    case "DocumentSubmitted":
    case "DocumentCancelled":
      return { kind };
    case "WorkflowTransitioned":
      return { kind, action: "review", from: "Open", to: "Ready", patch: { status: "Ready" } };
    case "DomainCommandApplied":
      return { kind, command: "markReady", input: {}, patch: { status: "Ready" } };
    default:
      throw new Error(`Unsupported ticket event kind '${kind}'`);
  }
}
