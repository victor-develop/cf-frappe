import {
  InMemoryEventStore,
  UserNotificationService,
  createResourceApi,
  deterministicIds,
  fixedClock,
  unsafeHeaderActorResolver
} from "../../src";
import { createServices, now } from "../helpers";
import type { DomainEvent } from "../../src";

describe("notification api", () => {
  it("lists, reads, and dismisses durable user notifications", async () => {
    const services = createServices();
    const notifications = new UserNotificationService({
      events: new InMemoryEventStore(),
      clock: fixedClock("2026-01-01T01:00:00.000Z"),
      ids: deterministicIds(["record-1", "read-1", "dismiss-1"])
    });
    await notifications.recordFromDomainEvent(assignmentEvent("evt_assign", "support@example.com"));
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      notifications,
      actor: unsafeHeaderActorResolver
    });

    const list = await app.request("/api/notifications", { headers: supportHeaders });

    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      data: {
        userId: "support@example.com",
        unreadCount: 1,
        notifications: [
          {
            id: "evt_assign:user:support%40example.com",
            subject: "owner@example.com assigned you to Note My Note",
            read: false,
            dismissed: false
          }
        ]
      }
    });

    const read = await app.request("/api/notifications/evt_assign:user:support%2540example.com/read", {
      method: "POST",
      headers: supportHeaders
    });
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      data: { id: "evt_assign:user:support%40example.com", read: true, readBy: "support@example.com" }
    });

    const dismissed = await app.request("/api/notifications/evt_assign:user:support%2540example.com/dismiss", {
      method: "POST",
      headers: supportHeaders
    });
    expect(dismissed.status).toBe(200);
    await expect(dismissed.json()).resolves.toMatchObject({
      data: { id: "evt_assign:user:support%40example.com", dismissed: true, dismissedBy: "support@example.com" }
    });

    const hidden = await app.request("/api/notifications", { headers: supportHeaders });
    await expect(hidden.json()).resolves.toMatchObject({ data: { unreadCount: 0, notifications: [] } });
    const included = await app.request("/api/notifications?include_dismissed=1", { headers: supportHeaders });
    await expect(included.json()).resolves.toMatchObject({
      data: { notifications: [{ id: "evt_assign:user:support%40example.com", read: true, dismissed: true }] }
    });
  });

  it("prevents non-admin users from reading another user's inbox", async () => {
    const services = createServices();
    const notifications = new UserNotificationService({
      events: new InMemoryEventStore(),
      ids: deterministicIds(["record-1"])
    });
    await notifications.recordFromDomainEvent(assignmentEvent("evt_assign", "support@example.com"));
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      notifications,
      actor: unsafeHeaderActorResolver
    });

    const denied = await app.request("/api/notifications?user=support@example.com", { headers: otherHeaders });
    const admin = await app.request("/api/notifications?user=support@example.com", { headers: adminHeaders });
    const deniedRead = await app.request("/api/notifications/evt_assign:user:support%2540example.com/read?user=support@example.com", {
      method: "POST",
      headers: otherHeaders
    });
    const deniedDismiss = await app.request("/api/notifications/evt_assign:user:support%2540example.com/dismiss?user=support@example.com", {
      method: "POST",
      headers: otherHeaders
    });

    expect(denied.status).toBe(403);
    expect(deniedRead.status).toBe(403);
    expect(deniedDismiss.status).toBe(403);
    expect(admin.status).toBe(200);
    await expect(admin.json()).resolves.toMatchObject({
      data: { userId: "support@example.com", notifications: [{ id: "evt_assign:user:support%40example.com" }] }
    });
  });
});

const supportHeaders = {
  "x-cf-frappe-user": "support@example.com",
  "x-cf-frappe-roles": "User",
  "x-cf-frappe-tenant": "acme"
};

const otherHeaders = {
  ...supportHeaders,
  "x-cf-frappe-user": "other@example.com"
};

const adminHeaders = {
  ...supportHeaders,
  "x-cf-frappe-user": "admin@example.com",
  "x-cf-frappe-roles": "System Manager"
};

function assignmentEvent(id: string, assigneeId: string): DomainEvent {
  return {
    id,
    tenantId: "acme",
    stream: "acme:Note:My Note",
    sequence: 2,
    type: "NoteAssigned",
    doctype: "Note",
    documentName: "My Note",
    actorId: "owner@example.com",
    occurredAt: now,
    payload: { kind: "DocumentAssigned", assigneeId },
    metadata: {}
  };
}
