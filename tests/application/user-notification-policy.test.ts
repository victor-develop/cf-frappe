import {
  normalizeUserNotificationId,
  normalizeUserNotificationInboxLimit,
  normalizeUserNotificationUserId,
  planUserNotificationAccess,
  planUserNotificationDismiss,
  planUserNotificationLookup,
  planUserNotificationRecord,
  planUserNotificationRead,
  userNotificationInboxProjection
} from "../../src/application/user-notification-policy.js";
import { SYSTEM_MANAGER_ROLE } from "../../src";
import type {
  UserNotificationRecord,
  UserNotificationState
} from "../../src/application/user-notification-events.js";

const now = "2026-01-01T00:00:00.000Z";

describe("user notification policy", () => {
  it("plans notification access for the actor inbox and default tenant", () => {
    expect(planUserNotificationAccess({
      actor: { id: "support@example.com", roles: ["User"], tenantId: "acme" },
      adminRoles: [SYSTEM_MANAGER_ROLE]
    })).toEqual({ status: "allow", tenantId: "acme", userId: "support@example.com" });

    expect(planUserNotificationAccess({
      actor: { id: "support@example.com", roles: ["User"] },
      adminRoles: [SYSTEM_MANAGER_ROLE]
    })).toEqual({ status: "allow", tenantId: "default", userId: "support@example.com" });
  });

  it("denies non-admin notification access to another inbox", () => {
    expect(planUserNotificationAccess({
      actor: { id: "support@example.com", roles: ["User"], tenantId: "acme" },
      adminRoles: [SYSTEM_MANAGER_ROLE],
      explicitUserId: "manager@example.com"
    })).toEqual({
      status: "deny",
      message: "Actor 'support@example.com' cannot inspect notifications for 'manager@example.com'"
    });
  });

  it("allows notification admins to inspect another user inbox", () => {
    expect(planUserNotificationAccess({
      actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      adminRoles: [SYSTEM_MANAGER_ROLE],
      explicitUserId: " support@example.com "
    })).toEqual({ status: "allow", tenantId: "acme", userId: "support@example.com" });
  });

  it("plans notification read and dismissal changes idempotently", () => {
    expect(planUserNotificationRead(record("evt_unread:user:support"))).toEqual({ status: "append" });
    expect(planUserNotificationRead(record("evt_read:user:support", { read: true }))).toEqual({ status: "noop" });
    expect(planUserNotificationDismiss(record("evt_active:user:support"))).toEqual({ status: "append" });
    expect(planUserNotificationDismiss(record("evt_dismissed:user:support", { dismissed: true }))).toEqual({
      status: "noop"
    });
  });

  it("plans notification recording idempotently from folded inbox state", () => {
    const existing = record("evt_existing:user:support");
    expect(planUserNotificationRecord(state([existing]), existing.id)).toEqual({
      status: "noop",
      notification: existing
    });
    expect(planUserNotificationRecord(state([existing]), "evt_new:user:support")).toEqual({ status: "append" });
  });

  it("plans notification lookups before read and dismiss service error mapping", () => {
    const existing = record("evt_existing:user:support");

    expect(planUserNotificationLookup(state([existing]), existing.id)).toEqual({
      status: "found",
      notification: existing
    });
    expect(planUserNotificationLookup(state([existing]), "evt_missing:user:support")).toEqual({
      status: "missing",
      message: "Notification 'evt_missing:user:support' was not found",
      code: "DOCUMENT_NOT_FOUND"
    });
  });

  it("normalizes notification user ids", () => {
    expect(normalizeUserNotificationUserId("  support@example.com  ")).toBe("support@example.com");
    expect(() => normalizeUserNotificationUserId(" ")).toThrow("Notification user is required");
  });

  it("normalizes notification ids", () => {
    expect(normalizeUserNotificationId("  evt_assign:user:support  ")).toBe("evt_assign:user:support");
    expect(() => normalizeUserNotificationId("")).toThrow("Notification id is required");
  });

  it("normalizes inbox limits", () => {
    expect(normalizeUserNotificationInboxLimit(undefined)).toBe(50);
    expect(normalizeUserNotificationInboxLimit(200)).toBe(200);
    expect(() => normalizeUserNotificationInboxLimit(0)).toThrow("Notification limit must be between 1 and 200");
    expect(() => normalizeUserNotificationInboxLimit(201)).toThrow("Notification limit must be between 1 and 200");
  });

  it("projects inboxes with unread and dismissed filters", () => {
    const inbox = userNotificationInboxProjection({
      state: state([
        record("evt_new:user:support", { createdAt: "2026-01-01T00:03:00.000Z" }),
        record("evt_read:user:support", { read: true, createdAt: "2026-01-01T00:02:00.000Z" }),
        record("evt_dismissed:user:support", { dismissed: true, createdAt: "2026-01-01T00:01:00.000Z" })
      ]),
      limit: 50,
      unreadOnly: true
    });

    expect(inbox).toMatchObject({
      tenantId: "acme",
      userId: "support@example.com",
      limit: 50,
      unreadCount: 1,
      filters: { unreadOnly: true, includeDismissed: false }
    });
    expect(inbox.notifications.map((notification) => notification.id)).toEqual(["evt_new:user:support"]);
  });

  it("projects included dismissed notifications with deterministic newest-first limits", () => {
    const inbox = userNotificationInboxProjection({
      state: state([
        record("evt_b:user:support", { createdAt: "2026-01-01T00:02:00.000Z" }),
        record("evt_a:user:support", { createdAt: "2026-01-01T00:02:00.000Z" }),
        record("evt_old:user:support", { createdAt: "2026-01-01T00:01:00.000Z", dismissed: true })
      ]),
      limit: 2,
      includeDismissed: true
    });

    expect(inbox.unreadCount).toBe(2);
    expect(inbox.filters).toEqual({ unreadOnly: false, includeDismissed: true });
    expect(inbox.notifications.map((notification) => notification.id)).toEqual([
      "evt_b:user:support",
      "evt_a:user:support"
    ]);
  });
});

function state(records: readonly UserNotificationRecord[]): UserNotificationState {
  return {
    tenantId: "acme",
    userId: "support@example.com",
    version: 1,
    notifications: new Map(records.map((record) => [record.id, record]))
  };
}

function record(id: string, overrides: Partial<UserNotificationRecord> = {}): UserNotificationRecord {
  return {
    id,
    tenantId: "acme",
    recipientId: "support@example.com",
    sourceEventId: "evt_source",
    eventType: "NoteAssigned",
    payloadKind: "DocumentAssigned",
    doctype: "Note",
    documentName: "My Note",
    actorId: "owner@example.com",
    subject: "owner@example.com assigned you to Note My Note",
    read: false,
    dismissed: false,
    createdAt: now,
    ...overrides
  };
}
