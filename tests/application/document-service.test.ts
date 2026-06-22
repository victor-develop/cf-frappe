import {
  CHILD_TABLE_ROW_INDEX_FIELD,
  DocumentService,
  FrameworkError,
  InMemoryDocumentStore,
  createRegistry,
  defineDocType,
  deterministicIds,
  documentStream,
  fixedClock,
  namingSeriesStream
} from "../../src";
import {
  createChildTableServices,
  createLinkedServices,
  createSeriesServices,
  createServices,
  data,
  guest,
  manager,
  now,
  owner
} from "../helpers";

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

  it("allocates series names from an event stream before creating documents", async () => {
    const { documents, events, queries } = createSeriesServices(["series-1", "ticket-1", "series-2", "ticket-2"]);

    await expect(
      documents.create({
        actor: owner,
        doctype: "Support Ticket",
        name: "MANUAL-1",
        data: { subject: "Manual" }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "name", code: "name" })]
    });

    const first = await documents.create({
      actor: owner,
      doctype: "Support Ticket",
      data: { subject: "First" }
    });
    const second = await documents.create({
      actor: owner,
      doctype: "Support Ticket",
      data: { subject: "Second" }
    });

    expect(first).toMatchObject({
      name: "TICK-.0001",
      data: { subject: "First" }
    });
    expect(second).toMatchObject({
      name: "TICK-.0002",
      data: { subject: "Second" }
    });
    await expect(
      events.readStream(namingSeriesStream("acme", "Support Ticket", "TICK-.####"))
    ).resolves.toMatchObject([
      {
        type: "NamingSeriesStarted",
        payload: { kind: "DocumentCreated", data: { current: 1, pattern: "TICK-.####" } }
      },
      {
        type: "NamingSeriesAdvanced",
        payload: { kind: "DocumentUpdated", patch: { current: 2 } }
      }
    ]);
    await expect(queries.getDocument(owner, "Support Ticket", "TICK-.0002")).resolves.toMatchObject({
      data: { subject: "Second" }
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

  it("enforces event-sourced user permissions on linked writes and existing document commands", async () => {
    const { documents, userPermissions } = createLinkedServices(["p1", "p2", "t1", "t2"]);
    const admin = { id: "admin@example.com", roles: ["System Manager"], tenantId: "acme" };
    await documents.create({ actor: owner, doctype: "Project", data: { title: "Apollo" } });
    await documents.create({ actor: owner, doctype: "Project", data: { title: "Zeus" } });
    await documents.create({
      actor: owner,
      doctype: "Task",
      data: { title: "Legacy Zeus", project: "Zeus", description: "created before restriction" }
    });
    await userPermissions.allow({
      actor: admin,
      userId: owner.id,
      targetDoctype: "Project",
      targetName: "Apollo"
    });

    await expect(
      documents.create({
        actor: owner,
        doctype: "Task",
        data: { title: "Allowed Apollo", project: "Apollo", description: "allowed" }
      })
    ).resolves.toMatchObject({ name: "Allowed Apollo" });
    await expect(
      documents.create({
        actor: owner,
        doctype: "Task",
        data: { title: "Blocked Zeus", project: "Zeus", description: "blocked" }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "project", code: "link_not_found" })]
    });
    await expect(
      documents.update({
        actor: owner,
        doctype: "Task",
        name: "Legacy Zeus",
        patch: { description: "should not be writable" }
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("enforces source-scoped user permissions while validating link writes", async () => {
    const { documents, userPermissions } = createLinkedServices(["p1", "p2", "t1", "t2"]);
    const admin = { id: "admin@example.com", roles: ["System Manager"], tenantId: "acme" };
    await documents.create({ actor: owner, doctype: "Project", data: { title: "Apollo" } });
    await documents.create({ actor: owner, doctype: "Project", data: { title: "Zeus" } });
    await documents.create({
      actor: owner,
      doctype: "Task",
      data: { title: "Movable", project: "Apollo", description: "created before restriction" }
    });
    await userPermissions.allow({
      actor: admin,
      userId: owner.id,
      targetDoctype: "Project",
      targetName: "Apollo",
      applicableDoctypes: ["Task"]
    });

    await expect(
      documents.create({
        actor: owner,
        doctype: "Task",
        data: { title: "Allowed Scoped Apollo", project: "Apollo", description: "allowed" }
      })
    ).resolves.toMatchObject({ name: "Allowed Scoped Apollo" });
    await expect(
      documents.create({
        actor: owner,
        doctype: "Task",
        data: { title: "Blocked Scoped Zeus", project: "Zeus", description: "blocked" }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "project", code: "link_not_found" })]
    });
    await expect(
      documents.execute({
        actor: owner,
        doctype: "Task",
        name: "Movable",
        command: "move",
        input: { project: "Zeus" }
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

  it("adds comments as document stream events without mutating document data", async () => {
    const { documents, events, projections } = createServices(["e1", "comment-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    const commented = await documents.comment({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      text: "Looks good to me",
      expectedVersion: 1
    });

    expect(commented).toMatchObject({
      version: 2,
      docstatus: "draft",
      data: { body: "Body" }
    });
    await expect(projections.get("acme", "Note", "My Note")).resolves.toMatchObject({ version: 2 });
    await expect(events.readStream("acme:Note:My%20Note")).resolves.toMatchObject([
      expect.anything(),
      {
        type: "NoteCommentAdded",
        actorId: owner.id,
        payload: { kind: "DocumentCommentAdded", text: "Looks good to me" }
      }
    ]);
  });

  it("requires comment permission and non-empty comment text", async () => {
    const { documents } = createServices(["e1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    await expect(
      documents.comment({ actor: guest, doctype: "Note", name: "My Note", text: "I should not comment" })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    await expect(
      documents.comment({ actor: owner, doctype: "Note", name: "My Note", text: "   " })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Comment text is required"
    });
  });

  it("records activity feed entries as document stream events without mutating document data", async () => {
    const { documents, events, projections } = createServices(["e1", "activity-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    const activity = await documents.recordActivity({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      activityType: "email",
      subject: "Follow-up sent",
      detail: "Sent to customer@example.com",
      channel: "email",
      externalId: "msg-123",
      expectedVersion: 1
    });

    expect(activity).toMatchObject({
      version: 2,
      docstatus: "draft",
      data: { body: "Body" }
    });
    await expect(projections.get("acme", "Note", "My Note")).resolves.toMatchObject({ version: 2 });
    await expect(events.readStream("acme:Note:My%20Note")).resolves.toMatchObject([
      expect.anything(),
      {
        type: "NoteActivityRecorded",
        actorId: owner.id,
        payload: {
          kind: "DocumentActivityRecorded",
          activityType: "email",
          subject: "Follow-up sent",
          detail: "Sent to customer@example.com",
          channel: "email",
          externalId: "msg-123"
        }
      }
    ]);
  });

  it("requires activity permission and non-empty activity subjects", async () => {
    const { documents } = createServices(["e1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    await expect(
      documents.recordActivity({
        actor: guest,
        doctype: "Note",
        name: "My Note",
        subject: "I should not record activity"
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    await expect(
      documents.recordActivity({ actor: owner, doctype: "Note", name: "My Note", subject: "   " })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Activity subject is required"
    });
  });

  it("rejects activity feed entries with stale optimistic versions", async () => {
    const { documents } = createServices(["e1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    await expect(
      documents.recordActivity({
        actor: owner,
        doctype: "Note",
        name: "My Note",
        subject: "Follow-up sent",
        expectedVersion: 0
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
  });

  it("tags and untags documents as idempotent stream events without mutating document data", async () => {
    const { documents, events, projections } = createServices(["e1", "tag-1", "untag-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    const tagged = await documents.tag({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      tag: " Urgent  Customer ",
      expectedVersion: 1
    });
    const duplicateTag = await documents.tag({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      tag: "Urgent Customer",
      expectedVersion: 2
    });
    const untagged = await documents.untag({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      tag: "Urgent Customer",
      expectedVersion: 2
    });
    const absentUntag = await documents.untag({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      tag: "Urgent Customer",
      expectedVersion: 3
    });

    expect(tagged).toMatchObject({ version: 2, docstatus: "draft", data: { body: "Body" } });
    expect(duplicateTag.version).toBe(2);
    expect(untagged).toMatchObject({ version: 3, docstatus: "draft", data: { body: "Body" } });
    expect(absentUntag.version).toBe(3);
    await expect(projections.get("acme", "Note", "My Note")).resolves.toMatchObject({ version: 3 });
    await expect(events.readStream("acme:Note:My%20Note")).resolves.toMatchObject([
      expect.anything(),
      {
        type: "NoteTagged",
        payload: { kind: "DocumentTagged", tag: "Urgent Customer" }
      },
      {
        type: "NoteUntagged",
        payload: { kind: "DocumentUntagged", tag: "Urgent Customer" }
      }
    ]);
  });

  it("requires tag permission, non-empty tags, and current optimistic versions", async () => {
    const { documents } = createServices(["e1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    await expect(
      documents.tag({ actor: guest, doctype: "Note", name: "My Note", tag: "Urgent" })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    await expect(
      documents.tag({ actor: owner, doctype: "Note", name: "My Note", tag: "   " })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Tag is required"
    });

    await expect(
      documents.tag({ actor: owner, doctype: "Note", name: "My Note", tag: "Urgent", expectedVersion: 0 })
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
  });

  it("follows and unfollows documents as idempotent stream events without mutating document data", async () => {
    const { documents, events, projections } = createServices(["e1", "follow-1", "unfollow-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    const followed = await documents.follow({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      expectedVersion: 1
    });
    const duplicateFollow = await documents.follow({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      expectedVersion: 2
    });
    const unfollowed = await documents.unfollow({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      expectedVersion: 2
    });
    const absentUnfollow = await documents.unfollow({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      expectedVersion: 3
    });

    expect(followed).toMatchObject({ version: 2, docstatus: "draft", data: { body: "Body" } });
    expect(duplicateFollow.version).toBe(2);
    expect(unfollowed).toMatchObject({ version: 3, docstatus: "draft", data: { body: "Body" } });
    expect(absentUnfollow.version).toBe(3);
    await expect(projections.get("acme", "Note", "My Note")).resolves.toMatchObject({ version: 3 });
    await expect(events.readStream("acme:Note:My%20Note")).resolves.toMatchObject([
      expect.anything(),
      {
        type: "NoteFollowed",
        payload: { kind: "DocumentFollowed", followerId: owner.id }
      },
      {
        type: "NoteUnfollowed",
        payload: { kind: "DocumentUnfollowed", followerId: owner.id }
      }
    ]);
  });

  it("uses DocType event overrides for follow and unfollow events", async () => {
    const Followable = defineDocType({
      name: "Followable Note",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "created_by", type: "text", readOnly: true, defaultValue: ({ actor }) => actor.id }
      ],
      events: {
        follow: "FollowableSubscribed",
        unfollow: "FollowableUnsubscribed"
      },
      permissions: [
        {
          roles: ["User"],
          actions: ["read", "create", "follow"],
          when: ({ actor, document }) => !document || document.data.created_by === actor.id
        }
      ]
    });
    const registry = createRegistry({ doctypes: [Followable] });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({
      registry,
      store,
      clock: fixedClock(now),
      ids: deterministicIds(["create-1", "follow-1", "unfollow-1"])
    });

    await documents.create({ actor: owner, doctype: "Followable Note", data: { title: "Custom Follow" } });
    await documents.follow({ actor: owner, doctype: "Followable Note", name: "Custom Follow", expectedVersion: 1 });
    await documents.unfollow({ actor: owner, doctype: "Followable Note", name: "Custom Follow", expectedVersion: 2 });

    await expect(store.readStream(documentStream("acme", "Followable Note", "Custom Follow"))).resolves.toEqual([
      expect.objectContaining({ type: "Followable NoteCreated" }),
      expect.objectContaining({
        type: "FollowableSubscribed",
        payload: expect.objectContaining({ kind: "DocumentFollowed" })
      }),
      expect.objectContaining({
        type: "FollowableUnsubscribed",
        payload: expect.objectContaining({ kind: "DocumentUnfollowed" })
      })
    ]);
  });

  it("requires follow permission, non-empty followers, and current optimistic versions", async () => {
    const { documents } = createServices(["e1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    await expect(
      documents.follow({ actor: guest, doctype: "Note", name: "My Note" })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    await expect(
      documents.follow({ actor: owner, doctype: "Note", name: "My Note", follower: "   " })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Follower is required"
    });

    await expect(
      documents.follow({ actor: owner, doctype: "Note", name: "My Note", expectedVersion: 0 })
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
  });

  it("assigns and unassigns users as document stream events without mutating document data", async () => {
    const { documents, events, projections } = createServices(["e1", "assign-1", "unassign-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    const assigned = await documents.assign({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      assignee: "support@example.com",
      expectedVersion: 1
    });
    const unassigned = await documents.unassign({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      assignee: "support@example.com",
      expectedVersion: 2
    });

    expect(assigned).toMatchObject({
      version: 2,
      docstatus: "draft",
      data: { body: "Body" }
    });
    expect(unassigned).toMatchObject({
      version: 3,
      docstatus: "draft",
      data: { body: "Body" }
    });
    await expect(projections.get("acme", "Note", "My Note")).resolves.toMatchObject({ version: 3 });
    await expect(events.readStream("acme:Note:My%20Note")).resolves.toMatchObject([
      expect.anything(),
      {
        type: "NoteAssigned",
        actorId: owner.id,
        payload: { kind: "DocumentAssigned", assigneeId: "support@example.com" }
      },
      {
        type: "NoteUnassigned",
        actorId: owner.id,
        payload: { kind: "DocumentUnassigned", assigneeId: "support@example.com" }
      }
    ]);
  });

  it("keeps repeated assignment commands idempotent", async () => {
    const { documents, events } = createServices(["e1", "assign-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });
    await documents.assign({ actor: owner, doctype: "Note", name: "My Note", assignee: "support@example.com" });

    const duplicateAssign = await documents.assign({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      assignee: "support@example.com",
      expectedVersion: 2
    });
    const absentUnassign = await documents.unassign({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      assignee: "missing@example.com",
      expectedVersion: 2
    });

    expect(duplicateAssign.version).toBe(2);
    expect(absentUnassign.version).toBe(2);
    await expect(events.readStream("acme:Note:My%20Note")).resolves.toHaveLength(2);
  });

  it("requires assign permission and non-empty assignees", async () => {
    const { documents } = createServices(["e1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    await expect(
      documents.assign({ actor: guest, doctype: "Note", name: "My Note", assignee: "support@example.com" })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    await expect(
      documents.assign({ actor: owner, doctype: "Note", name: "My Note", assignee: "   " })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Assignee is required"
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

  it("submits and cancels documents as lifecycle events", async () => {
    const { documents, events, projections } = createServices(["e1", "e2", "e3"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    const submitted = await documents.submit({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      expectedVersion: 1
    });
    expect(submitted).toMatchObject({
      version: 2,
      docstatus: "submitted",
      data: { title: "My Note" }
    });
    await expect(projections.get("acme", "Note", "My Note")).resolves.toMatchObject({
      version: 2,
      docstatus: "submitted"
    });

    const cancelled = await documents.cancel({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      expectedVersion: 2
    });
    expect(cancelled).toMatchObject({
      version: 3,
      docstatus: "cancelled",
      data: { title: "My Note" }
    });
    await expect(events.readStream("acme:Note:My%20Note")).resolves.toMatchObject([
      expect.anything(),
      { type: "NoteSubmitted", payload: { kind: "DocumentSubmitted" } },
      { type: "NoteCancelled", payload: { kind: "DocumentCancelled" } }
    ]);
  });

  it("enforces lifecycle permissions and status transitions at the command boundary", async () => {
    const { documents } = createServices(["e1", "e2", "e3", "e4"]);
    await documents.create({ actor: owner, doctype: "Note", data: data() });

    await expect(
      documents.submit({ actor: guest, doctype: "Note", name: "My Note" })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    await documents.submit({ actor: owner, doctype: "Note", name: "My Note" });

    await expect(
      documents.update({ actor: owner, doctype: "Note", name: "My Note", patch: { body: "Too late" } })
    ).rejects.toMatchObject({ code: "DOCUMENT_STATUS_CONFLICT" });
    await expect(
      documents.execute({ actor: owner, doctype: "Note", name: "My Note", command: "rewriteBody", input: { body: "Too late" } })
    ).rejects.toMatchObject({ code: "DOCUMENT_STATUS_CONFLICT" });
    await expect(
      documents.transition({ actor: owner, doctype: "Note", name: "My Note", action: "close" })
    ).rejects.toMatchObject({ code: "DOCUMENT_STATUS_CONFLICT" });
    await expect(
      documents.delete({ actor: manager, doctype: "Note", name: "My Note" })
    ).rejects.toMatchObject({ code: "DOCUMENT_STATUS_CONFLICT" });
    await expect(
      documents.submit({ actor: owner, doctype: "Note", name: "My Note" })
    ).rejects.toMatchObject({ code: "DOCUMENT_STATUS_CONFLICT" });

    await documents.cancel({ actor: owner, doctype: "Note", name: "My Note" });
    await expect(
      documents.cancel({ actor: owner, doctype: "Note", name: "My Note" })
    ).rejects.toMatchObject({ code: "DOCUMENT_STATUS_CONFLICT" });
    await expect(
      documents.delete({ actor: manager, doctype: "Note", name: "My Note" })
    ).resolves.toMatchObject({ docstatus: "deleted" });
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
