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

  it("searches activity feed events by audit kind", async () => {
    const { audit, documents } = createServices(["create-1", "activity-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Activity Audit" }) });
    await documents.recordActivity({
      actor: owner,
      doctype: "Note",
      name: "Activity Audit",
      activityType: "email",
      subject: "Follow-up sent",
      expectedVersion: 1
    });

    const result = await audit.search(admin, {
      doctype: "Note",
      name: "Activity Audit",
      kind: "DocumentActivityRecorded"
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: "evt_activity-1",
      payload: {
        kind: "DocumentActivityRecorded",
        activityType: "email",
        subject: "Follow-up sent"
      }
    });
  });

  it("searches tag events by audit kind", async () => {
    const { audit, documents } = createServices(["create-1", "tag-1", "untag-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Tag Audit" }) });
    await documents.tag({
      actor: owner,
      doctype: "Note",
      name: "Tag Audit",
      tag: "Urgent",
      expectedVersion: 1
    });
    await documents.untag({
      actor: owner,
      doctype: "Note",
      name: "Tag Audit",
      tag: "Urgent",
      expectedVersion: 2
    });

    const tagged = await audit.search(admin, {
      doctype: "Note",
      name: "Tag Audit",
      kind: "DocumentTagged"
    });
    const untagged = await audit.search(admin, {
      doctype: "Note",
      name: "Tag Audit",
      kind: "DocumentUntagged"
    });

    expect(tagged.events).toHaveLength(1);
    expect(tagged.events[0]).toMatchObject({
      id: "evt_tag-1",
      payload: { kind: "DocumentTagged", tag: "Urgent" }
    });
    expect(untagged.events).toHaveLength(1);
    expect(untagged.events[0]).toMatchObject({
      id: "evt_untag-1",
      payload: { kind: "DocumentUntagged", tag: "Urgent" }
    });
  });

  it("searches follow events by audit kind", async () => {
    const { audit, documents } = createServices(["create-1", "follow-1", "unfollow-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Follow Audit" }) });
    await documents.follow({
      actor: owner,
      doctype: "Note",
      name: "Follow Audit",
      expectedVersion: 1
    });
    await documents.unfollow({
      actor: owner,
      doctype: "Note",
      name: "Follow Audit",
      expectedVersion: 2
    });

    const followed = await audit.search(admin, {
      doctype: "Note",
      name: "Follow Audit",
      kind: "DocumentFollowed"
    });
    const unfollowed = await audit.search(admin, {
      doctype: "Note",
      name: "Follow Audit",
      kind: "DocumentUnfollowed"
    });

    expect(followed.events).toHaveLength(1);
    expect(followed.events[0]).toMatchObject({
      id: "evt_follow-1",
      payload: { kind: "DocumentFollowed", followerId: owner.id }
    });
    expect(unfollowed.events).toHaveLength(1);
    expect(unfollowed.events[0]).toMatchObject({
      id: "evt_unfollow-1",
      payload: { kind: "DocumentUnfollowed", followerId: owner.id }
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
