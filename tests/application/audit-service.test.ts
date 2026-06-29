import {
  AuditService,
  createInMemoryAccountRecoveryNotifier,
  RoleService,
  SYSTEM_MANAGER_ROLE,
  UserAccountService,
  deterministicIds,
  documentStream,
  fixedClock,
  type DomainEvent,
  type PasswordHasher
} from "../../src";
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

  it("searches document share events by audit kind", async () => {
    const { audit, documents } = createServices(["create-1", "share-1", "revoke-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Share Audit" }) });
    await documents.share({
      actor: owner,
      doctype: "Note",
      name: "Share Audit",
      userId: "collab@example.com",
      permissions: ["read"],
      expectedVersion: 1
    });
    await documents.revokeShare({
      actor: owner,
      doctype: "Note",
      name: "Share Audit",
      userId: "collab@example.com",
      expectedVersion: 2
    });

    const shared = await audit.search(admin, {
      doctype: "Note",
      name: "Share Audit",
      kind: "DocumentShared"
    });
    const revoked = await audit.search(admin, {
      doctype: "Note",
      name: "Share Audit",
      kind: "DocumentShareRevoked"
    });

    expect(shared.events).toHaveLength(1);
    expect(shared.events[0]).toMatchObject({
      id: "evt_share-1",
      payload: { kind: "DocumentShared", userId: "collab@example.com", permissions: ["read"] }
    });
    expect(revoked.events).toHaveLength(1);
    expect(revoked.events[0]).toMatchObject({
      id: "evt_revoke-1",
      payload: { kind: "DocumentShareRevoked", userId: "collab@example.com" }
    });
  });

  it("searches saved report events by audit kind", async () => {
    const { audit, savedReports } = createServices(["create-1"], {
      savedReportIds: ["audit", "event-1", "event-2"]
    });
    const saved = await savedReports.save({
      actor: owner,
      doctype: "Note",
      label: "Audit report",
      definition: { columns: [{ name: "title" }] }
    });
    await savedReports.delete({ actor: owner, doctype: "Note", id: saved.id });

    const savedEvents = await audit.search(admin, {
      doctype: "Note",
      name: saved.id,
      kind: "SavedReportSaved"
    });
    const deletedEvents = await audit.search(admin, {
      doctype: "Note",
      name: saved.id,
      kind: "SavedReportDeleted"
    });

    expect(savedEvents.events).toHaveLength(1);
    expect(savedEvents.events[0]).toMatchObject({
      id: "evt_event-1",
      payload: { kind: "SavedReportSaved", reportId: saved.id, label: "Audit report" }
    });
    expect(deletedEvents.events).toHaveLength(1);
    expect(deletedEvents.events[0]).toMatchObject({
      id: "evt_event-2",
      payload: { kind: "SavedReportDeleted", reportId: saved.id }
    });
  });

  it("redacts account password and recovery hashes from audit search results", async () => {
    const { audit, events } = createServices(["create-1"]);
    const recovery = createInMemoryAccountRecoveryNotifier();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      recovery,
      ids: deterministicIds([
        "account-1",
        "password-1",
        "reset-request-1",
        "reset-complete-1",
        "verify-request-1"
      ]),
      recoveryTokens: deterministicIds(["reset-token-1", "verify-token-1"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    await userAccounts.create({
      actor: admin,
      userId: "owner@example.com",
      email: "owner@example.com",
      password: "secret-123",
      roles: ["User"]
    });
    await userAccounts.changePassword({
      actor: admin,
      userId: "owner@example.com",
      password: "secret-456",
      expectedVersion: 1
    });
    await userAccounts.requestPasswordReset({ tenantId: "acme", userId: "owner@example.com" });
    await userAccounts.resetPassword({
      tenantId: "acme",
      userId: "owner@example.com",
      token: "tok_reset-token-1",
      password: "secret-789"
    });
    await userAccounts.requestEmailVerification({ tenantId: "acme", userId: "owner@example.com" });

    const created = await audit.search(admin, {
      doctype: "__UserAccounts",
      name: "owner@example.com",
      kind: "UserAccountCreated"
    });
    const changed = await audit.search(admin, {
      doctype: "__UserAccounts",
      name: "owner@example.com",
      kind: "UserPasswordChanged"
    });
    const resetRequested = await audit.search(admin, {
      doctype: "__UserAccounts",
      name: "owner@example.com",
      kind: "UserPasswordResetRequested"
    });
    const resetCompleted = await audit.search(admin, {
      doctype: "__UserAccounts",
      name: "owner@example.com",
      kind: "UserPasswordResetCompleted"
    });
    const emailRequested = await audit.search(admin, {
      doctype: "__UserAccounts",
      name: "owner@example.com",
      kind: "UserEmailVerificationRequested"
    });

    expect(created.events[0]).toMatchObject({
      payload: { kind: "UserAccountCreated", passwordHash: "[redacted]" }
    });
    expect(changed.events[0]).toMatchObject({
      payload: { kind: "UserPasswordChanged", passwordHash: "[redacted]" }
    });
    expect(resetRequested.events[0]).toMatchObject({
      payload: { kind: "UserPasswordResetRequested", tokenHash: "[redacted]" }
    });
    expect(resetCompleted.events[0]).toMatchObject({
      payload: { kind: "UserPasswordResetCompleted", passwordHash: "[redacted]" }
    });
    expect(emailRequested.events[0]).toMatchObject({
      payload: { kind: "UserEmailVerificationRequested", tokenHash: "[redacted]" }
    });
  });

  it("redacts sensitive audit payloads by payload kind instead of event type name", async () => {
    const misleadingTypedAccountEvent: DomainEvent = {
      id: "evt_account_created",
      tenantId: "acme",
      stream: "acme:__UserAccounts:owner%40example.com",
      sequence: 1,
      type: "NoteDeleted",
      doctype: "__UserAccounts",
      documentName: "owner@example.com",
      actorId: admin.id,
      occurredAt: "2026-01-02T00:00:00.000Z",
      payload: {
        kind: "UserAccountCreated",
        userId: "owner@example.com",
        email: "owner@example.com",
        roles: ["User"],
        passwordHash: "hash:secret-123",
        enabled: true
      },
      metadata: {}
    };
    const audit = new AuditService({
      events: {
        searchEvents: async (query) => {
          expect(query.payloadKinds).toEqual(["UserAccountCreated"]);
          return [misleadingTypedAccountEvent];
        },
        readDocumentEvents: async () => []
      }
    });

    const result = await audit.search(admin, {
      doctype: "__UserAccounts",
      name: "owner@example.com",
      kind: "UserAccountCreated"
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: "NoteDeleted",
      payload: {
        kind: "UserAccountCreated",
        userId: "owner@example.com",
        passwordHash: "[redacted]"
      }
    });
  });

  it("searches role catalog events by audit kind", async () => {
    const { audit, events } = createServices(["unused"]);
    const roles = new RoleService({
      events,
      ids: deterministicIds(["role-1"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    await roles.create({
      actor: admin,
      role: "Support Lead",
      description: "Escalation owner"
    });

    const result = await audit.search(admin, {
      doctype: "__Roles",
      name: "catalog",
      kind: "RoleCreated"
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: "evt_role-1",
      payload: { kind: "RoleCreated", role: "Support Lead", description: "Escalation owner" }
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

  it("derives deleted recovery metadata from the source delete event identity", async () => {
    const { audit, documents, events } = createServices(["create-1", "delete-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Deleted Source Audit" }) });
    await documents.delete({ actor: manager, doctype: "Note", name: "Deleted Source Audit", expectedVersion: 1 });
    await events.append(documentStream("acme", "Note", "Deleted Source Audit"), 2, [
      {
        id: "evt_after-delete-comment",
        tenantId: "acme",
        stream: documentStream("acme", "Note", "Deleted Source Audit"),
        type: "NoteCommentAdded",
        doctype: "Note",
        documentName: "Deleted Source Audit",
        actorId: owner.id,
        occurredAt: "2026-01-01T00:01:00.000Z",
        payload: { kind: "DocumentCommentAdded", text: "late audit note" },
        metadata: {}
      }
    ]);

    const recovered = await audit.recoverDeletedDocument(admin, {
      doctype: "Note",
      name: "Deleted Source Audit"
    });

    expect(recovered).toMatchObject({
      deleteEventId: "evt_delete-1",
      deletedBy: manager.id,
      deletedAt: "2026-01-01T00:00:00.000Z",
      snapshot: {
        docstatus: "deleted",
        version: 3
      }
    });
    expect(recovered.events.map((event) => event.payload.kind)).toEqual([
      "DocumentCreated",
      "DocumentDeleted",
      "DocumentCommentAdded"
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

function deterministicPasswords(): PasswordHasher {
  return {
    async hash(password) {
      return `hash:${password}`;
    },
    async verify(password, encodedHash) {
      return encodedHash === `hash:${password}`;
    }
  };
}
