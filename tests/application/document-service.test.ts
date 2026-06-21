import { FrameworkError } from "../../src";
import { createServices, data, guest, manager, now, owner } from "../helpers";

describe("DocumentService", () => {
  it("creates a document through defaults, hooks, events, and projection", async () => {
    const { documents, projections, events } = createServices(["e1"]);
    const created = await documents.create({
      actor: owner,
      doctype: "Note",
      data: { title: "  My Note  ", body: "Body" }
    });

    expect(created).toMatchObject({
      tenantId: "acme",
      doctype: "Note",
      name: "My Note",
      version: 1,
      data: {
        title: "My Note",
        body: "Body",
        priority: "Medium",
        workflow_state: "Open",
        created_by: owner.id,
        count: 0
      },
      createdAt: now,
      updatedAt: now
    });
    await expect(projections.get("acme", "Note", "My Note")).resolves.toEqual(created);
    await expect(events.currentVersion("acme:Note:My%20Note")).resolves.toBe(1);
  });

  it("uses the event stream, not stale projection state, as the write authority", async () => {
    const { documents, projections } = createServices(["e1", "e2"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "My Note",
      version: 99,
      docstatus: "draft",
      data: { title: "My Note", body: "corrupt", created_by: owner.id },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    const updated = await documents.update({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      patch: { body: "from events" },
      expectedVersion: 1
    });

    expect(updated).toMatchObject({
      version: 2,
      data: { body: "from events" }
    });
  });

  it("runs beforeValidate hooks for updates", async () => {
    const { documents, projections } = createServices(["e1", "e2"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    await documents.update({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      patch: { title: "  Trimmed  " }
    });

    await expect(projections.get("acme", "Note", "My Note")).resolves.toMatchObject({
      data: { title: "Trimmed" }
    });
  });

  it("records domain event names separately from reducer payload kind", async () => {
    const { documents, events } = createServices(["e1", "e2"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });
    await documents.update({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      patch: { body: "New" },
      eventType: "NoteBodyEdited"
    });

    const stream = await events.readStream("acme:Note:My%20Note");
    expect(stream[1]).toMatchObject({
      type: "NoteBodyEdited",
      payload: { kind: "DocumentUpdated" }
    });
  });

  it("executes model-declared domain commands with intentful event payloads", async () => {
    const { documents, events } = createServices(["e1", "e2"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    const archived = await documents.execute({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      command: "archive",
      input: {}
    });

    expect(archived).toMatchObject({ data: { workflow_state: "Closed" } });
    await expect(events.readStream("acme:Note:My%20Note")).resolves.toMatchObject([
      expect.anything(),
      {
        type: "NoteArchived",
        payload: {
          kind: "DomainCommandApplied",
          command: "archive",
          patch: { workflow_state: "Closed" }
        }
      }
    ]);
  });

  it("rejects create when role cannot create", async () => {
    const { documents } = createServices(["e1"]);

    await expect(
      documents.create({ actor: guest, doctype: "Note", data: data() })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("combines schema and hook validation", async () => {
    const { documents } = createServices(["e1"]);

    await expect(
      documents.create({ actor: owner, doctype: "Note", data: { title: "Hi", priority: "High" } })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: expect.arrayContaining([
        expect.objectContaining({ field: "title", code: "min" }),
        expect.objectContaining({ field: "body", code: "high_priority_body" })
      ])
    });
  });

  it("updates a document with optimistic version checks", async () => {
    const { documents } = createServices(["e1", "e2"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    const updated = await documents.update({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      patch: { body: "New" },
      expectedVersion: 1
    });

    expect(updated).toMatchObject({
      version: 2,
      data: { body: "New" }
    });
  });

  it("rejects stale writes", async () => {
    const { documents } = createServices(["e1", "e2"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    await expect(
      documents.update({
        actor: owner,
        doctype: "Note",
        name: "My Note",
        patch: { body: "New" },
        expectedVersion: 0
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
  });

  it("prevents updates to read-only fields", async () => {
    const { documents } = createServices(["e1", "e2"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    await expect(
      documents.update({
        actor: owner,
        doctype: "Note",
        name: "My Note",
        patch: { created_by: "attacker" }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ code: "readonly" })]
    });
  });

  it("enforces ownership predicates on update", async () => {
    const { documents } = createServices(["e1", "e2"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    await expect(
      documents.update({
        actor: { id: "other", roles: ["User"], tenantId: "acme" },
        doctype: "Note",
        name: "My Note",
        patch: { body: "New" }
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("runs workflow transitions as events", async () => {
    const { documents } = createServices(["e1", "e2"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    const transitioned = await documents.transition({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      action: "close"
    });

    expect(transitioned).toMatchObject({
      version: 2,
      data: { workflow_state: "Closed" }
    });
  });

  it("rejects illegal workflow transitions", async () => {
    const { documents } = createServices(["e1", "e2"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });
    await documents.transition({ actor: owner, doctype: "Note", name: "My Note", action: "close" });

    await expect(
      documents.transition({ actor: owner, doctype: "Note", name: "My Note", action: "close" })
    ).rejects.toMatchObject({ code: "WORKFLOW_TRANSITION_DENIED" });
  });

  it("soft deletes via an event and hides future writes", async () => {
    const { documents } = createServices(["e1", "e2", "e3"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });
    const deleted = await documents.delete({ actor: manager, doctype: "Note", name: "My Note" });

    expect(deleted.docstatus).toBe("deleted");
    await expect(
      documents.update({ actor: manager, doctype: "Note", name: "My Note", patch: { body: "Nope" } })
    ).rejects.toBeInstanceOf(FrameworkError);
  });
});
