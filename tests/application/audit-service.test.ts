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
});
