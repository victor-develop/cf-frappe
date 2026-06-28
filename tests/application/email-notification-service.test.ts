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
  type EmailNotificationEventPayload,
  type EventStore,
  type DomainEvent,
  type DocumentEventPayload,
  type NewDomainEvent,
  type NotificationRuleDefinition,
  type StreamName
} from "../../src";
import { now, owner } from "../helpers";

describe("EmailNotificationService", () => {
  it("registers email notification payloads through the domain event extension map", () => {
    const payload = emailNotificationPayload({
      kind: "EmailNotificationQueued",
      messageId: "evt_update:rule:Email%20owners:email:user_123",
      sourceEventId: "evt_update",
      sourceEventType: "NoteUpdated",
      payloadKind: "DocumentUpdated",
      ruleName: "Email owners",
      recipientId: "user_123",
      from: { email: "notifications@example.com" },
      to: { email: "reviewer@example.com", name: "Reviewer" },
      subject: "Note My Note changed",
      text: "Note My Note changed"
    });

    expect(payload.to.email).toBe("reviewer@example.com");
  });

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
      ids: deterministicIds(["queued-1", "claim-1", "claimed-1", "sent-1"]),
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
        id: "evt_claimed-1",
        payload: {
          kind: "EmailNotificationDeliveryClaimed",
          messageId,
          claimId: "claim_claim-1"
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

  it("fails explicitly when an outbox append returns no persisted event", async () => {
    const events = new EmptyAppendEmailOutboxEventStore();
    const service = new EmailNotificationService({
      events,
      sender: recordingEmailSender(),
      from: { email: "notifications@example.com" },
      notificationRules: ruleProvider("reviewer@example.com"),
      ids: deterministicIds(["queued-1"]),
      clock: fixedClock(now)
    });
    const messageId = "evt_update:rule:Email%20owners:email:reviewer%40example.com";

    await expect(service.queueFromDomainEvent(documentUpdatedEvent(), noteSnapshot())).rejects.toThrow(
      "Email outbox append for 'evt_update:rule:Email%20owners:email:reviewer%40example.com' in tenant 'acme' did not return 'EmailNotificationQueued'"
    );
    expect(events.appended).toMatchObject([
      {
        stream: emailOutboxStream("acme", messageId),
        payload: { kind: "EmailNotificationQueued", messageId }
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
      ids: deterministicIds(["queued-1", "claim-1", "claimed-1", "failed-1"]),
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
      { payload: { kind: "EmailNotificationDeliveryClaimed", claimId: "claim_claim-1" } },
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
      ids: deterministicIds(["queued-1", "claim-1", "claimed-1", "failed-1", "claim-2", "claimed-2", "sent-1"]),
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
      { payload: { kind: "EmailNotificationDeliveryClaimed", claimId: "claim_claim-1" } },
      { payload: { kind: "EmailNotificationFailed", error: "temporary provider outage" } },
      { payload: { kind: "EmailNotificationDeliveryClaimed", claimId: "claim_claim-2" } },
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
      ids: deterministicIds(["queued-1", "claim-1", "claimed-1", "sent-1"]),
      clock: fixedClock(now)
    });
    const messageId = "evt_update:rule:Email%20owners:email:user_123";

    await expect(service.queueFromDomainEvent(documentUpdatedEvent(), noteSnapshot())).resolves.toEqual([
      queuedDelivery(messageId, "user_123", "old-reviewer@example.com")
    ]);
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

  it("returns existing unsent outbox messages as queue candidates for replay", async () => {
    const events = new InMemoryEventStore();
    const service = new EmailNotificationService({
      events,
      sender: recordingEmailSender(),
      from: { email: "notifications@example.com" },
      notificationRules: ruleProvider("reviewer@example.com"),
      ids: deterministicIds(["queued-1"]),
      clock: fixedClock(now)
    });
    const messageId = "evt_update:rule:Email%20owners:email:reviewer%40example.com";

    await expect(service.queueFromDomainEvent(documentUpdatedEvent(), noteSnapshot())).resolves.toEqual([
      queuedDelivery(messageId)
    ]);
    await expect(service.queueFromDomainEvent(documentUpdatedEvent(), noteSnapshot())).resolves.toEqual([
      queuedDelivery(messageId)
    ]);
    await expect(events.readStream(emailOutboxStream("acme", messageId))).resolves.toMatchObject([
      { payload: { kind: "EmailNotificationQueued", messageId } }
    ]);
  });

  it("does not return sent outbox messages as queue candidates on replay", async () => {
    const events = new InMemoryEventStore();
    const service = new EmailNotificationService({
      events,
      sender: recordingEmailSender("cf-msg-1"),
      from: { email: "notifications@example.com" },
      notificationRules: ruleProvider("reviewer@example.com"),
      ids: deterministicIds(["queued-1", "claim-1", "claimed-1", "sent-1"]),
      clock: fixedClock(now)
    });
    const messageId = "evt_update:rule:Email%20owners:email:reviewer%40example.com";

    await expect(service.deliverFromDomainEvent(documentUpdatedEvent(), noteSnapshot())).resolves.toEqual([
      expect.objectContaining({ status: "sent", messageId })
    ]);
    await expect(service.queueFromDomainEvent(documentUpdatedEvent(), noteSnapshot())).resolves.toEqual([]);
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
      ids: deterministicIds(["queued-1", "claim-1", "claimed-1", "sent-1"]),
      clock: fixedClock(now)
    });
    const messageId = "evt_update:rule:Email%20owners:email:reviewer%40example.com";

    await expect(service.sendFromDomainEvent(documentUpdatedEvent(), noteSnapshot()))
      .rejects.toThrow("sent append unavailable");

    expect(sender.messages).toHaveLength(1);
    await expect(inner.readStream(emailOutboxStream("acme", messageId))).resolves.toMatchObject([
      { payload: { kind: "EmailNotificationQueued" } },
      { payload: { kind: "EmailNotificationDeliveryClaimed", claimId: "claim_claim-1" } }
    ]);
  });

  it("claims a queued outbox message before provider send so concurrent delivery only sends once", async () => {
    const inner = new InMemoryEventStore();
    const race = raceClaimAppendEventStore(inner);
    const sender = recordingEmailSender("cf-msg-1");
    const service = new EmailNotificationService({
      events: race.events,
      sender,
      from: { email: "notifications@example.com" },
      notificationRules: ruleProvider("reviewer@example.com"),
      ids: deterministicIds(["queued-1", "claim-1", "claimed-1", "claim-2", "claimed-2", "sent-1"]),
      clock: fixedClock(now)
    });
    const messageId = "evt_update:rule:Email%20owners:email:reviewer%40example.com";

    await expect(service.queueFromDomainEvent(documentUpdatedEvent(), noteSnapshot())).resolves.toEqual([
      queuedDelivery(messageId)
    ]);
    const first = service.deliverOutboxMessage("acme", messageId);
    const second = service.deliverOutboxMessage("acme", messageId);
    await race.waitForClaimRace();

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: "sent", providerMessageId: "cf-msg-1" }),
      undefined
    ]);
    expect(sender.messages).toHaveLength(1);
    await expect(inner.readStream(emailOutboxStream("acme", messageId))).resolves.toMatchObject([
      { payload: { kind: "EmailNotificationQueued" } },
      { payload: { kind: "EmailNotificationDeliveryClaimed", claimId: "claim_claim-1" } },
      { payload: { kind: "EmailNotificationSent", providerMessageId: "cf-msg-1" } }
    ]);
  });

  it("reclaims stale delivery claims so crashed workers do not strand retryable messages", async () => {
    const events = new InMemoryEventStore();
    const sender = recordingEmailSender("cf-msg-reclaimed");
    let currentTime = "2026-01-01T00:00:00.000Z";
    const service = new EmailNotificationService({
      events,
      sender,
      from: { email: "notifications@example.com" },
      notificationRules: ruleProvider("reviewer@example.com"),
      claimTimeoutSeconds: 60,
      ids: deterministicIds(["queued-1", "claim-2", "claimed-2", "sent-1"]),
      clock: { now: () => currentTime }
    });
    const messageId = "evt_update:rule:Email%20owners:email:reviewer%40example.com";
    const stream = emailOutboxStream("acme", messageId);

    await expect(service.queueFromDomainEvent(documentUpdatedEvent(), noteSnapshot())).resolves.toEqual([
      queuedDelivery(messageId)
    ]);
    await events.append(stream, 1, [
      {
        id: "evt_claimed-existing",
        tenantId: "acme",
        stream,
        type: "EmailNotificationDeliveryClaimed",
        doctype: "__EmailOutbox",
        documentName: messageId,
        actorId: "system:email-outbox",
        occurredAt: currentTime,
        payload: {
          kind: "EmailNotificationDeliveryClaimed",
          messageId,
          claimId: "claim_existing"
        },
        metadata: {}
      }
    ]);

    await expect(service.deliverOutboxMessage("acme", messageId)).resolves.toBeUndefined();
    currentTime = "2026-01-01T00:01:00.000Z";
    await expect(service.deliverOutboxMessage("acme", messageId)).resolves.toMatchObject({
      status: "sent",
      providerMessageId: "cf-msg-reclaimed"
    });

    expect(sender.messages).toHaveLength(1);
    await expect(events.readStream(stream)).resolves.toMatchObject([
      { payload: { kind: "EmailNotificationQueued" } },
      { payload: { kind: "EmailNotificationDeliveryClaimed", claimId: "claim_existing" } },
      { payload: { kind: "EmailNotificationDeliveryClaimed", claimId: "claim_claim-2" } },
      { payload: { kind: "EmailNotificationSent", providerMessageId: "cf-msg-reclaimed" } }
    ]);
  });

  it("ignores stale claimant failures after a newer claim has already sent the message", async () => {
    const events = new InMemoryEventStore();
    const sender = recordingEmailSender("cf-msg-reclaimed");
    let currentTime = "2026-01-01T00:00:00.000Z";
    const service = new EmailNotificationService({
      events,
      sender,
      from: { email: "notifications@example.com" },
      notificationRules: ruleProvider("reviewer@example.com"),
      claimTimeoutSeconds: 60,
      ids: deterministicIds(["queued-1", "claim-2", "claimed-2", "sent-1"]),
      clock: { now: () => currentTime }
    });
    const messageId = "evt_update:rule:Email%20owners:email:reviewer%40example.com";
    const stream = emailOutboxStream("acme", messageId);

    await service.queueFromDomainEvent(documentUpdatedEvent(), noteSnapshot());
    await events.append(stream, 1, [
      emailOutboxEvent("evt_claimed-existing", stream, messageId, currentTime, {
        kind: "EmailNotificationDeliveryClaimed",
        messageId,
        claimId: "claim_existing"
      })
    ]);
    currentTime = "2026-01-01T00:01:00.000Z";
    await expect(service.deliverOutboxMessage("acme", messageId)).resolves.toMatchObject({ status: "sent" });
    await events.append(stream, 4, [
      emailOutboxEvent("evt_failed-stale", stream, messageId, "2026-01-01T00:01:01.000Z", {
        kind: "EmailNotificationFailed",
        messageId,
        claimId: "claim_existing",
        error: "stale worker failure"
      })
    ]);

    await expect(service.deliverOutboxMessage("acme", messageId)).resolves.toBeUndefined();
    expect(sender.messages).toHaveLength(1);
  });

  it("ignores stale claimant completions while a newer delivery claim is still active", async () => {
    const events = new InMemoryEventStore();
    const sender = recordingEmailSender("cf-msg-should-not-send");
    const service = new EmailNotificationService({
      events,
      sender,
      from: { email: "notifications@example.com" },
      notificationRules: ruleProvider("reviewer@example.com"),
      claimTimeoutSeconds: 60,
      ids: deterministicIds(["queued-1"]),
      clock: { now: () => "2026-01-01T00:01:30.000Z" }
    });
    const messageId = "evt_update:rule:Email%20owners:email:reviewer%40example.com";
    const stream = emailOutboxStream("acme", messageId);

    await service.queueFromDomainEvent(documentUpdatedEvent(), noteSnapshot());
    await events.append(stream, 1, [
      emailOutboxEvent("evt_claimed-old", stream, messageId, "2026-01-01T00:00:00.000Z", {
        kind: "EmailNotificationDeliveryClaimed",
        messageId,
        claimId: "claim_old"
      }),
      emailOutboxEvent("evt_claimed-new", stream, messageId, "2026-01-01T00:01:00.000Z", {
        kind: "EmailNotificationDeliveryClaimed",
        messageId,
        claimId: "claim_new"
      }),
      emailOutboxEvent("evt_failed-old", stream, messageId, "2026-01-01T00:01:10.000Z", {
        kind: "EmailNotificationFailed",
        messageId,
        claimId: "claim_old",
        error: "old worker failure"
      })
    ]);

    await expect(service.deliverOutboxMessage("acme", messageId)).resolves.toBeUndefined();
    expect(sender.messages).toHaveLength(0);
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

    const firstMessageId = "evt_update:rule:Email%20owners:email:owner-a%40example.com";
    const secondMessageId = "evt_update:rule:Email%20owners:email:owner-b%40example.com";
    await expect(service.queueFromDomainEvent(documentUpdatedEvent(), noteSnapshot())).resolves.toEqual([
      queuedDelivery(firstMessageId, "owner-a@example.com", "owner-a@example.com"),
      queuedDelivery(secondMessageId, "owner-b@example.com", "owner-b@example.com")
    ]);
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

class EmptyAppendEmailOutboxEventStore implements EventStore {
  readonly appended: NewDomainEvent[] = [];

  async append(
    _stream: StreamName,
    _expectedVersion: number,
    events: readonly NewDomainEvent[]
  ): Promise<readonly DomainEvent[]> {
    this.appended.push(...events);
    return [];
  }

  async readStream(_stream: StreamName): Promise<readonly DomainEvent[]> {
    return [];
  }

  async currentVersion(_stream: StreamName): Promise<number> {
    return 0;
  }
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

function raceClaimAppendEventStore(inner: InMemoryEventStore): {
  readonly events: EventStore;
  readonly waitForClaimRace: () => Promise<void>;
} {
  let claimAttempts = 0;
  let firstRelease: (() => void) | undefined;
  let secondRelease: (() => void) | undefined;
  let raceReady: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    raceReady = resolve;
  });
  return {
    events: {
      readStream: (stream, options) => inner.readStream(stream, options),
      currentVersion: (stream) => inner.currentVersion(stream),
      async append(stream, expectedVersion, events: readonly NewDomainEvent[]) {
        if (events.some((event) => event.payload.kind === "EmailNotificationDeliveryClaimed")) {
          claimAttempts += 1;
          if (claimAttempts === 1) {
            await new Promise<void>((resolve) => {
              firstRelease = resolve;
            });
          } else if (claimAttempts === 2) {
            const first = firstRelease;
            await new Promise<void>((resolve) => {
              secondRelease = resolve;
              first?.();
              queueMicrotask(() => {
                secondRelease?.();
                raceReady?.();
              });
            });
          }
        }
        return inner.append(stream, expectedVersion, events);
      }
    },
    waitForClaimRace: () => ready
  };
}

function emailOutboxEvent(
  id: string,
  stream: StreamName,
  messageId: string,
  occurredAt: string,
  payload: NewDomainEvent["payload"]
): NewDomainEvent {
  return {
    id,
    tenantId: "acme",
    stream,
    type: payload.kind,
    doctype: "__EmailOutbox",
    documentName: messageId,
    actorId: "system:email-outbox",
    occurredAt,
    payload,
    metadata: {}
  };
}

function emailNotificationPayload(
  payload: Extract<DocumentEventPayload, { readonly kind: "EmailNotificationQueued" }>
): Extract<EmailNotificationEventPayload, { readonly kind: "EmailNotificationQueued" }> {
  return payload;
}

function queuedDelivery(
  messageId: string,
  recipientId = "reviewer@example.com",
  to = "reviewer@example.com"
) {
  return {
    status: "queued",
    messageId,
    eventId: "evt_update",
    ruleName: "Email owners",
    recipientId,
    to,
    subject: "Note My Note changed"
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
