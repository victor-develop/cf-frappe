import { notificationRulesStream } from "../core/streams.js";
import {
  foldNotificationRules,
  normalizeNotificationRule,
  type NotificationRuleState
} from "../core/notification-rules.js";
import {
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocTypeDefinition,
  type DocumentData,
  type NotificationRuleDefinition,
  type TenantId
} from "../core/types.js";
import {
  notificationRuleClearedPayload,
  notificationRuleEvent,
  notificationRuleEventsVisibleAt,
  notificationRuleSavedPayload,
  NOTIFICATION_RULE_PAYLOAD_KINDS,
  replayNotificationRuleAppend,
  type NotificationRuleEventPayload
} from "./notification-rule-events.js";
import {
  authorizeNotificationRuleAdministration,
  enabledNotificationRules,
  ensureNotificationRuleExpectedVersion,
  findNotificationRuleEntry,
  normalizeRequiredNotificationRuleText,
  planNotificationRuleClear,
  planNotificationRuleSave
} from "./notification-rule-policy.js";
import type { ModelRegistry } from "../core/registry.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";
import type { NotificationRuleProvider } from "./user-notification-service.js";

export type { NotificationRuleEventPayload } from "./notification-rule-events.js";

export type PreNotificationRuleDocTypeResolver = (
  base: DocTypeDefinition,
  context: { readonly tenantId: TenantId }
) => DocTypeDefinition | Promise<DocTypeDefinition>;

export interface NotificationRuleServiceOptions {
  readonly registry: ModelRegistry;
  readonly events: EventStore;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly adminRoles?: readonly string[];
  readonly preNotificationRuleDocTypeResolver?: PreNotificationRuleDocTypeResolver;
}

export interface SaveNotificationRuleCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly rule: NotificationRuleDefinition;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface ClearNotificationRuleCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly ruleName: string;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export class NotificationRuleService implements NotificationRuleProvider {
  private readonly registry: ModelRegistry;
  private readonly events: EventStore;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];
  private readonly preNotificationRuleDocTypeResolver: PreNotificationRuleDocTypeResolver | undefined;

  constructor(options: NotificationRuleServiceOptions) {
    this.registry = options.registry;
    this.events = options.events;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
    this.preNotificationRuleDocTypeResolver = options.preNotificationRuleDocTypeResolver;
  }

  async list(actor: Actor, doctypeName: string, tenantId?: TenantId): Promise<NotificationRuleState> {
    const resolvedTenantId = this.authorizeAdministration(actor, tenantId);
    const doctype = this.registry.get(doctypeName);
    return this.stateFor(resolvedTenantId, doctype.name);
  }

  async notificationRulesFor(
    tenantId: TenantId,
    doctypeName: string,
    options: { readonly occurredAt?: string } = {}
  ): Promise<readonly NotificationRuleDefinition[]> {
    const doctype = this.registry.get(doctypeName);
    return enabledNotificationRules(await this.stateFor(tenantId, doctype.name, options));
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): TenantId {
    return authorizeNotificationRuleAdministration({ actor, tenantId, adminRoles: this.adminRoles });
  }

  async save(command: SaveNotificationRuleCommand): Promise<NotificationRuleState> {
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    const doctype = await this.preNotificationRuleDocTypeFor(command.doctype, tenantId);
    const rule = normalizeNotificationRule(doctype, command.rule);
    const state = await this.stateFor(tenantId, doctype.name);
    ensureNotificationRuleExpectedVersion(state, command.expectedVersion);
    const existing = findNotificationRuleEntry(state, rule.name);
    if (planNotificationRuleSave(existing, rule).status === "noop") {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      metadata: command.metadata,
      payload: notificationRuleSavedPayload({
        doctypeName: doctype.name,
        rule
      })
    });
  }

  async clear(command: ClearNotificationRuleCommand): Promise<NotificationRuleState> {
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    const doctype = this.registry.get(command.doctype);
    const ruleName = normalizeRequiredNotificationRuleText(command.ruleName, "Notification rule name");
    const state = await this.stateFor(tenantId, doctype.name);
    ensureNotificationRuleExpectedVersion(state, command.expectedVersion);
    if (planNotificationRuleClear(findNotificationRuleEntry(state, ruleName)).status === "noop") {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      metadata: command.metadata,
      payload: notificationRuleClearedPayload({
        doctypeName: doctype.name,
        ruleName
      })
    });
  }

  private async stateFor(
    tenantId: TenantId,
    doctypeName: string,
    options: { readonly occurredAt?: string } = {}
  ): Promise<NotificationRuleState> {
    const stream = notificationRulesStream(tenantId);
    const events = await this.events.readStream(stream, { payloadKinds: NOTIFICATION_RULE_PAYLOAD_KINDS });
    return foldNotificationRules(
      tenantId,
      doctypeName,
      notificationRuleEventsVisibleAt(events, options.occurredAt)
    );
  }

  private async preNotificationRuleDocTypeFor(doctypeName: string, tenantId: TenantId) {
    const base = this.registry.get(doctypeName);
    return this.preNotificationRuleDocTypeResolver
      ? await this.preNotificationRuleDocTypeResolver(base, { tenantId })
      : base;
  }

  private async appendAndFold<TPayload extends NotificationRuleEventPayload>(
    state: NotificationRuleState,
    options: {
      readonly actor: Actor;
      readonly metadata: DocumentData | undefined;
      readonly payload: TPayload;
    }
  ): Promise<NotificationRuleState> {
    const stream = notificationRulesStream(state.tenantId);
    const event = notificationRuleEvent({
      id: this.ids.next("evt_"),
      tenantId: state.tenantId,
      stream,
      actor: options.actor,
      occurredAt: this.clock.now(),
      payload: options.payload,
      ...(options.metadata === undefined ? {} : { metadata: options.metadata })
    });
    const saved = await this.events.append(stream, state.version, [event]);
    return replayNotificationRuleAppend(
      state,
      await this.events.readStream(stream, { maxSequence: state.version }),
      saved
    );
  }
}
