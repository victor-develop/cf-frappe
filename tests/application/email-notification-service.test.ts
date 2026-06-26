import {
  EmailNotificationService,
  InMemoryEventStore,
  UserAccountEmailRecipientResolver,
  deterministicIds,
  emailOutboxStream,
  fixedClock,
  userAccountsStream,
  type EmailMessage,
  type EmailSender,
  type EventStore,
  type NewDomainEvent,
  type NotificationRuleDefinition
} from "../../src";
import { now, owner } from "../helpers";

describe("EmailNotificationService", () => {
  it("queues and sends rule-driven transactional emails through a resolved recipient address", async () => {
    const events = new InMemoryEventStore();
    const sender = recordingEmailSender("cf-msg-1");
    const service = new EmailNotificationService({
      events,
      sender,
      from: { email: "notifications@example.com", name: "cf-frappe" },
      notificationRules: ruleProvider("user_123"),
      recipients: {
        async emailForUser(tenantId, userId) {
          expect({ tenantId, userId }).toEqual({ tenantId: "acme", userId: "user_123" });
          return { email: "reviewer@example.com", name: "Reviewer" };
        }
      },
      ids: deterministicIds(["queued-1", "sent-1"]),
      clock: fixedClock(now)
    });

    await expect(service.sendFromDomainEvent(documentUpdatedEvent(), noteSnapshot())).resolves.toEqual([
      {
        status: "sent",
        messageId: "evt_update:rule:Email%20owners:email:user_123",
        providerMessageId: "cf-msg-1",
        eventId: "evt_update",
        ruleName: "Email owners",
        recipientId: "user_123",
        to: "reviewer@example.com",
        subject: "Note My Note changed"
      }
    ]);
    expect(sender.messages).toEqual([
      {
        from: { email: "notifications@example.com", name: "cf-frappe" },
        to: [{ email: "reviewer@example.com", name: "Reviewer" }],
        subject: "Note My Note changed",
        text: [
          "Note My Note changed",
          "",
          "Document: Note My Note",
          "Event: DocumentUpdated",
          "Actor: owner@example.com",
          "Rule: Email owners"
        ].join("\n"),
        headers: {
          "X-CF-Frappe-Event": "evt_update",
          "X-CF-Frappe-Rule": "Email owners"
        }
      }
    ]);
    const messageId = "evt_update:rule:Email%20owners:email:user_123";
    await expect(events.readStream(emailOutboxStream("acme", messageId))).resolves.toMatchObject([
      {
        id: "evt_queued-1",
        payload: {
          kind: "EmailNotificationQueued",
          messageId,
          recipientId: "user_123",
          from: { email: "notifications@example.com", name: "cf-frappe" },
          to: { email: "reviewer@example.com", name: "Reviewer" },
          headers: {
            "X-CF-Frappe-Event": "evt_update",
            "X-CF-Frappe-Rule": "Email owners"
          }
        }
      },
      {
        id: "evt_sent-1",
        payload: {
          kind: "EmailNotificationSent",
          messageId,
          providerMessageId: "cf-msg-1"
        }
      }
    ]);
  });

  it("records skipped delivery when a recipient has no deliverable email address", async () => {
    const events = new InMemoryEventStore();
    const sender = recordingEmailSender();
    const service = new EmailNotificationService({
      events,
      sender,
      from: { email: "notifications@example.com" },
      notificationRules: ruleProvider("user_123"),
      recipients: { async emailForUser() { return undefined; } },
      ids: deterministicIds(["skipped-1"]),
      clock: fixedClock(now)
    });

    await expect(service.sendFromDomainEvent(documentUpdatedEvent(), noteSnapshot())).resolves.toEqual([
      {
        status: "skipped",
        messageId: "evt_update:rule:Email%20owners:email:user_123",
        eventId: "evt_update",
        ruleName: "Email owners",
        recipientId: "user_123",
        reason: "No deliverable email address for user 'user_123'"
      }
    ]);
    expect(sender.messages).toEqual([]);
    await expect(events.readStream(emailOutboxStream("acme", "evt_update:rule:Email%20owners:email:user_123"))).resolves.toMatchObject([
      {
        payload: {
          kind: "EmailNotificationSkipped",
          messageId: "evt_update:rule:Email%20owners:email:user_123",
          reason: "No deliverable email address for user 'user_123'"
        }
      }
    ]);
  });

  it("records failed delivery in the email outbox instead of throwing away the side effect", async () => {
    const events = new InMemoryEventStore();
    const service = new EmailNotificationService({
      events,
      sender: {
        async send() {
          throw new Error("Cloudflare Email rejected recipient");
        }
      },
      from: { email: "notifications@example.com" },
      notificationRules: ruleProvider("reviewer@example.com"),
      ids: deterministicIds(["queued-1", "failed-1"]),
      clock: fixedClock(now)
    });

    await expect(service.sendFromDomainEvent(documentUpdatedEvent(), noteSnapshot())).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        messageId: "evt_update:rule:Email%20owners:email:reviewer%40example.com",
        error: "Cloudflare Email rejected recipient"
      })
    ]);
    await expect(events.readStream(emailOutboxStream("acme", "evt_update:rule:Email%20owners:email:reviewer%40example.com"))).resolves.toMatchObject([
      { payload: { kind: "EmailNotificationQueued" } },
      {
        payload: {
          kind: "EmailNotificationFailed",
          messageId: "evt_update:rule:Email%20owners:email:reviewer%40example.com",
          error: "Cloudflare Email rejected recipient"
        }
      }
    ]);
  });

  it("retries failed outbox deliveries while keeping the failed audit event", async () => {
    const events = new InMemoryEventStore();
    let attempt = 0;
    const service = new EmailNotificationService({
      events,
      sender: {
        async send() {
          attempt += 1;
          if (attempt === 1) {
            throw new Error("temporary provider outage");
          }
          return { id: "cf-msg-retry" };
        }
      },
      from: { email: "notifications@example.com" },
      notificationRules: ruleProvider("reviewer@example.com"),
      ids: deterministicIds(["queued-1", "failed-1", "queued-2", "sent-1"]),
      clock: fixedClock(now)
    });

    await expect(service.sendFromDomainEvent(documentUpdatedEvent(), noteSnapshot())).resolves.toEqual([
      expect.objectContaining({ status: "failed", error: "temporary provider outage" })
    ]);
    await expect(service.sendFromDomainEvent(documentUpdatedEvent(), noteSnapshot())).resolves.toEqual([
      expect.objectContaining({ status: "sent", providerMessageId: "cf-msg-retry" })
    ]);
    await expect(events.readStream(emailOutboxStream("acme", "evt_update:rule:Email%20owners:email:reviewer%40example.com"))).resolves.toMatchObject([
      { payload: { kind: "EmailNotificationQueued" } },
      { payload: { kind: "EmailNotificationFailed", error: "temporary provider outage" } },
      { payload: { kind: "EmailNotificationQueued" } },
      { payload: { kind: "EmailNotificationSent", providerMessageId: "cf-msg-retry" } }
    ]);
  });

  it("retries from the persisted outbox message rather than current recipient state", async () => {
    const events = new InMemoryEventStore();
    const sender = recordingEmailSender("cf-msg-retry");
    let resolvedEmail = "old-reviewer@example.com";
    const service = new EmailNotificationService({
      events,
      sender,
      from: { email: "notifications@example.com" },
      notificationRules: ruleProvider("user_123"),
      recipients: {
        async emailForUser() {
          return { email: resolvedEmail };
        }
      },
      ids: deterministicIds(["queued-1", "sent-1"]),
      clock: fixedClock(now)
    });
    const messageId = "evt_update:rule:Email%20owners:email:user_123";

    await expect(service.queueFromDomainEvent(documentUpdatedEvent(), noteSnapshot())).resolves.toEqual([]);
    resolvedEmail = "new-reviewer@example.com";
    await expect(service.deliverOutboxMessage("acme", messageId)).resolves.toMatchObject({
      status: "sent",
      to: "old-reviewer@example.com",
      providerMessageId: "cf-msg-retry"
    });

    expect(sender.messages).toEqual([
      expect.objectContaining({
        to: [{ email: "old-reviewer@example.com" }],
        subject: "Note My Note changed"
      })
    ]);
  });

  it("does not record provider failure when sent-state persistence fails after provider success", async () => {
    const inner = new InMemoryEventStore();
    const events = failSentAppendEventStore(inner);
    const sender = recordingEmailSender("cf-msg-1");
    const service = new EmailNotificationService({
      events,
      sender,
      from: { email: "notifications@example.com" },
      notificationRules: ruleProvider("reviewer@example.com"),
      ids: deterministicIds(["queued-1", "sent-1"]),
      clock: fixedClock(now)
    });
    const messageId = "evt_update:rule:Email%20owners:email:reviewer%40example.com";

    await expect(service.sendFromDomainEvent(documentUpdatedEvent(), noteSnapshot()))
      .rejects.toThrow("sent append unavailable");

    expect(sender.messages).toHaveLength(1);
    await expect(inner.readStream(emailOutboxStream("acme", messageId))).resolves.toMatchObject([
      { payload: { kind: "EmailNotificationQueued" } }
    ]);
  });

  it("shards independent email outbox messages by deterministic message id", async () => {
    const events = new InMemoryEventStore();
    const service = new EmailNotificationService({
      events,
      sender: recordingEmailSender(),
      from: { email: "notifications@example.com" },
      notificationRules: {
        async notificationRulesFor() {
          return [
            {
              name: "Email owners",
              events: ["DocumentUpdated"],
              recipients: [
                { kind: "user", userId: "owner-a@example.com" },
                { kind: "user", userId: "owner-b@example.com" }
              ],
              channels: ["email"],
              subject: "{{ doctype }} {{ name }} changed"
            }
          ] satisfies readonly NotificationRuleDefinition[];
        }
      },
      ids: deterministicIds(["queued-a", "queued-b"]),
      clock: fixedClock(now)
    });

    await expect(service.queueFromDomainEvent(documentUpdatedEvent(), noteSnapshot())).resolves.toEqual([]);

    const firstMessageId = "evt_update:rule:Email%20owners:email:owner-a%40example.com";
    const secondMessageId = "evt_update:rule:Email%20owners:email:owner-b%40example.com";
    await expect(events.readStream(emailOutboxStream("acme", firstMessageId))).resolves.toMatchObject([
      {
        sequence: 1,
        stream: emailOutboxStream("acme", firstMessageId),
        payload: { kind: "EmailNotificationQueued", messageId: firstMessageId }
      }
    ]);
    await expect(events.readStream(emailOutboxStream("acme", secondMessageId))).resolves.toMatchObject([
      {
        sequence: 1,
        stream: emailOutboxStream("acme", secondMessageId),
        payload: { kind: "EmailNotificationQueued", messageId: secondMessageId }
      }
    ]);
  });

  it("resolves delivery addresses from event-sourced user accounts", async () => {
    const events = new InMemoryEventStore();
    await events.append(userAccountsStream("acme", "user_123"), 0, [
      {
        id: "evt_user",
        tenantId: "acme",
        stream: userAccountsStream("acme", "user_123"),
        type: "UserAccountCreated",
        doctype: "__UserAccounts",
        documentName: "user_123",
        actorId: "admin@example.com",
        occurredAt: now,
        payload: {
          kind: "UserAccountCreated",
          userId: "user_123",
          email: "reviewer@example.com",
          roles: ["User"],
          enabled: true
        },
        metadata: {}
      }
    ]);

    await expect(new UserAccountEmailRecipientResolver(events).emailForUser("acme", "user_123"))
      .resolves.toEqual({ email: "reviewer@example.com" });
  });
});

function recordingEmailSender(id?: string): EmailSender & { readonly messages: readonly EmailMessage[] } {
  const messages: EmailMessage[] = [];
  return {
    messages,
    async send(message) {
      messages.push(message);
      return id === undefined ? {} : { id };
    }
  };
}

function failSentAppendEventStore(inner: InMemoryEventStore): EventStore {
  return {
    readStream: (stream, options) => inner.readStream(stream, options),
    currentVersion: (stream) => inner.currentVersion(stream),
    async append(stream, expectedVersion, events: readonly NewDomainEvent[]) {
      if (events.some((event) => event.payload.kind === "EmailNotificationSent")) {
        throw new Error("sent append unavailable");
      }
      return inner.append(stream, expectedVersion, events);
    }
  };
}

function ruleProvider(userId: string) {
  return {
    async notificationRulesFor(tenantId: string, doctypeName: string, options?: { readonly occurredAt?: string }) {
      expect({ tenantId, doctypeName, options }).toEqual({
        tenantId: "acme",
        doctypeName: "Note",
        options: { occurredAt: now }
      });
      return [
        {
          name: "Email owners",
          events: ["DocumentUpdated"],
          recipients: [{ kind: "user", userId }],
          channels: ["email"],
          subject: "{{ doctype }} {{ name }} changed"
        }
      ] satisfies readonly NotificationRuleDefinition[];
    }
  };
}

function documentUpdatedEvent() {
  return {
    id: "evt_update",
    tenantId: "acme",
    stream: "acme:Note:My Note",
    sequence: 2,
    type: "NoteUpdated",
    doctype: "Note",
    documentName: "My Note",
    actorId: owner.id,
    occurredAt: now,
    payload: { kind: "DocumentUpdated", patch: { body: "Updated" } },
    metadata: {}
  } as const;
}

function noteSnapshot() {
  return {
    tenantId: "acme",
    doctype: "Note",
    name: "My Note",
    version: 2,
    docstatus: "draft",
    data: { title: "My Note", created_by: owner.id },
    createdAt: now,
    updatedAt: now
  } as const;
}
