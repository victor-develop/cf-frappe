import { describe, expect, it } from "vitest";

import {
  AuditService,
  createRegistry,
  defineDocType,
  deterministicIds,
  DocumentService,
  fixedClock,
    InMemoryDocumentStore,
    namedWorkflowStateFieldStream,
    namedWorkflowStream,
  QueryService,
  SYSTEM_MANAGER_ROLE,
  WorkflowService,
  type DocTypeDefinition,
  type NamedWorkflowDefinition
} from "../../src";
import { data, noteDocType, now, owner } from "../helpers";

const admin = {
  id: "admin@example.com",
  roles: [SYSTEM_MANAGER_ROLE, "User"],
  tenantId: "acme"
};

const overrideWorkflow = {
  name: "lifecycle",
  label: "Lifecycle",
  stateField: "workflow_state",
  initialState: "Open",
  states: ["Open", "Closed"],
  transitions: [{ action: "approve", from: "Open", to: "Closed", roles: ["User"], eventType: "NoteApproved" }]
} satisfies NamedWorkflowDefinition;

describe("WorkflowService", () => {
  it("does not read or replay pre-cutover Workflow definition history", async () => {
    const events = new InMemoryDocumentStore();
    await events.append("acme:__WorkflowDefinitions", 0, [{
      id: "legacy-workflow-1",
      tenantId: "acme",
      stream: "acme:__WorkflowDefinitions",
      type: "WorkflowDefinitionSaved",
      doctype: "__WorkflowDefinitions",
      documentName: "Note",
      actorId: admin.id,
      occurredAt: now,
      payload: {
        kind: "WorkflowDefinitionSaved",
        doctypeName: "Note",
        workflow: { stateField: "workflow_state", initialState: "Open" }
      },
      metadata: {}
    } as never]);
    const service = workflowService(events, ["unused"]);

    await expect(service.list(admin, "Note")).resolves.toMatchObject([{
      workflowName: "lifecycle",
      version: 0,
      workflow: { transitions: [{ action: "close" }] }
    }]);
    await expect(service.effectiveDocType("Note", "acme")).resolves.toMatchObject({
      workflows: [{ name: "lifecycle", transitions: [{ action: "close" }] }]
    });
  });

  it("saves, gets, lists, clears, and audits resource-local definitions", async () => {
    const events = new InMemoryDocumentStore();
    const service = workflowService(events, ["workflow-1", "workflow-2"]);

    const saved = await service.save({
      actor: admin,
      doctype: "Note",
      workflow: overrideWorkflow,
      expectedVersion: 0
    });
    const repeated = await service.save({
      actor: admin,
      doctype: "Note",
      workflow: { ...overrideWorkflow },
      expectedVersion: 1
    });
    const listed = await service.list(admin, "Note");
    const cleared = await service.clear({
      actor: admin,
      doctype: "Note",
      workflowName: "lifecycle",
      expectedVersion: 1
    });

    expect(saved).toMatchObject({ workflowName: "lifecycle", version: 1, workflow: overrideWorkflow });
    expect(repeated.version).toBe(1);
    expect(listed).toHaveLength(1);
    await expect(service.get(admin, "Note", "lifecycle")).resolves.toMatchObject({ version: 2, cleared: true });
    expect(cleared.workflow).toBeUndefined();
    await expect(events.readStream(namedWorkflowStream("acme", "Note", "lifecycle"))).resolves.toMatchObject([
      { id: "evt_workflow-1", payload: { kind: "NamedWorkflowSaved", workflowName: "lifecycle" } },
      { id: "evt_workflow-2", payload: { kind: "NamedWorkflowCleared", workflowName: "lifecycle" } }
    ]);
    await expect(new AuditService({ events }).search(admin, { kind: "NamedWorkflowSaved" })).resolves.toMatchObject({
      events: [{ payload: { kind: "NamedWorkflowSaved", workflow: { name: "lifecycle" } } }]
    });
    await expect(service.effectiveDocType("Note", "acme")).resolves.toMatchObject({ workflows: undefined });
  });

  it("keeps expected versions independent across workflow resources", async () => {
    const events = new InMemoryDocumentStore();
    const service = workflowService(events, ["workflow-1", "workflow-2"]);
    const review = workflowFor("review", "review_state");
    const approval = workflowFor("approval", "approval_state");
    const Ticket = defineDocType({
      name: "Ticket",
      fields: [
        { name: "review_state", type: "select", options: ["Open", "Closed"] },
        { name: "approval_state", type: "select", options: ["Open", "Closed"] }
      ]
    });
    const isolated = new WorkflowService({
      registry: createRegistry({ doctypes: [Ticket] }),
      events,
      ids: deterministicIds(["workflow-1", "workflow-2"]),
      clock: fixedClock(now)
    });

    const [savedReview, savedApproval] = await Promise.all([
      isolated.save({ actor: admin, doctype: "Ticket", workflow: review, expectedVersion: 0 }),
      isolated.save({ actor: admin, doctype: "Ticket", workflow: approval, expectedVersion: 0 })
    ]);
    expect(savedReview).toMatchObject({ workflowName: "review", version: 1 });
    expect(savedApproval).toMatchObject({ workflowName: "approval", version: 1 });
    expect(await events.listStreams({ tenantId: "acme", doctype: "__NamedWorkflows" })).toHaveLength(2);
    expect(await service.list(admin, "Note")).toHaveLength(1);
  });

  it("atomically arbitrates concurrent state-field claims and releases ownership on clear", async () => {
    const events = new InMemoryDocumentStore();
    const Ticket = defineDocType({
      name: "Ticket",
      fields: [{ name: "shared_state", type: "select", options: ["Open", "Closed"] }]
    });
    const registry = createRegistry({ doctypes: [Ticket] });
    const first = new WorkflowService({
      registry,
      events,
      ids: deterministicIds(["review-save", "review-clear"]),
      clock: fixedClock(now)
    });
    const second = new WorkflowService({
      registry,
      events,
      ids: deterministicIds(["approval-save", "approval-retry"]),
      clock: fixedClock(now)
    });

    const raced = await Promise.allSettled([
      first.save({ actor: admin, doctype: "Ticket", workflow: workflowFor("review", "shared_state") }),
      second.save({ actor: admin, doctype: "Ticket", workflow: workflowFor("approval", "shared_state") })
    ]);
    expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(raced.filter((result) => result.status === "rejected")).toMatchObject([{
      reason: { code: "DOCUMENT_CONFLICT" }
    }]);

    const owner = raced[0]?.status === "fulfilled" ? "review" : "approval";
    const ownerService = owner === "review" ? first : second;
    const nextService = owner === "review" ? second : first;
    const nextWorkflow = owner === "review" ? "approval" : "review";
    await ownerService.clear({ actor: admin, doctype: "Ticket", workflowName: owner, expectedVersion: 1 });
    await expect(nextService.save({
      actor: admin,
      doctype: "Ticket",
      workflow: workflowFor(nextWorkflow, "shared_state"),
      expectedVersion: 0
    })).resolves.toMatchObject({ workflowName: nextWorkflow, version: 1 });

    await expect(events.readStream(namedWorkflowStateFieldStream("acme", "Ticket", "shared_state")))
      .resolves.toMatchObject([
        { payload: { kind: "NamedWorkflowFieldClaimed", workflowName: owner } },
        { payload: { kind: "NamedWorkflowFieldReleased", workflowName: owner } },
        { payload: { kind: "NamedWorkflowFieldClaimed", workflowName: nextWorkflow } }
      ]);
  });

  it("rejects runtime workflows that duplicate effective state-field ownership before append", async () => {
    const events = new InMemoryDocumentStore();
    const Ticket = defineDocType({
      name: "Ticket",
      fields: [
        { name: "state", type: "select", options: ["Open", "Closed"] },
        { name: "review_state", type: "select", options: ["Open", "Closed"] }
      ],
      workflows: [workflowFor("lifecycle", "state")]
    });
    const service = new WorkflowService({
      registry: createRegistry({ doctypes: [Ticket] }),
      events,
      ids: deterministicIds(["unused-workflow"]),
      clock: fixedClock(now)
    });

    await expect(service.save({
      actor: admin,
      doctype: "Ticket",
      workflow: workflowFor("review", "state")
    })).rejects.toMatchObject({
      code: "WORKFLOW_INVALID",
      message: "Workflow state field 'state' is owned by more than one workflow"
    });
    await expect(events.readStream(namedWorkflowStream("acme", "Ticket", "review"))).resolves.toHaveLength(0);
  });

  it("requires admin authority, tenant ownership, and expected versions", async () => {
    const service = workflowService(new InMemoryDocumentStore(), ["workflow-1"]);

    await expect(service.save({ actor: owner, doctype: "Note", workflow: overrideWorkflow }))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(service.save({ actor: admin, tenantId: "globex", doctype: "Note", workflow: overrideWorkflow }))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(service.save({ actor: admin, doctype: "Note", workflow: overrideWorkflow, expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
  });

  it("validates state fields against upstream metadata overlays", async () => {
    const Ticket = defineDocType({ name: "Ticket", fields: [{ name: "title", type: "text", required: true }] });
    const service = new WorkflowService({
      registry: createRegistry({ doctypes: [Ticket] }),
      events: new InMemoryDocumentStore(),
      ids: deterministicIds(["workflow-1"]),
      clock: fixedClock(now),
      preWorkflowDocTypeResolver: (base) => ({
        ...base,
        fields: [...base.fields, { name: "runtime_state", type: "select", options: ["Todo", "Done"] }]
      })
    });

    await expect(service.save({
      actor: admin,
      doctype: "Ticket",
      workflow: {
        name: "runtime",
        stateField: "runtime_state",
        initialState: "Todo",
        states: ["Todo", "Done"],
        transitions: [{ action: "finish", from: "Todo", to: "Done" }]
      }
    })).resolves.toMatchObject({ workflowName: "runtime", workflow: { stateField: "runtime_state" } });
    await expect(service.effectiveDocType("Ticket", "acme")).resolves.toMatchObject({
      fields: expect.arrayContaining([expect.objectContaining({ name: "runtime_state" })]),
      workflows: [expect.objectContaining({ name: "runtime", stateField: "runtime_state" })]
    });
  });

  it("rejects administrator-hidden state fields and unknown or disabled transition roles", async () => {
    const RestrictedTicket = defineDocType({
      name: "Restricted Ticket",
      fields: [{
        name: "private_state",
        type: "select",
        options: ["Open", "Closed"],
        permissions: [{ roles: ["Field Administrator"], actions: ["read"] }]
      }],
      permissions: [{ roles: [SYSTEM_MANAGER_ROLE], actions: ["read"] }]
    });
    const events = new InMemoryDocumentStore();
    const service = new WorkflowService({
      registry: createRegistry({ doctypes: [RestrictedTicket] }),
      events,
      ids: deterministicIds(["workflow-1"]),
      clock: fixedClock(now),
      adminRoles: ["Workflow Manager"],
      roleResolver: async () => [
        { name: "Reviewer", enabled: true },
        { name: "Suspended Reviewer", enabled: false }
      ]
    });
    const workflowAdmin = { id: "workflow@example.com", roles: ["Workflow Manager"], tenantId: "acme" };
    const workflow = (role: string): NamedWorkflowDefinition => ({
      name: "review",
      stateField: "private_state",
      initialState: "Open",
      states: ["Open", "Closed"],
      transitions: [{ action: "approve", from: "Open", to: "Closed", roles: [role] }]
    });

    await expect(service.save({ actor: workflowAdmin, doctype: "Restricted Ticket", workflow: workflow("Reviewer") }))
      .rejects.toMatchObject({ code: "WORKFLOW_INVALID", message: expect.stringContaining("is not defined") });

    const visibleAdmin = { ...workflowAdmin, roles: [...workflowAdmin.roles, "Field Administrator"] };
    await expect(service.save({ actor: visibleAdmin, doctype: "Restricted Ticket", workflow: workflow("Ghost") }))
      .rejects.toMatchObject({ code: "WORKFLOW_INVALID", message: "Workflow role 'Ghost' is not defined" });
    await expect(service.save({
      actor: visibleAdmin,
      doctype: "Restricted Ticket",
      workflow: workflow("Suspended Reviewer")
    })).rejects.toMatchObject({
      code: "WORKFLOW_INVALID",
      message: "Workflow role 'Suspended Reviewer' is disabled"
    });
    await expect(events.listStreams({ tenantId: "acme", doctype: "__NamedWorkflows" })).resolves.toEqual([]);
  });

  it("feeds runtime overrides into workflow-qualified document transitions", async () => {
    const registry = createRegistry({ doctypes: [noteDocType] });
    const store = new InMemoryDocumentStore();
    const workflows = new WorkflowService({
      registry,
      events: store,
      ids: deterministicIds(["workflow-1"]),
      clock: fixedClock(now)
    });
    const doctypeResolver = (base: DocTypeDefinition, context: { readonly tenantId: string }) =>
      workflows.effectiveDocType(base.name, context.tenantId, base);
    const documents = new DocumentService({
      registry,
      store,
      doctypeResolver,
      ids: deterministicIds(["note-1", "note-approve"]),
      clock: fixedClock(now)
    });
    const queries = new QueryService({ registry, projections: store, doctypeResolver });

    await workflows.save({ actor: admin, doctype: "Note", workflow: overrideWorkflow });
    await documents.create({ actor: admin, doctype: "Note", data: data() });

    await expect(documents.transition({
      actor: admin,
      doctype: "Note",
      name: "My Note",
      workflow: "lifecycle",
      action: "close"
    })).rejects.toMatchObject({ code: "WORKFLOW_ACTION_NOT_FOUND" });
    await expect(documents.transition({
      actor: admin,
      doctype: "Note",
      name: "My Note",
      workflow: "lifecycle",
      action: "approve"
    })).resolves.toMatchObject({ version: 2, data: { workflow_state: "Closed" } });
    await expect(queries.getEffectiveMeta(admin, "Note")).resolves.toMatchObject({
      workflows: [{ name: "lifecycle", transitions: [{ action: "approve" }] }]
    });
  });
});

function workflowService(events: InMemoryDocumentStore, ids: readonly string[]): WorkflowService {
  return new WorkflowService({
    registry: createRegistry({ doctypes: [noteDocType] }),
    events,
    ids: deterministicIds(ids),
    clock: fixedClock(now)
  });
}

function workflowFor(name: string, stateField: string): NamedWorkflowDefinition {
  return {
    name,
    stateField,
    initialState: "Open",
    states: ["Open", "Closed"],
    transitions: [{ action: "close", from: "Open", to: "Closed" }]
  };
}
