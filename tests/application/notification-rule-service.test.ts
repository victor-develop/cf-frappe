import {
  AuditService,
  createDocumentNotificationHooks,
  createRegistry,
  CustomFieldService,
  deterministicIds,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  NotificationRuleService,
  SYSTEM_MANAGER_ROLE,
  UserNotificationService,
  notificationRulesStream
} from "../../src";
import { data, noteDocType, now, owner } from "../helpers";
import type {
  DocTypeDefinition,
  DocumentEventPayload,
  DocumentSnapshot,
  DomainEvent,
  NotificationRuleEventPayload
} from "../../src";

const admin = {
  id: "admin@example.com",
  roles: [SYSTEM_MANAGER_ROLE, "User"],
  tenantId: "acme"
};

describe("NotificationRuleService", () => {
  it("registers notification rule payloads through the domain event extension map", () => {
    const payload = notificationRulePayload({
      kind: "NotificationRuleSaved",
      doctypeName: "Note",
      rule: {
        name: "Managers on updates",
        events: ["DocumentUpdated"],
        recipients: [{ kind: "user", userId: "manager@example.com" }]
      }
    });

    expect(payload.rule.name).toBe("Managers on updates");
  });

  it("saves, clears, and audits notification rule metadata events", async () => {
    const events = new InMemoryDocumentStore();
    const service = new NotificationRuleService({
      registry: createRegistry({ doctypes: [noteDocType] }),
      events,
      ids: deterministicIds(["rule-1", "rule-2"]),
      clock: fixedClock(now)
    });

    const saved = await service.save({
      actor: admin,
      doctype: "Note",
      rule: {
        name: "Managers on updates",
        events: ["DocumentUpdated"],
        recipients: [{ kind: "user", userId: "manager@example.com" }],
        subject: "Note changed"
      },
      expectedVersion: 0
    });
    const repeated = await service.save({
      actor: admin,
      doctype: "Note",
      rule: {
        name: "Managers on updates",
        events: ["DocumentUpdated"],
        recipients: [{ kind: "user", userId: "manager@example.com" }],
        subject: "Note changed"
      },
      expectedVersion: 1
    });
    const cleared = await service.clear({
      actor: admin,
      doctype: "Note",
      ruleName: "Managers on updates",
      expectedVersion: 1
    });

    expect(saved).toMatchObject({
      tenantId: "acme",
      doctypeName: "Note",
      version: 1,
      rules: [{ rule: { name: "Managers on updates", subject: "Note changed" }, enabled: true }]
    });
    expect(repeated.version).toBe(1);
    expect(cleared).toMatchObject({ version: 2, rules: [] });
    await expect(events.readStream(notificationRulesStream("acme"))).resolves.toMatchObject([
      { id: "evt_rule-1", payload: { kind: "NotificationRuleSaved", rule: { name: "Managers on updates" } } },
      { id: "evt_rule-2", payload: { kind: "NotificationRuleCleared", ruleName: "Managers on updates" } }
    ]);
    await expect(new AuditService({ events }).search(admin, { kind: "NotificationRuleSaved" })).resolves.toMatchObject({
      events: [{ payload: { kind: "NotificationRuleSaved", rule: { name: "Managers on updates" } } }]
    });
  });

  it("requires admin authority, tenant ownership, expected versions, and valid rule metadata", async () => {
    const service = new NotificationRuleService({
      registry: createRegistry({ doctypes: [noteDocType] }),
      events: new InMemoryDocumentStore(),
      ids: deterministicIds(["rule-1"]),
      clock: fixedClock(now)
    });

    await expect(
      service.save({
        actor: owner,
        doctype: "Note",
        rule: { name: "Denied", events: ["DocumentUpdated"], recipients: [{ kind: "user", userId: "manager@example.com" }] }
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      service.save({
        actor: admin,
        tenantId: "globex",
        doctype: "Note",
        rule: { name: "Wrong tenant", events: ["DocumentUpdated"], recipients: [{ kind: "user", userId: "manager@example.com" }] }
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      service.save({
        actor: admin,
        doctype: "Note",
        expectedVersion: 1,
        rule: { name: "Stale", events: ["DocumentUpdated"], recipients: [{ kind: "user", userId: "manager@example.com" }] }
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
    await expect(
      service.save({
        actor: admin,
        doctype: "Note",
        rule: { name: "Bad event", events: ["UserNotificationRead" as never], recipients: [{ kind: "user", userId: "manager@example.com" }] }
      })
    ).rejects.toMatchObject({ code: "NOTIFICATION_RULE_INVALID" });
    await expect(
      service.save({
        actor: admin,
        doctype: "Note",
        rule: { name: "Bad field", events: ["DocumentUpdated"], recipients: [{ kind: "field", field: "count" }] }
      })
    ).rejects.toMatchObject({ code: "NOTIFICATION_RULE_INVALID" });
  });

  it("records rule-driven notifications through document afterCommit hooks", async () => {
    const registry = createRegistry({ doctypes: [noteDocType] });
    const store = new InMemoryDocumentStore();
    const rules = new NotificationRuleService({
      registry,
      events: store,
      ids: deterministicIds(["rule-1"]),
      clock: fixedClock(now)
    });
    const notifications = new UserNotificationService({
      events: store,
      notificationRules: rules,
      ids: deterministicIds(["notification-1"]),
      clock: fixedClock(now)
    });
    const hooks = createDocumentNotificationHooks(notifications);
    const documents = new DocumentService({
      registry,
      store,
      ids: deterministicIds(["create-1", "update-1"]),
      clock: fixedClock(now),
      ...(hooks.afterCommit === undefined ? {} : { afterCommit: hooks.afterCommit })
    });

    await rules.save({
      actor: admin,
      doctype: "Note",
      rule: {
        name: "Managers on updates",
        events: ["DocumentUpdated"],
        recipients: [
          { kind: "documentOwner" },
          { kind: "user", userId: "manager@example.com" }
        ],
        subject: "{{ doctype }} {{ name }} changed"
      }
    });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Notify Rule" }) });
    await documents.update({
      actor: owner,
      doctype: "Note",
      name: "Notify Rule",
      patch: { body: "Updated" },
      expectedVersion: 1
    });

    await expect(notifications.inbox({ id: "manager@example.com", roles: ["User"], tenantId: "acme" }))
      .resolves.toMatchObject({
        unreadCount: 1,
        notifications: [
          {
            id: "evt_update-1:rule:Managers%20on%20updates:user:manager%40example.com",
            sourceEventId: "evt_update-1",
            payloadKind: "DocumentUpdated",
            ruleName: "Managers on updates",
            subject: "Note Notify Rule changed"
          }
        ]
      });
    await expect(notifications.inbox(owner)).resolves.toMatchObject({ notifications: [] });
  });

  it("can target fields introduced by upstream custom-field overlays", async () => {
    const registry = createRegistry({ doctypes: [noteDocType] });
    const store = new InMemoryDocumentStore();
    const customFields = new CustomFieldService({
      registry,
      events: store,
      ids: deterministicIds(["custom-field-1"]),
      clock: fixedClock(now)
    });
    const doctypeResolver = (base: DocTypeDefinition, context: { readonly tenantId: string }) =>
      customFields.effectiveDocType(base.name, context.tenantId);
    const rules = new NotificationRuleService({
      registry,
      events: store,
      ids: deterministicIds(["rule-1"]),
      clock: fixedClock(now),
      preNotificationRuleDocTypeResolver: doctypeResolver
    });
    const notifications = new UserNotificationService({
      events: store,
      notificationRules: rules,
      ids: deterministicIds(["notification-1"]),
      clock: fixedClock(now)
    });
    const hooks = createDocumentNotificationHooks(notifications);
    const documents = new DocumentService({
      registry,
      store,
      doctypeResolver: (base, context) => doctypeResolver(base, { tenantId: context.tenantId }),
      ids: deterministicIds(["create-1", "update-1"]),
      clock: fixedClock(now),
      ...(hooks.afterCommit === undefined ? {} : { afterCommit: hooks.afterCommit })
    });

    await customFields.saveField({
      actor: admin,
      doctype: "Note",
      field: { name: "reviewer", type: "text" }
    });
    await rules.save({
      actor: admin,
      doctype: "Note",
      rule: {
        name: "Reviewer updates",
        events: ["DocumentUpdated"],
        recipients: [{ kind: "field", field: "reviewer" }]
      }
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Custom Recipient", reviewer: "reviewer@example.com" })
    });
    await documents.update({
      actor: owner,
      doctype: "Note",
      name: "Custom Recipient",
      patch: { body: "Updated" },
      expectedVersion: 1
    });

    await expect(notifications.inbox({ id: "reviewer@example.com", roles: ["User"], tenantId: "acme" }))
      .resolves.toMatchObject({
        notifications: [
          {
            id: "evt_update-1:rule:Reviewer%20updates:user:reviewer%40example.com",
            ruleName: "Reviewer updates"
          }
        ]
      });
  });

  it("evaluates delivery rules as of the source document event time", async () => {
    const store = new InMemoryDocumentStore();
    const rules = new NotificationRuleService({
      registry: createRegistry({ doctypes: [noteDocType] }),
      events: store,
      ids: deterministicIds(["rule-1"]),
      clock: fixedClock("2026-01-01T01:00:00.000Z")
    });
    const notifications = new UserNotificationService({
      events: store,
      notificationRules: rules,
      ids: deterministicIds(["notification-1"])
    });

    await rules.save({
      actor: admin,
      doctype: "Note",
      rule: {
        name: "Late rule",
        events: ["DocumentUpdated"],
        recipients: [{ kind: "user", userId: "manager@example.com" }]
      }
    });

    await expect(rules.notificationRulesFor("acme", "Note", { occurredAt: now })).resolves.toEqual([]);
    await expect(rules.notificationRulesFor("acme", "Note")).resolves.toEqual([
      expect.objectContaining({ name: "Late rule" })
    ]);
    await expect(notifications.recordFromDomainEvent(documentUpdatedEvent("evt_old_update"), noteSnapshot()))
      .resolves.toEqual([]);
  });

  it("exposes enabled rules through the delivery provider", async () => {
    const service = new NotificationRuleService({
      registry: createRegistry({ doctypes: [noteDocType] }),
      events: new InMemoryDocumentStore(),
      ids: deterministicIds(["rule-1", "rule-2"])
    });

    await service.save({
      actor: admin,
      doctype: "Note",
      rule: { name: "Enabled", events: ["DocumentUpdated"], recipients: [{ kind: "user", userId: "manager@example.com" }] }
    });
    await service.save({
      actor: admin,
      doctype: "Note",
      rule: {
        name: "Disabled",
        enabled: false,
        events: ["DocumentUpdated"],
        recipients: [{ kind: "user", userId: "disabled@example.com" }]
      },
      expectedVersion: 1
    });

    await expect(service.notificationRulesFor("acme", "Note")).resolves.toEqual([
      expect.objectContaining({ name: "Enabled" })
    ]);
  });
});

function notificationRulePayload(
  payload: Extract<DocumentEventPayload, { readonly kind: "NotificationRuleSaved" }>
): Extract<NotificationRuleEventPayload, { readonly kind: "NotificationRuleSaved" }> {
  return payload;
}

function documentUpdatedEvent(id: string): DomainEvent {
  return {
    id,
    tenantId: "acme",
    stream: "acme:Note:Temporal",
    sequence: 2,
    type: "NoteUpdated",
    doctype: "Note",
    documentName: "Temporal",
    actorId: owner.id,
    occurredAt: now,
    payload: { kind: "DocumentUpdated", patch: { body: "Updated" } },
    metadata: {}
  };
}

function noteSnapshot(): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Note",
    name: "Temporal",
    version: 2,
    docstatus: "draft",
    data: data({ title: "Temporal" }),
    createdAt: now,
    updatedAt: now
  };
}
