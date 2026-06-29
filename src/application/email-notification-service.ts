import { documentEmailNotificationsFromRules } from "../core/notifications.js";
import { emailOutboxStream, userAccountsStream } from "../core/streams.js";
import type { DocumentSnapshot, DomainEvent, NewDomainEvent, NotificationRuleDefinition, TenantId } from "../core/types.js";
import { foldUserAccount } from "../core/user-accounts.js";
import {
  EMAIL_OUTBOX_PAYLOAD_KINDS,
  claimedDeliveryId,
  emailNotificationEventType,
  emailNotificationMessageId,
  foldEmailOutbox,
  isStaleEmailClaim,
  requireAppendedEmailOutboxEvent,
  type EmailNotificationEventPayload,
  type EmailOutboxRecord,
  type EmailOutboxRecordEntry,
  type EmailOutboxState
} from "./email-notification-events.js";
import {
  emailDeliveryClaimTimeoutMs,
  emailNotificationErrorMessage,
  emailNotificationQueuedPayloadInput,
  failedEmailNotificationDelivery,
  isSkippedEmailNotificationQueueResult,
  looksLikeEmailAddress,
  missingEmailRecipientReason,
  queueResultFromOutboxRecord,
  queuedEmailNotificationResult,
  sentEmailNotificationDelivery,
  skippedEmailNotificationQueueResult,
  type DocumentEmailNotificationDelivery,
  type DocumentEmailNotificationQueueResult
} from "./email-notification-service-policy.js";
import { isDocumentConflictError } from "./concurrency-policy.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EmailAddress, EmailMessage, EmailSender } from "../ports/email.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";

export type { EmailNotificationAddressPayload, EmailNotificationEventPayload } from "./email-notification-events.js";
export { emailNotificationMessageId } from "./email-notification-events.js";
export * from "./email-notification-service-policy.js";

const EMAIL_OUTBOX_ACTOR_ID = "system:email-outbox";

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
    this.claimTimeoutMs = emailDeliveryClaimTimeoutMs(options.claimTimeoutSeconds);
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
        const reason = missingEmailRecipientReason(notification.recipientId);
        await this.append(event.tenantId, messageId, {
          kind: "EmailNotificationSkipped",
          messageId,
          sourceEventId: notification.eventId,
          sourceEventType: notification.eventType,
          payloadKind: notification.payloadKind,
          ruleName: notification.ruleName,
          recipientId: notification.recipientId,
          reason
        });
        queued.push(skippedEmailNotificationQueueResult({
          messageId,
          eventId: notification.eventId,
          ruleName: notification.ruleName,
          recipientId: notification.recipientId,
          reason
        }));
        continue;
      }
      const payloadInput = emailNotificationQueuedPayloadInput({ messageId, notification, from: this.from, to });
      await this.append(event.tenantId, messageId, {
        kind: "EmailNotificationQueued",
        messageId,
        sourceEventId: notification.eventId,
        sourceEventType: notification.eventType,
        payloadKind: notification.payloadKind,
        ruleName: notification.ruleName,
        recipientId: notification.recipientId,
        from: payloadInput.from,
        to: payloadInput.to,
        subject: notification.subject,
        text: notification.text,
        headers: payloadInput.headers
      });
      queued.push(queuedEmailNotificationResult({
        messageId,
        eventId: notification.eventId,
        ruleName: notification.ruleName,
        recipientId: notification.recipientId,
        to: to.email,
        subject: notification.subject
      }));
    }
    return queued;
  }

  async deliverFromDomainEvent(
    event: DomainEvent,
    snapshot?: DocumentSnapshot | null
  ): Promise<readonly DocumentEmailNotificationDelivery[]> {
    const queued = await this.queueFromDomainEvent(event, snapshot);
    const skipped = queued.filter(isSkippedEmailNotificationQueueResult);
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
      const messageText = emailNotificationErrorMessage(error);
      const recorded = await this.appendClaimCompletion(tenantId, messageId, claimId, {
        kind: "EmailNotificationFailed",
        messageId,
        claimId,
        error: messageText
      });
      if (!recorded) {
        return undefined;
      }
      return failedEmailNotificationDelivery({
        messageId,
        claim,
        error: messageText
      });
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
    return sentEmailNotificationDelivery({
      messageId,
      claim,
      sent
    });
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
          type: emailNotificationEventType(payload),
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
      if (isDocumentConflictError(error)) {
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
      if (isDocumentConflictError(error)) {
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
        type: emailNotificationEventType(payload),
        doctype: "__EmailOutbox",
        documentName: messageId,
        actorId: EMAIL_OUTBOX_ACTOR_ID,
        occurredAt: this.clock.now(),
        payload,
        metadata: {}
      } satisfies NewDomainEvent
    ]);
    return requireAppendedEmailOutboxEvent(event, tenantId, messageId, emailNotificationEventType(payload));
  }
}

export const fallbackEmailRecipientResolver: EmailRecipientResolver = {
  async emailForUser(_tenantId, userId) {
    return looksLikeEmailAddress(userId) ? { email: userId } : undefined;
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
