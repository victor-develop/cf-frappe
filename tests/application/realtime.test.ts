import {
  createDocumentDeliveryHooks,
  createDocumentRealtimeHooks,
  EmailNotificationService,
  type EmailMessage,
  InMemoryEventStore,
  InMemoryRealtimePublisher
} from "../../src";
import { UserNotificationService, deterministicIds } from "../../src";
import { createServices, data, owner } from "../helpers";
import type { RealtimePublishResult } from "../../src";

describe("document realtime hooks", () => {
  it("publishes committed domain events to realtime topics", async () => {
    const publisher = new InMemoryRealtimePublisher();
    const hooks = createDocumentRealtimeHooks(publisher);
    const services = createServices(["evt1"], {
      afterCommit: async (context) => {
        await hooks.afterCommit?.(context);
      }
    });

    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Realtime" }) });

    expect(publisher.events()).toHaveLength(1);
    expect(publisher.events()[0]).toMatchObject({
      id: "evt_evt1",
      type: "NoteCreated",
      topics: ["tenant:acme", "doctype:acme:Note", "document:acme:Note:Realtime"]
    });
  });

  it("publishes redacted per-user notifications for explicit user-recipient events", async () => {
    const publisher = new InMemoryRealtimePublisher();
    const hooks = createDocumentRealtimeHooks(publisher);
    const services = createServices(["create-1", "assign-1"], {
      afterCommit: async (context) => {
        await hooks.afterCommit?.(context);
      }
    });

    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Assigned Realtime" }) });
    await services.documents.assign({
      actor: owner,
      doctype: "Note",
      name: "Assigned Realtime",
      assignee: "support@example.com",
      expectedVersion: 1
    });

    expect(publisher.events()).toHaveLength(3);
    expect(publisher.events()[1]).toMatchObject({
      id: "evt_assign-1",
      type: "NoteAssigned",
      topics: ["tenant:acme", "doctype:acme:Note", "document:acme:Note:Assigned%20Realtime"]
    });
    expect(publisher.events()[2]).toMatchObject({
      id: "evt_assign-1:user:support%40example.com",
      type: "NoteAssigned",
      topics: ["user:acme:support%40example.com"],
      payload: {
        kind: "DocumentUserNotification",
        eventId: "evt_assign-1",
        payloadKind: "DocumentAssigned",
        doctype: "Note",
        documentName: "Assigned Realtime",
        actorId: owner.id,
        recipientId: "support@example.com"
      }
    });
    expect(JSON.stringify(publisher.events()[2]?.payload)).not.toContain("snapshot");
    expect(JSON.stringify(publisher.events()[2]?.payload)).not.toContain('"event":');
  });

  it("records durable notifications even when realtime fan-out fails", async () => {
    const notifications = new UserNotificationService({
      events: new InMemoryEventStore(),
      ids: deterministicIds(["record-1"])
    });
    const hooks = createDocumentDeliveryHooks({
      notifications,
      realtime: {
        publish(): Promise<RealtimePublishResult> {
          throw new Error("realtime unavailable");
        }
      }
    });
    const services = createServices(["create-1", "assign-1"], {
      afterCommit: async (context) => {
        await hooks.afterCommit?.(context);
      }
    });

    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Delivery" }) });
    await services.documents.assign({
      actor: owner,
      doctype: "Note",
      name: "Delivery",
      assignee: "support@example.com",
      expectedVersion: 1
    });

    await expect(notifications.inbox({ id: "support@example.com", roles: ["User"], tenantId: "acme" })).resolves.toMatchObject({
      notifications: [{ id: "evt_assign-1:user:support%40example.com", documentName: "Delivery" }]
    });
  });

  it("runs email notification delivery from the shared after-commit hook", async () => {
    const events = new InMemoryEventStore();
    const messages: EmailMessage[] = [];
    const emailNotifications = new EmailNotificationService({
      events,
      from: { email: "notifications@example.com" },
      sender: {
        async send(message) {
          messages.push(message);
          return {};
        }
      },
      notificationRules: {
        async notificationRulesFor() {
          return [
            {
              name: "Email assignees",
              events: ["DocumentAssigned"],
              recipients: [{ kind: "user", userId: "support@example.com" }],
              channels: ["email"],
              subject: "{{ doctype }} {{ name }} assigned"
            }
          ];
        }
      }
    });
    const hooks = createDocumentDeliveryHooks({ emailNotifications });
    const services = createServices(["create-1", "assign-1"], {
      afterCommit: async (context) => {
        await hooks.afterCommit?.(context);
      }
    });

    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Email Delivery" }) });
    await services.documents.assign({
      actor: owner,
      doctype: "Note",
      name: "Email Delivery",
      assignee: "support@example.com",
      expectedVersion: 1
    });

    expect(messages).toEqual([
      expect.objectContaining({
        from: { email: "notifications@example.com" },
        to: [{ email: "support@example.com" }],
        subject: "Note Email Delivery assigned"
      })
    ]);
  });
});
