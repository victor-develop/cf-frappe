import { documentEmailNotificationsFromRules } from "../core/notifications.js";
import { emailOutboxStream, userAccountsStream } from "../core/streams.js";
import type { DocumentSnapshot, DomainEvent, NewDomainEvent, NotificationRuleDefinition, TenantId } from "../core/types.js";
import { foldUserAccount } from "../core/user-accounts.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EmailAddress, EmailMessage, EmailSender } from "../ports/email.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";

const EMAIL_OUTBOX_ACTOR_ID = "system:email-outbox";
const EMAIL_OUTBOX_PAYLOAD_KINDS = Object.freeze([
  "EmailNotificationQueued",
  "EmailNotificationSent",
  "EmailNotificationFailed",
  "EmailNotificationSkipped"
] as const);

export interface EmailNotificationRuleProvider {
  notificationRulesFor(
    tenantId: TenantId,
    doctypeName: string,
    options?: { readonly occurredAt?: string }
  ): Promise<readonly NotificationRuleDefinition[]>;
}

export interface EmailRecipientResolver {
  emailForUser(tenantId: TenantId, userId: string): Promise<EmailAddress | undefined>;
}

export interface EmailNotificationServiceOptions {
  readonly events: EventStore;
  readonly sender: EmailSender;
  readonly from: EmailAddress;
  readonly notificationRules: EmailNotificationRuleProvider;
  readonly recipients?: EmailRecipientResolver;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
}

export type DocumentEmailNotificationDelivery =
  | {
      readonly status: "sent";
      readonly messageId: string;
      readonly providerMessageId?: string;
      readonly eventId: string;
      readonly ruleName: string;
      readonly recipientId: string;
      readonly to: string;
      readonly subject: string;
    }
  | {
      readonly status: "failed";
      readonly messageId: string;
      readonly eventId: string;
      readonly ruleName: string;
      readonly recipientId: string;
      readonly to: string;
      readonly subject: string;
      readonly error: string;
    }
  | {
      readonly status: "skipped";
      readonly messageId: string;
      readonly eventId: string;
      readonly ruleName: string;
      readonly recipientId: string;
      readonly reason: string;
    };

interface QueuedEmailMessage {
  readonly messageId: string;
  readonly sourceEventId: string;
  readonly sourceEventType: string;
  readonly payloadKind: string;
  readonly ruleName: string;
  readonly recipientId: string;
  readonly from: EmailAddress;
  readonly to: EmailAddress;
  readonly subject: string;
  readonly text: string;
  readonly headers?: Readonly<Record<string, string>>;
}

interface EmailOutboxRecord extends QueuedEmailMessage {
  readonly status: "failed" | "queued" | "sent";
  readonly providerMessageId?: string;
  readonly error?: string;
}

interface SkippedEmailOutboxRecord {
  readonly messageId: string;
  readonly status: "skipped";
  readonly sourceEventId: string;
  readonly sourceEventType: string;
  readonly payloadKind: string;
  readonly ruleName: string;
  readonly recipientId: string;
  readonly reason?: string;
}

type EmailOutboxRecordEntry = EmailOutboxRecord | SkippedEmailOutboxRecord;

interface EmailOutboxState {
  readonly tenantId: TenantId;
  readonly version: number;
  readonly messages: ReadonlyMap<string, EmailOutboxRecordEntry>;
}

export class EmailNotificationService {
  private readonly events: EventStore;
  private readonly sender: EmailSender;
  private readonly from: EmailAddress;
  private readonly notificationRules: EmailNotificationRuleProvider;
  private readonly recipients: EmailRecipientResolver;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;

  constructor(options: EmailNotificationServiceOptions) {
    this.events = options.events;
    this.sender = options.sender;
    this.from = options.from;
    this.notificationRules = options.notificationRules;
    this.recipients = options.recipients ?? fallbackEmailRecipientResolver;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
  }

  async sendFromDomainEvent(
    event: DomainEvent,
    snapshot?: DocumentSnapshot | null
  ): Promise<readonly DocumentEmailNotificationDelivery[]> {
    return this.deliverFromDomainEvent(event, snapshot);
  }

  async queueFromDomainEvent(
    event: DomainEvent,
    snapshot?: DocumentSnapshot | null
  ): Promise<readonly DocumentEmailNotificationDelivery[]> {
    const rules = await this.notificationRules.notificationRulesFor(event.tenantId, event.doctype, {
      occurredAt: event.occurredAt
    });
    const notifications = documentEmailNotificationsFromRules(event, snapshot ?? null, rules);
    const queued: DocumentEmailNotificationDelivery[] = [];
    for (const notification of notifications) {
      const messageId = emailNotificationMessageId(notification.eventId, notification.ruleName, notification.recipientId);
      const current = (await this.state(event.tenantId, messageId)).messages.get(messageId);
      if (current !== undefined) {
        continue;
      }
      const to = await this.recipients.emailForUser(notification.tenantId, notification.recipientId);
      if (to === undefined) {
        await this.append(event.tenantId, messageId, {
          kind: "EmailNotificationSkipped",
          messageId,
          sourceEventId: notification.eventId,
          sourceEventType: notification.eventType,
          payloadKind: notification.payloadKind,
          ruleName: notification.ruleName,
          recipientId: notification.recipientId,
          reason: `No deliverable email address for user '${notification.recipientId}'`
        });
        queued.push({
          status: "skipped",
          messageId,
          eventId: notification.eventId,
          ruleName: notification.ruleName,
          recipientId: notification.recipientId,
          reason: `No deliverable email address for user '${notification.recipientId}'`
        });
        continue;
      }
      await this.append(event.tenantId, messageId, {
        kind: "EmailNotificationQueued",
        messageId,
        sourceEventId: notification.eventId,
        sourceEventType: notification.eventType,
        payloadKind: notification.payloadKind,
        ruleName: notification.ruleName,
        recipientId: notification.recipientId,
        from: emailAddressPayload(this.from),
        to: emailAddressPayload(to),
        subject: notification.subject,
        text: notification.text,
        headers: {
          "X-CF-Frappe-Event": notification.eventId,
          "X-CF-Frappe-Rule": notification.ruleName
        }
      });
    }
    return queued;
  }

  async deliverFromDomainEvent(
    event: DomainEvent,
    snapshot?: DocumentSnapshot | null
  ): Promise<readonly DocumentEmailNotificationDelivery[]> {
    const queued = await this.queueFromDomainEvent(event, snapshot);
    const skipped = queued.filter((delivery) => delivery.status === "skipped");
    const rules = await this.notificationRules.notificationRulesFor(event.tenantId, event.doctype, {
      occurredAt: event.occurredAt
    });
    const notifications = documentEmailNotificationsFromRules(event, snapshot ?? null, rules);
    const delivered: DocumentEmailNotificationDelivery[] = [...skipped];
    const seen = new Set<string>();
    for (const notification of notifications) {
      const messageId = emailNotificationMessageId(notification.eventId, notification.ruleName, notification.recipientId);
      if (seen.has(messageId)) {
        continue;
      }
      seen.add(messageId);
      const delivery = await this.deliverOutboxMessage(event.tenantId, messageId);
      if (delivery !== undefined) {
        delivered.push(delivery);
      }
    }
    return delivered;
  }

  async deliverOutboxMessage(tenantId: TenantId, messageId: string): Promise<DocumentEmailNotificationDelivery | undefined> {
    const record = (await this.state(tenantId, messageId)).messages.get(messageId);
    if (record === undefined || record.status === "sent" || record.status === "skipped") {
      return undefined;
    }
    if (record.status === "failed") {
      await this.append(tenantId, messageId, queuedPayloadFromRecord(record));
    }
    let sent: Awaited<ReturnType<EmailSender["send"]>>;
    try {
      sent = await this.sender.send({
        from: record.from,
        to: [record.to],
        subject: record.subject,
        text: record.text,
        ...(record.headers === undefined ? {} : { headers: { ...record.headers } })
      });
    } catch (error) {
      const messageText = errorMessage(error);
      await this.append(tenantId, messageId, {
        kind: "EmailNotificationFailed",
        messageId,
        error: messageText
      });
      return {
        status: "failed",
        messageId,
        eventId: record.sourceEventId,
        ruleName: record.ruleName,
        recipientId: record.recipientId,
        to: record.to.email,
        subject: record.subject,
        error: messageText
      };
    }
    await this.append(tenantId, messageId, {
      kind: "EmailNotificationSent",
      messageId,
      ...(sent.id === undefined ? {} : { providerMessageId: sent.id })
    });
    return {
      status: "sent",
      messageId,
      ...(sent.id === undefined ? {} : { providerMessageId: sent.id }),
      eventId: record.sourceEventId,
      ruleName: record.ruleName,
      recipientId: record.recipientId,
      to: record.to.email,
      subject: record.subject
    };
  }

  private async state(tenantId: TenantId, messageId: string): Promise<EmailOutboxState> {
    return foldEmailOutbox(tenantId, await this.events.readStream(emailOutboxStream(tenantId, messageId), {
      payloadKinds: EMAIL_OUTBOX_PAYLOAD_KINDS
    }));
  }

  private async append(tenantId: TenantId, messageId: string, payload: NewDomainEvent["payload"]): Promise<DomainEvent> {
    const stream = emailOutboxStream(tenantId, messageId);
    const state = await this.state(tenantId, messageId);
    const [event] = await this.events.append(stream, state.version, [
      {
        id: this.ids.next("evt_"),
        tenantId,
        stream,
        type: payload.kind,
        doctype: "__EmailOutbox",
        documentName: messageId,
        actorId: EMAIL_OUTBOX_ACTOR_ID,
        occurredAt: this.clock.now(),
        payload,
        metadata: {}
      } satisfies NewDomainEvent
    ]);
    return event!;
  }
}

export const fallbackEmailRecipientResolver: EmailRecipientResolver = {
  async emailForUser(_tenantId, userId) {
    return looksLikeEmail(userId) ? { email: userId } : undefined;
  }
};

export class UserAccountEmailRecipientResolver implements EmailRecipientResolver {
  private readonly events: EventStore;

  constructor(events: EventStore) {
    this.events = events;
  }

  async emailForUser(tenantId: TenantId, userId: string): Promise<EmailAddress | undefined> {
    const account = foldUserAccount(tenantId, userId, await this.events.readStream(userAccountsStream(tenantId, userId)));
    return account.exists && account.enabled && account.email !== undefined
      ? { email: account.email }
      : undefined;
  }
}

export function emailNotificationMessageId(eventId: string, ruleName: string, recipientId: string): string {
  return `${eventId}:rule:${encodeURIComponent(ruleName)}:email:${encodeURIComponent(recipientId)}`;
}

function foldEmailOutbox(tenantId: TenantId, events: readonly DomainEvent[]): EmailOutboxState {
  const messages = new Map<string, EmailOutboxRecordEntry>();
  let version = 0;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    version = Math.max(version, event.sequence);
    switch (event.payload.kind) {
      case "EmailNotificationQueued":
        messages.set(event.payload.messageId, {
          messageId: event.payload.messageId,
          status: "queued",
          sourceEventId: event.payload.sourceEventId,
          sourceEventType: event.payload.sourceEventType,
          payloadKind: event.payload.payloadKind,
          ruleName: event.payload.ruleName,
          recipientId: event.payload.recipientId,
          from: event.payload.from,
          to: event.payload.to,
          subject: event.payload.subject,
          text: event.payload.text,
          ...(event.payload.headers === undefined ? {} : { headers: event.payload.headers })
        });
        break;
      case "EmailNotificationSent": {
        const existing = messages.get(event.payload.messageId);
        if (existing !== undefined && existing.status !== "skipped") {
          messages.set(event.payload.messageId, {
            ...existing,
            status: "sent",
            ...(event.payload.providerMessageId === undefined ? {} : { providerMessageId: event.payload.providerMessageId }),
            ...(existing.error === undefined ? {} : { error: existing.error })
          });
        }
        break;
      }
      case "EmailNotificationFailed": {
        const existing = messages.get(event.payload.messageId);
        if (existing !== undefined && existing.status !== "skipped") {
          messages.set(event.payload.messageId, {
            ...existing,
            status: "failed",
            error: event.payload.error
          });
        }
        break;
      }
      case "EmailNotificationSkipped":
        messages.set(event.payload.messageId, {
          messageId: event.payload.messageId,
          status: "skipped",
          sourceEventId: event.payload.sourceEventId,
          sourceEventType: event.payload.sourceEventType,
          payloadKind: event.payload.payloadKind,
          ruleName: event.payload.ruleName,
          recipientId: event.payload.recipientId,
          reason: event.payload.reason
        });
        break;
    }
  }
  return { tenantId, version, messages };
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emailAddressPayload(address: EmailAddress): EmailAddress {
  return address.name === undefined
    ? { email: address.email }
    : { email: address.email, name: address.name };
}

function queuedPayloadFromRecord(record: EmailOutboxRecord): Extract<NewDomainEvent["payload"], { readonly kind: "EmailNotificationQueued" }> {
  return {
    kind: "EmailNotificationQueued",
    messageId: record.messageId,
    sourceEventId: record.sourceEventId,
    sourceEventType: record.sourceEventType,
    payloadKind: record.payloadKind,
    ruleName: record.ruleName,
    recipientId: record.recipientId,
    from: emailAddressPayload(record.from),
    to: emailAddressPayload(record.to),
    subject: record.subject,
    text: record.text,
    ...(record.headers === undefined ? {} : { headers: { ...record.headers } })
  };
}
