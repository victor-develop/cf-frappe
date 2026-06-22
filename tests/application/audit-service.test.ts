import { AuditService, SYSTEM_MANAGER_ROLE } from "../../src";
import { createServices, data, manager, owner } from "../helpers";

describe("AuditService", () => {
  const admin = {
    id: "admin@example.com",
    roles: [SYSTEM_MANAGER_ROLE],
    tenantId: "acme"
  };

  it("searches immutable events for system managers with metadata filters", async () => {
    const { audit, documents } = createServices(["create-1", "update-1", "create-2"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Audited Note" }) });
    await documents.update({
      actor: owner,
      doctype: "Note",
      name: "Audited Note",
      patch: { body: "Updated" }
    });
    await documents.create({
      actor: manager,
      doctype: "Note",
      data: data({ title: "Other Note" })
    });

    const result = await audit.search(admin, {
      doctype: "Note",
      name: "Audited Note",
      actorId: owner.id,
      kind: "DocumentUpdated",
      limit: 5
    });

    expect(result).toMatchObject({
      tenantId: "acme",
      limit: 5,
      filters: {
        doctype: "Note",
        name: "Audited Note",
        actorId: owner.id,
        kind: "DocumentUpdated"
      }
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: "evt_update-1",
      doctype: "Note",
      documentName: "Audited Note",
      actorId: owner.id,
      payload: { kind: "DocumentUpdated", patch: { body: "Updated" } }
    });
  });

  it("rejects non-system managers before querying audit events", async () => {
    const { audit, documents } = createServices(["create-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Private Audit" }) });

    await expect(audit.search(owner, { doctype: "Note" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
  });

  it("rejects cross-tenant searches for tenant-scoped system managers", async () => {
    const { audit } = createServices(["create-1"]);

    await expect(audit.search(admin, { tenantId: "other" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
  });

  it("validates event kind filters", async () => {
    const { audit } = createServices(["create-1"]);

    await expect(audit.search(admin, { kind: "MadeUpEvent" })).rejects.toMatchObject({
      code: "BAD_REQUEST"
    });
  });

  it("allows explicit admin role configuration for embedded apps", async () => {
    const { documents, store } = createServices(["create-1"]);
    const audit = new AuditService({ events: store, adminRoles: ["Task Manager"] });
    await documents.create({ actor: manager, doctype: "Note", data: data({ title: "Managed Audit" }) });

    const result = await audit.search(manager, { limit: 1 });

    expect(result.events.map((event) => event.id)).toEqual(["evt_create-1"]);
  });

  it("allows explicit platform-wide audit configuration to cross tenant boundaries", async () => {
    const { documents, store } = createServices(["create-1"]);
    const platformAudit = new AuditService({ events: store, allowCrossTenantSearch: true });
    await documents.create({
      actor: { ...owner, tenantId: "other" },
      tenantId: "other",
      doctype: "Note",
      data: data({ title: "Other Tenant Audit" })
    });

    const result = await platformAudit.search(admin, { tenantId: "other" });

    expect(result.events.map((event) => event.tenantId)).toEqual(["other"]);
  });

  it("recovers a deleted document snapshot and event trail from the immutable stream", async () => {
    const { audit, documents } = createServices(["create-1", "update-1", "delete-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Deleted Audit" }) });
    await documents.update({
      actor: owner,
      doctype: "Note",
      name: "Deleted Audit",
      patch: { body: "Before delete" }
    });
    await documents.delete({ actor: manager, doctype: "Note", name: "Deleted Audit", expectedVersion: 2 });

    const recovered = await audit.recoverDeletedDocument(admin, {
      doctype: "Note",
      name: "Deleted Audit"
    });

    expect(recovered).toMatchObject({
      tenantId: "acme",
      doctype: "Note",
      name: "Deleted Audit",
      deletedAt: "2026-01-01T00:00:00.000Z",
      deletedBy: manager.id,
      deleteEventId: "evt_delete-1",
      snapshot: {
        docstatus: "deleted",
        data: { body: "Before delete" },
        version: 3
      }
    });
    expect(recovered.events.map((event) => event.payload.kind)).toEqual([
      "DocumentCreated",
      "DocumentUpdated",
      "DocumentDeleted"
    ]);
  });

  it("does not recover non-deleted documents through deleted audit recovery", async () => {
    const { audit, documents } = createServices(["create-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Live Audit" }) });

    await expect(
      audit.recoverDeletedDocument(admin, { doctype: "Note", name: "Live Audit" })
    ).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND"
    });
  });

  it("ignores off-stream events that claim the recovered document metadata", async () => {
    const { audit, documents, events } = createServices(["create-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Off Stream Audit" }) });
    await events.append("acme:Note:Different%20Stream", 0, [
      {
        id: "poison-delete",
        tenantId: "acme",
        stream: "acme:Note:Different%20Stream",
        type: "NoteDeleted",
        doctype: "Note",
        documentName: "Off Stream Audit",
        actorId: manager.id,
        occurredAt: "2026-01-01T00:00:00.000Z",
        payload: { kind: "DocumentDeleted" },
        metadata: {}
      }
    ]);

    await expect(
      audit.recoverDeletedDocument(admin, { doctype: "Note", name: "Off Stream Audit" })
    ).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND"
    });
  });

  it("rejects deleted document recovery when the stream exceeds the configured event budget", async () => {
    const { documents, store } = createServices(["create-1", "update-1", "delete-1"]);
    const audit = new AuditService({ events: store, maxDeletedDocumentEvents: 2 });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Large Deleted Audit" }) });
    await documents.update({
      actor: owner,
      doctype: "Note",
      name: "Large Deleted Audit",
      patch: { body: "Before delete" }
    });
    await documents.delete({ actor: manager, doctype: "Note", name: "Large Deleted Audit", expectedVersion: 2 });

    await expect(
      audit.recoverDeletedDocument(admin, { doctype: "Note", name: "Large Deleted Audit" })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST"
    });
  });
});
