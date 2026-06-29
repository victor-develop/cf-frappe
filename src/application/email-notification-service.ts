import { documentEmailNotificationsFromRules } from "../core/notifications.js";
import { emailOutboxStream, userAccountsStream } from "../core/streams.js";
import type { DocumentSnapshot, DomainEvent, NewDomainEvent, NotificationRuleDefinition, TenantId } from "../core/types.js";
import { foldUserAccount } from "../core/user-accounts.js";
import { FrameworkError } from "../core/errors.js";
import {
  EMAIL_OUTBOX_PAYLOAD_KINDS,
  claimedDeliveryId,
  emailNotificationMessageId,
  foldEmailOutbox,
  isStaleEmailClaim,
  requireAppendedEmailOutboxEvent,
  type EmailNotificationEventPayload,
  type EmailOutboxRecord,
  type EmailOutboxRecordEntry,
  type EmailOutboxState
} from "./email-notification-events.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EmailAddress, EmailMessage, EmailSender } from "../ports/email.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";

export type { EmailNotificationAddressPayload, EmailNotificationEventPayload } from "./email-notification-events.js";
export { emailNotificationMessageId } from "./email-notification-events.js";

const EMAIL_OUTBOX_ACTOR_ID = "system:email-outbox";
const DEFAULT_EMAIL_DELIVERY_CLAIM_TIMEOUT_SECONDS = 300;

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
  readonly claimTimeoutSeconds?: number;
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

export type DocumentEmailNotificationQueueResult =
  | {
      readonly status: "queued";
      readonly messageId: string;
      readonly eventId: string;
      readonly ruleName: string;
      readonly recipientId: string;
      readonly to: string;
      readonly subject: string;
    }
  | Extract<DocumentEmailNotificationDelivery, { readonly status: "skipped" }>;

export class EmailNotificationService {
  private readonly events: EventStore;
  private readonly sender: EmailSender;
  private readonly from: EmailAddress;
  private readonly notificationRules: EmailNotificationRuleProvider;
  private readonly recipients: EmailRecipientResolver;
  private readonly claimTimeoutMs: number;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;

  constructor(options: EmailNotificationServiceOptions) {
    this.events = options.events;
    this.sender = options.sender;
    this.from = options.from;
    this.notificationRules = options.notificationRules;
    this.recipients = options.recipients ?? fallbackEmailRecipientResolver;
    this.claimTimeoutMs = (options.claimTimeoutSeconds ?? DEFAULT_EMAIL_DELIVERY_CLAIM_TIMEOUT_SECONDS) * 1000;
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
  ): Promise<readonly DocumentEmailNotificationQueueResult[]> {
    const rules = await this.notificationRules.notificationRulesFor(event.tenantId, event.doctype, {
      occurredAt: event.occurredAt
    });
    const notifications = documentEmailNotificationsFromRules(event, snapshot ?? null, rules);
    const queued: DocumentEmailNotificationQueueResult[] = [];
    for (const notification of notifications) {
      const messageId = emailNotificationMessageId(notification.eventId, notification.ruleName, notification.recipientId);
      const current = (await this.state(event.tenantId, messageId)).messages.get(messageId);
      if (current !== undefined) {
        const replayable = queueResultFromOutboxRecord(current);
        if (replayable !== undefined) {
          queued.push(replayable);
        }
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
      queued.push({
        status: "queued",
        messageId,
        eventId: notification.eventId,
        ruleName: notification.ruleName,
        recipientId: notification.recipientId,
        to: to.email,
        subject: notification.subject
      });
    }
    return queued;
  }

  async deliverFromDomainEvent(
    event: DomainEvent,
    snapshot?: DocumentSnapshot | null
  ): Promise<readonly DocumentEmailNotificationDelivery[]> {
    const queued = await this.queueFromDomainEvent(event, snapshot);
    const skipped = queued.filter(isSkippedDelivery);
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
    const claim = await this.claimOutboxMessage(tenantId, messageId, record);
    if (claim === undefined) {
      return undefined;
    }
    const claimId = claimedDeliveryId(claim, messageId);
    let sent: Awaited<ReturnType<EmailSender["send"]>>;
    try {
      sent = await this.sender.send({
        from: claim.from,
        to: [claim.to],
        subject: claim.subject,
        text: claim.text,
        ...(claim.headers === undefined ? {} : { headers: { ...claim.headers } })
      });
    } catch (error) {
      const messageText = errorMessage(error);
      const recorded = await this.appendClaimCompletion(tenantId, messageId, claimId, {
        kind: "EmailNotificationFailed",
        messageId,
        claimId,
        error: messageText
      });
      if (!recorded) {
        return undefined;
      }
      return {
        status: "failed",
        messageId,
        eventId: claim.sourceEventId,
        ruleName: claim.ruleName,
        recipientId: claim.recipientId,
        to: claim.to.email,
        subject: claim.subject,
        error: messageText
      };
    }
    const recorded = await this.appendClaimCompletion(tenantId, messageId, claimId, {
      kind: "EmailNotificationSent",
      messageId,
      claimId,
      ...(sent.id === undefined ? {} : { providerMessageId: sent.id })
    });
    if (!recorded) {
      return undefined;
    }
    return {
      status: "sent",
      messageId,
      ...(sent.id === undefined ? {} : { providerMessageId: sent.id }),
      eventId: claim.sourceEventId,
      ruleName: claim.ruleName,
      recipientId: claim.recipientId,
      to: claim.to.email,
      subject: claim.subject
    };
  }

  private async appendClaimCompletion(
    tenantId: TenantId,
    messageId: string,
    claimId: string,
    payload: Extract<EmailNotificationEventPayload, { readonly kind: "EmailNotificationFailed" | "EmailNotificationSent" }>
  ): Promise<boolean> {
    const stream = emailOutboxStream(tenantId, messageId);
    const state = await this.state(tenantId, messageId);
    const current = state.messages.get(messageId);
    if (current?.status !== "claimed" || current.claimId !== claimId) {
      return false;
    }
    try {
      await this.events.append(stream, state.version, [
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
      return true;
    } catch (error) {
      if (isConflict(error)) {
        return false;
      }
      throw error;
    }
  }

  private async claimOutboxMessage(
    tenantId: TenantId,
    messageId: string,
    record: EmailOutboxRecordEntry
  ): Promise<EmailOutboxRecord | undefined> {
    if (record.status === "sent" || record.status === "skipped") {
      return undefined;
    }
    if (record.status === "claimed" && !isStaleEmailClaim(record, this.clock.now(), this.claimTimeoutMs)) {
      return undefined;
    }
    const claimId = this.ids.next("claim_");
    let claimedEvent: DomainEvent;
    try {
      claimedEvent = await this.append(tenantId, messageId, {
        kind: "EmailNotificationDeliveryClaimed",
        messageId,
        claimId
      });
    } catch (error) {
      if (isConflict(error)) {
        return undefined;
      }
      throw error;
    }
    return {
      ...record,
      status: "claimed",
      claimId,
      claimedAt: claimedEvent.occurredAt
    };
  }

  private async state(tenantId: TenantId, messageId: string): Promise<EmailOutboxState> {
    return foldEmailOutbox(tenantId, await this.events.readStream(emailOutboxStream(tenantId, messageId), {
      payloadKinds: EMAIL_OUTBOX_PAYLOAD_KINDS
    }));
  }

  private async append(
    tenantId: TenantId,
    messageId: string,
    payload: EmailNotificationEventPayload
  ): Promise<DomainEvent> {
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
    return requireAppendedEmailOutboxEvent(event, tenantId, messageId, payload.kind);
  }
}

function isSkippedDelivery(
  delivery: DocumentEmailNotificationQueueResult
): delivery is Extract<DocumentEmailNotificationDelivery, { readonly status: "skipped" }> {
  return delivery.status === "skipped";
}

function queueResultFromOutboxRecord(
  record: EmailOutboxRecordEntry
): DocumentEmailNotificationQueueResult | undefined {
  if (record.status === "sent") {
    return undefined;
  }
  if (record.status === "skipped") {
    return {
      status: "skipped",
      messageId: record.messageId,
      eventId: record.sourceEventId,
      ruleName: record.ruleName,
      recipientId: record.recipientId,
      reason: record.reason ?? `No deliverable email address for user '${record.recipientId}'`
    };
  }
  return {
    status: "queued",
    messageId: record.messageId,
    eventId: record.sourceEventId,
    ruleName: record.ruleName,
    recipientId: record.recipientId,
    to: record.to.email,
    subject: record.subject
  };
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

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isConflict(error: unknown): boolean {
  return error instanceof FrameworkError && error.code === "DOCUMENT_CONFLICT";
}

function emailAddressPayload(address: EmailAddress): EmailAddress {
  return address.name === undefined
    ? { email: address.email }
    : { email: address.email, name: address.name };
}
