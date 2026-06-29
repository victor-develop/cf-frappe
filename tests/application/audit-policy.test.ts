import {
  assertDeletedDocumentEventWindow,
  auditSearchPlan,
  deletedDocumentAuditProjection,
  documentCreatedPayload,
  documentDeletedPayload,
  normalizeAuditLimit,
  normalizeDeletedDocumentEventLimit,
  planAuditTenantAccess,
  redactSensitiveAuditEvents,
  redactSensitiveAuditPayload,
  SYSTEM_MANAGER_ROLE,
  userAccountCreatedPayload,
  userEmailVerificationRequestedPayload,
  userPasswordChangedPayload,
  userPasswordResetCompletedPayload,
  userPasswordResetRequestedPayload,
  type DomainEvent
} from "../../src";

describe("audit policy", () => {
  it("allows audit admins to search their tenant or the default tenant", () => {
    expect(planAuditTenantAccess({
      actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      adminRoles: [SYSTEM_MANAGER_ROLE],
      allowCrossTenantSearch: false
    })).toEqual({ status: "allow", tenantId: "acme" });

    expect(planAuditTenantAccess({
      actor: { id: "platform@example.com", roles: [SYSTEM_MANAGER_ROLE] },
      adminRoles: [SYSTEM_MANAGER_ROLE],
      allowCrossTenantSearch: false
    })).toEqual({ status: "allow", tenantId: "default" });
  });

  it("denies audit search to non-admin actors before planning store queries", () => {
    expect(planAuditTenantAccess({
      actor: { id: "reader@example.com", roles: ["User"], tenantId: "acme" },
      adminRoles: [SYSTEM_MANAGER_ROLE],
      allowCrossTenantSearch: false
    })).toEqual({
      status: "deny",
      message: "Actor 'reader@example.com' cannot search audit events"
    });
  });

  it("keeps cross-tenant audit search behind an explicit policy flag", () => {
    expect(planAuditTenantAccess({
      actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      adminRoles: [SYSTEM_MANAGER_ROLE],
      allowCrossTenantSearch: false,
      explicitTenantId: "other"
    })).toEqual({
      status: "deny",
      message: "Actor 'admin@example.com' cannot search audit events for tenant 'other'"
    });

    expect(planAuditTenantAccess({
      actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      adminRoles: [SYSTEM_MANAGER_ROLE],
      allowCrossTenantSearch: true,
      explicitTenantId: "other"
    })).toEqual({ status: "allow", tenantId: "other" });
  });

  it("builds normalized audit search filters and store queries", () => {
    const plan = auditSearchPlan({
      doctype: "Note",
      name: "NOTE-1",
      actorId: "owner@example.com",
      kind: "DocumentUpdated",
      since: "2026-01-01T00:00:00.000Z",
      until: "2026-01-02T00:00:00.000Z",
      limit: 250
    });

    expect(plan).toEqual({
      limit: 200,
      filters: {
        doctype: "Note",
        name: "NOTE-1",
        actorId: "owner@example.com",
        kind: "DocumentUpdated",
        since: "2026-01-01T00:00:00.000Z",
        until: "2026-01-02T00:00:00.000Z"
      },
      query: {
        doctype: "Note",
        documentName: "NOTE-1",
        actorId: "owner@example.com",
        payloadKinds: ["DocumentUpdated"],
        since: "2026-01-01T00:00:00.000Z",
        until: "2026-01-02T00:00:00.000Z",
        limit: 200
      }
    });
  });

  it("defaults audit search limits and rejects invalid limits or kinds", () => {
    expect(auditSearchPlan()).toMatchObject({ limit: 50, filters: {}, query: { limit: 50 } });
    expect(normalizeAuditLimit(1)).toBe(1);
    expect(normalizeAuditLimit(201)).toBe(200);
    expect(() => normalizeAuditLimit(0)).toThrow("Audit limit must be a positive integer");
    expect(() => auditSearchPlan({ kind: "NotARealEvent" })).toThrow("Unknown audit event kind 'NotARealEvent'");
  });

  it("normalizes deleted document recovery windows", () => {
    expect(normalizeDeletedDocumentEventLimit(undefined)).toBe(1_000);
    expect(normalizeDeletedDocumentEventLimit(5)).toBe(5);
    expect(() => normalizeDeletedDocumentEventLimit(0)).toThrow(
      "Deleted document recovery event limit must be a positive integer"
    );
    expect(() => assertDeletedDocumentEventWindow([event(1, documentDeletedPayload())], 0)).toThrow(
      "Deleted document recovery needs more than 0 events; narrow or raise the configured limit"
    );
  });

  it("redacts sensitive audit payload secrets while preserving event context", () => {
    const events = redactSensitiveAuditEvents([
      event(1, userAccountCreatedPayload({
        userId: "user@example.com",
        email: "user@example.com",
        roles: ["User"],
        passwordHash: "hashed-password",
        enabled: true
      })),
      event(2, userPasswordChangedPayload({ userId: "user@example.com", passwordHash: "changed-hash" })),
      event(3, userPasswordResetRequestedPayload({
        userId: "user@example.com",
        tokenHash: "reset-token",
        expiresAt: "2026-01-01T00:10:00.000Z"
      })),
      event(4, userPasswordResetCompletedPayload({ userId: "user@example.com", passwordHash: "reset-hash" })),
      event(5, userEmailVerificationRequestedPayload({
        userId: "user@example.com",
        email: "user@example.com",
        tokenHash: "verify-token",
        expiresAt: "2026-01-01T00:10:00.000Z"
      }))
    ]);

    expect(events.map((item) => item.payload)).toEqual([
      expect.objectContaining({ kind: "UserAccountCreated", passwordHash: "[redacted]" }),
      expect.objectContaining({ kind: "UserPasswordChanged", passwordHash: "[redacted]" }),
      expect.objectContaining({ kind: "UserPasswordResetRequested", tokenHash: "[redacted]" }),
      expect.objectContaining({ kind: "UserPasswordResetCompleted", passwordHash: "[redacted]" }),
      expect.objectContaining({ kind: "UserEmailVerificationRequested", tokenHash: "[redacted]" })
    ]);
    expect(events[0]?.id).toBe("evt_1");
    expect(events[0]?.actorId).toBe("actor@example.com");
  });

  it("leaves user creation audit payloads without password hashes untouched", () => {
    const source = event(1, userAccountCreatedPayload({
      userId: "sso@example.com",
      email: "sso@example.com",
      roles: ["User"],
      enabled: true
    }));

    expect(redactSensitiveAuditPayload(source)).toEqual(source);
  });

  it("projects deleted document audits from immutable document events", () => {
    const events = [
      event(1, documentCreatedPayload({ title: "Deleted Note", count: 1 }, "draft")),
      event(2, documentDeletedPayload(), { actorId: "deleter@example.com", occurredAt: "2026-01-01T00:01:00.000Z" })
    ];

    const projection = deletedDocumentAuditProjection({
      tenantId: "acme",
      doctype: "Note",
      name: "Deleted Note",
      events
    });

    expect(projection).toMatchObject({
      tenantId: "acme",
      doctype: "Note",
      name: "Deleted Note",
      deletedAt: "2026-01-01T00:01:00.000Z",
      deletedBy: "deleter@example.com",
      deleteEventId: "evt_2",
      snapshot: {
        tenantId: "acme",
        doctype: "Note",
        name: "Deleted Note",
        version: 2,
        docstatus: "deleted",
        data: { title: "Deleted Note", count: 1 }
      },
      events
    });
  });

  it("rejects deleted document audit projections for live or missing documents", () => {
    expect(() =>
      deletedDocumentAuditProjection({
        tenantId: "acme",
        doctype: "Note",
        name: "Live Note",
        events: [event(1, documentCreatedPayload({ title: "Live Note" }, "draft"))]
      })
    ).toThrow("Note/Live Note is not a deleted document");
    expect(() =>
      deletedDocumentAuditProjection({
        tenantId: "acme",
        doctype: "Note",
        name: "Missing Note",
        events: []
      })
    ).toThrow("Note/Missing Note is not a deleted document");
  });
});

function event(
  sequence: number,
  payload: DomainEvent["payload"],
  overrides: Partial<Omit<DomainEvent, "payload" | "sequence">> = {}
): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "document:acme:Note:Deleted Note",
    sequence,
    type: payload.kind,
    doctype: "Note",
    documentName: "Deleted Note",
    actorId: "actor@example.com",
    occurredAt: `2026-01-01T00:00:0${sequence}.000Z`,
    payload,
    metadata: {},
    ...overrides
  };
}
