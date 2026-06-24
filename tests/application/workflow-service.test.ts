import {
  AuditService,
  createRegistry,
  defineDocType,
  deterministicIds,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  SYSTEM_MANAGER_ROLE,
  WorkflowService,
  workflowDefinitionsStream,
  type DocTypeDefinition
} from "../../src";
import { data, noteDocType, now, owner } from "../helpers";

const admin = {
  id: "admin@example.com",
  roles: [SYSTEM_MANAGER_ROLE, "User"],
  tenantId: "acme"
};

const overrideWorkflow = {
  initialState: "Open",
  states: ["Open", "Closed"],
  transitions: [{ action: "approve", from: "Open", to: "Closed", roles: ["User"], eventType: "NoteApproved" }]
};

describe("WorkflowService", () => {
  it("saves, clears, and audits tenant workflow definition events", async () => {
    const events = new InMemoryDocumentStore();
    const service = new WorkflowService({
      registry: createRegistry({ doctypes: [noteDocType] }),
      events,
      ids: deterministicIds(["workflow-1", "workflow-2"]),
      clock: fixedClock(now)
    });

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
    const cleared = await service.clear({ actor: admin, doctype: "Note", expectedVersion: 1 });

    expect(saved).toMatchObject({
      tenantId: "acme",
      doctypeName: "Note",
      version: 1,
      workflow: { transitions: [{ action: "approve", eventType: "NoteApproved" }] }
    });
    expect(repeated.version).toBe(1);
    expect(cleared).toMatchObject({ tenantId: "acme", doctypeName: "Note", version: 2 });
    expect(cleared.workflow).toBeUndefined();
    await expect(events.readStream(workflowDefinitionsStream("acme"))).resolves.toMatchObject([
      { id: "evt_workflow-1", payload: { kind: "WorkflowDefinitionSaved", doctypeName: "Note" } },
      { id: "evt_workflow-2", payload: { kind: "WorkflowDefinitionCleared", doctypeName: "Note" } }
    ]);
    await expect(new AuditService({ events }).search(admin, { kind: "WorkflowDefinitionSaved" })).resolves.toMatchObject({
      events: [{ payload: { kind: "WorkflowDefinitionSaved", workflow: { transitions: [{ action: "approve" }] } } }]
    });
    await expect(service.effectiveDocType("Note", "acme")).resolves.toMatchObject({
      workflow: { transitions: [{ action: "close" }] }
    });
  });

  it("requires admin authority, tenant ownership, and expected versions", async () => {
    const service = new WorkflowService({
      registry: createRegistry({ doctypes: [noteDocType] }),
      events: new InMemoryDocumentStore(),
      ids: deterministicIds(["workflow-1"]),
      clock: fixedClock(now)
    });

    await expect(
      service.save({ actor: owner, doctype: "Note", workflow: overrideWorkflow })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      service.save({ actor: admin, tenantId: "globex", doctype: "Note", workflow: overrideWorkflow })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      service.save({ actor: admin, doctype: "Note", workflow: overrideWorkflow, expectedVersion: 1 })
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
  });

  it("validates workflow state fields against upstream metadata overlays", async () => {
    const Ticket = defineDocType({
      name: "Ticket",
      fields: [{ name: "title", type: "text", required: true }]
    });
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

    await expect(
      service.save({
        actor: admin,
        doctype: "Ticket",
        workflow: {
          stateField: "runtime_state",
          initialState: "Todo",
          states: ["Todo", "Done"],
          transitions: [{ action: "finish", from: "Todo", to: "Done" }]
        }
      })
    ).resolves.toMatchObject({
      workflow: { stateField: "runtime_state", transitions: [{ action: "finish" }] }
    });
    await expect(service.effectiveDocType("Ticket", "acme")).resolves.toMatchObject({
      fields: expect.arrayContaining([expect.objectContaining({ name: "runtime_state" })]),
      workflow: { stateField: "runtime_state" }
    });
  });

  it("feeds runtime workflow overrides into document transitions through the DocType resolver", async () => {
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

    await expect(documents.transition({ actor: admin, doctype: "Note", name: "My Note", action: "close" }))
      .rejects.toMatchObject({ code: "WORKFLOW_TRANSITION_DENIED" });
    await expect(
      documents.transition({ actor: admin, doctype: "Note", name: "My Note", action: "approve" })
    ).resolves.toMatchObject({
      version: 2,
      data: { workflow_state: "Closed" }
    });
    await expect(queries.getEffectiveMeta(admin, "Note")).resolves.toMatchObject({
      workflow: { transitions: [{ action: "approve" }] }
    });
  });
});
