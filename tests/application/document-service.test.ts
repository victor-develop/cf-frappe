import { CHILD_TABLE_ROW_INDEX_FIELD, FrameworkError } from "../../src";
import { createChildTableServices, createLinkedServices, createServices, data, guest, manager, now, owner } from "../helpers";

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

  it("accepts link fields only when the target document exists in the event stream", async () => {
    const { documents } = createLinkedServices(["p1", "t1"]);
    await documents.create({ actor: owner, doctype: "Project", data: { title: "Apollo" } });

    const task = await documents.create({
      actor: owner,
      doctype: "Task",
      data: { title: "Launch", project: "Apollo" }
    });

    expect(task).toMatchObject({
      doctype: "Task",
      data: { project: "Apollo" }
    });
  });

  it("rejects missing or deleted link targets on creates, updates, and commands", async () => {
    const { documents } = createLinkedServices(["p1", "t1", "p2", "t2"]);

    await expect(
      documents.create({
        actor: owner,
        doctype: "Task",
        data: { title: "Orphan", project: "Missing" }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "project", code: "link_not_found" })]
    });

    await documents.create({ actor: owner, doctype: "Project", data: { title: "Apollo" } });
    await documents.create({
      actor: owner,
      doctype: "Task",
      data: { title: "Launch", project: "Apollo" }
    });
    await documents.delete({ actor: owner, doctype: "Project", name: "Apollo" });

    await expect(
      documents.update({
        actor: owner,
        doctype: "Task",
        name: "Launch",
        patch: { description: "Target deleted, link omitted" }
      })
    ).resolves.toMatchObject({
      data: { description: "Target deleted, link omitted", project: "Apollo" }
    });

    await expect(
      documents.update({
        actor: owner,
        doctype: "Task",
        name: "Launch",
        patch: { project: "Apollo" }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "project", code: "link_not_found" })]
    });

    await expect(
      documents.execute({
        actor: owner,
        doctype: "Task",
        name: "Launch",
        command: "move",
        input: { project: "Apollo" }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "project", code: "link_not_found" })]
    });
  });

  it("rejects link targets the actor cannot read without exposing target existence", async () => {
    const { documents } = createLinkedServices(["p1"]);
    const other = { ...owner, id: "other@example.com" };
    await documents.create({ actor: owner, doctype: "Project", data: { title: "Secret" } });

    await expect(
      documents.create({
        actor: other,
        doctype: "Task",
        data: { title: "Unauthorized", project: "Secret" }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "project", code: "link_not_found" })]
    });
  });

  it("creates documents with child table rows in the event payload and projection", async () => {
    const { documents, events, projections } = createChildTableServices(["product-1", "invoice-1"]);
    await documents.create({ actor: owner, doctype: "Product", data: { sku: "SKU-1", title: "Widget" } });

    const invoice = await documents.create({
      actor: owner,
      doctype: "Sales Invoice",
      data: {
        title: "INV-1",
        items: [{ product: "SKU-1", quantity: 2, rate: 10 }]
      }
    });

    expect(invoice).toMatchObject({
      doctype: "Sales Invoice",
      data: {
        items: [{ product: "SKU-1", quantity: 2, rate: 10 }]
      }
    });
    await expect(events.readStream("acme:Sales%20Invoice:INV-1")).resolves.toMatchObject([
      {
        payload: {
          kind: "DocumentCreated",
          data: { items: [{ product: "SKU-1", quantity: 2, rate: 10 }] }
        }
      }
    ]);
    await expect(projections.get("acme", "Sales Invoice", "INV-1")).resolves.toMatchObject({
      data: { items: [{ product: "SKU-1", quantity: 2, rate: 10 }] }
    });
  });

  it("validates child table rows and nested link fields at the command boundary", async () => {
    const { documents } = createChildTableServices(["product-1", "invoice-1", "invoice-2"]);
    await documents.create({ actor: owner, doctype: "Product", data: { sku: "SKU-1", title: "Widget" } });

    await expect(
      documents.create({
        actor: owner,
        doctype: "Sales Invoice",
        data: {
          title: "Broken",
          items: [{ product: "Missing", quantity: 0 }]
        }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: expect.arrayContaining([
        expect.objectContaining({ field: "items[0].quantity", code: "min" }),
        expect.objectContaining({ field: "items[0].product", code: "link_not_found" })
      ])
    });

    await documents.create({
      actor: owner,
      doctype: "Sales Invoice",
      data: {
        title: "INV-1",
        items: [{ product: "SKU-1", quantity: 1 }]
      }
    });

    await expect(
      documents.update({
        actor: owner,
        doctype: "Sales Invoice",
        name: "INV-1",
        patch: { items: [] }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "items", code: "required" })]
    });

    await expect(
      documents.update({
        actor: owner,
        doctype: "Sales Invoice",
        name: "INV-1",
        patch: {
          items: [{ product: "SKU-1", quantity: 1, line_id: "attacker" }]
        }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "items[0].line_id", code: "readonly" })]
    });

    await expect(
      documents.execute({
        actor: owner,
        doctype: "Sales Invoice",
        name: "INV-1",
        command: "replaceItems",
        input: {
          items: [{ product: "Missing", quantity: 1 }]
        }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "items[0].product", code: "link_not_found" })]
    });
  });

  it("preserves omitted read-only child table values by submitted row origin", async () => {
    const { documents, events } = createChildTableServices(["product-1", "product-2", "invoice-1", "invoice-2"]);
    await documents.create({ actor: owner, doctype: "Product", data: { sku: "SKU-1", title: "Widget" } });
    await documents.create({ actor: owner, doctype: "Product", data: { sku: "SKU-2", title: "Gadget" } });
    await documents.create({
      actor: owner,
      doctype: "Sales Invoice",
      data: {
        title: "INV-1",
        items: [
          { product: "SKU-1", quantity: 1, line_id: "line-1" },
          { product: "SKU-2", quantity: 2, line_id: "line-2" }
        ]
      }
    });

    const updated = await documents.update({
      actor: owner,
      doctype: "Sales Invoice",
      name: "INV-1",
      patch: {
        items: [{ [CHILD_TABLE_ROW_INDEX_FIELD]: "1", product: "SKU-2", quantity: 3 }]
      }
    });

    expect(updated).toMatchObject({
      data: { items: [{ product: "SKU-2", quantity: 3, line_id: "line-2" }] }
    });
    await expect(events.readStream("acme:Sales%20Invoice:INV-1")).resolves.toMatchObject([
      expect.anything(),
      {
        payload: {
          kind: "DocumentUpdated",
          patch: { items: [{ product: "SKU-2", quantity: 3, line_id: "line-2" }] }
        }
      }
    ]);
    const stream = await events.readStream("acme:Sales%20Invoice:INV-1");
    expect(JSON.stringify(stream)).not.toContain(CHILD_TABLE_ROW_INDEX_FIELD);
  });

  it("rejects duplicate and out-of-range child row origins", async () => {
    const { documents } = createChildTableServices(["product-1", "product-2", "invoice-1"]);
    await documents.create({ actor: owner, doctype: "Product", data: { sku: "SKU-1", title: "Widget" } });
    await documents.create({ actor: owner, doctype: "Product", data: { sku: "SKU-2", title: "Gadget" } });
    await documents.create({
      actor: owner,
      doctype: "Sales Invoice",
      data: {
        title: "INV-1",
        items: [
          { product: "SKU-1", quantity: 1, line_id: "line-1" },
          { product: "SKU-2", quantity: 2, line_id: "line-2" }
        ]
      }
    });

    await expect(
      documents.update({
        actor: owner,
        doctype: "Sales Invoice",
        name: "INV-1",
        patch: {
          items: [
            { [CHILD_TABLE_ROW_INDEX_FIELD]: "1", product: "SKU-2", quantity: 3 },
            { [CHILD_TABLE_ROW_INDEX_FIELD]: "1", product: "SKU-2", quantity: 4 }
          ]
        }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: `items[1].${CHILD_TABLE_ROW_INDEX_FIELD}`, code: "child_row_origin" })]
    });

    await expect(
      documents.update({
        actor: owner,
        doctype: "Sales Invoice",
        name: "INV-1",
        patch: {
          items: [{ [CHILD_TABLE_ROW_INDEX_FIELD]: "5", product: "SKU-2", quantity: 3 }]
        }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: `items[0].${CHILD_TABLE_ROW_INDEX_FIELD}`, code: "child_row_origin" })]
    });
  });

  it("preserves child row origins through custom domain command patches without storing markers", async () => {
    const { documents, events } = createChildTableServices(["product-1", "product-2", "invoice-1", "invoice-2"]);
    await documents.create({ actor: owner, doctype: "Product", data: { sku: "SKU-1", title: "Widget" } });
    await documents.create({ actor: owner, doctype: "Product", data: { sku: "SKU-2", title: "Gadget" } });
    await documents.create({
      actor: owner,
      doctype: "Sales Invoice",
      data: {
        title: "INV-1",
        items: [
          { product: "SKU-1", quantity: 1, line_id: "line-1" },
          { product: "SKU-2", quantity: 2, line_id: "line-2" }
        ]
      }
    });

    const updated = await documents.execute({
      actor: owner,
      doctype: "Sales Invoice",
      name: "INV-1",
      command: "customReplaceItems",
      input: {
        items: [{ [CHILD_TABLE_ROW_INDEX_FIELD]: "1", product: "SKU-2", quantity: 3 }]
      }
    });

    expect(updated).toMatchObject({
      data: { items: [{ product: "SKU-2", quantity: 3, line_id: "line-2" }] }
    });
    await expect(events.readStream("acme:Sales%20Invoice:INV-1")).resolves.toMatchObject([
      expect.anything(),
      {
        payload: {
          kind: "DomainCommandApplied",
          command: "customReplaceItems",
          input: { items: [{ product: "SKU-2", quantity: 3 }] },
          patch: { items: [{ product: "SKU-2", quantity: 3, line_id: "line-2" }] }
        }
      }
    ]);
    const stream = await events.readStream("acme:Sales%20Invoice:INV-1");
    expect(JSON.stringify(stream)).not.toContain(CHILD_TABLE_ROW_INDEX_FIELD);
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
