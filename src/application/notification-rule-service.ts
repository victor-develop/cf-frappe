import { conflict, FrameworkError, permissionDenied } from "../core/errors.js";
import { notificationRulesStream } from "../core/streams.js";
import {
  foldNotificationRules,
  normalizeNotificationRule,
  type NotificationRuleState
} from "../core/notification-rules.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocTypeDefinition,
  type DocumentData,
  type NewDomainEvent,
  type NotificationRuleDefinition,
  type TenantId
} from "../core/types.js";
import type { ModelRegistry } from "../core/registry.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";
import type { NotificationRuleProvider } from "./user-notification-service.js";

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
    this.authorizeAdministration(actor, tenantId);
    const doctype = this.registry.get(doctypeName);
    return this.stateFor(resolveActorTenant(actor, tenantId), doctype.name);
  }

  async notificationRulesFor(
    tenantId: TenantId,
    doctypeName: string,
    options: { readonly occurredAt?: string } = {}
  ): Promise<readonly NotificationRuleDefinition[]> {
    const doctype = this.registry.get(doctypeName);
    return (await this.stateFor(tenantId, doctype.name, options)).rules
      .filter((entry) => entry.enabled)
      .map((entry) => entry.rule);
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): void {
    this.ensureAdmin(actor);
    resolveActorTenant(actor, tenantId);
  }

  async save(command: SaveNotificationRuleCommand): Promise<NotificationRuleState> {
    this.authorizeAdministration(command.actor, command.tenantId);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const doctype = await this.preNotificationRuleDocTypeFor(command.doctype, tenantId);
    const rule = normalizeNotificationRule(doctype, command.rule);
    const state = await this.stateFor(tenantId, doctype.name);
    ensureExpectedVersion(state, command.expectedVersion);
    const existing = state.rules.find((entry) => entry.rule.name === rule.name);
    if (existing && jsonEqual(existing.rule, rule)) {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      type: "NotificationRuleSaved",
      metadata: command.metadata,
      payload: {
        kind: "NotificationRuleSaved",
        doctypeName: doctype.name,
        rule
      }
    });
  }

  async clear(command: ClearNotificationRuleCommand): Promise<NotificationRuleState> {
    this.authorizeAdministration(command.actor, command.tenantId);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const doctype = this.registry.get(command.doctype);
    const ruleName = normalizeRequiredString(command.ruleName, "Notification rule name");
    const state = await this.stateFor(tenantId, doctype.name);
    ensureExpectedVersion(state, command.expectedVersion);
    if (!state.rules.some((entry) => entry.rule.name === ruleName)) {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      type: "NotificationRuleCleared",
      metadata: command.metadata,
      payload: {
        kind: "NotificationRuleCleared",
        doctypeName: doctype.name,
        ruleName
      }
    });
  }

  private async stateFor(
    tenantId: TenantId,
    doctypeName: string,
    options: { readonly occurredAt?: string } = {}
  ): Promise<NotificationRuleState> {
    const stream = notificationRulesStream(tenantId);
    const events = await this.events.readStream(stream, { payloadKinds: ["NotificationRuleSaved", "NotificationRuleCleared"] });
    const occurredAt = options.occurredAt;
    const boundedEvents = occurredAt === undefined ? events : events.filter((event) => event.occurredAt <= occurredAt);
    return foldNotificationRules(
      tenantId,
      doctypeName,
      boundedEvents
    );
  }

  private async preNotificationRuleDocTypeFor(doctypeName: string, tenantId: TenantId) {
    const base = this.registry.get(doctypeName);
    return this.preNotificationRuleDocTypeResolver
      ? await this.preNotificationRuleDocTypeResolver(base, { tenantId })
      : base;
  }

  private async appendAndFold<TPayload extends NewDomainEvent["payload"]>(
    state: NotificationRuleState,
    options: {
      readonly actor: Actor;
      readonly type: string;
      readonly metadata: DocumentData | undefined;
      readonly payload: TPayload;
    }
  ): Promise<NotificationRuleState> {
    const stream = notificationRulesStream(state.tenantId);
    const event: NewDomainEvent<TPayload> = {
      id: this.ids.next("evt_"),
      tenantId: state.tenantId,
      stream,
      type: options.type,
      doctype: "__NotificationRules",
      documentName: `${state.doctypeName}:${ruleNameForPayload(options.payload)}`,
      actorId: options.actor.id,
      occurredAt: this.clock.now(),
      payload: options.payload,
      metadata: options.metadata ?? {}
    };
    const saved = await this.events.append(stream, state.version, [event]);
    return foldNotificationRules(
      state.tenantId,
      state.doctypeName,
      [...(await this.events.readStream(stream, { maxSequence: state.version })), ...saved]
    );
  }

  private ensureAdmin(actor: Actor): void {
    if (!this.adminRoles.some((role) => actor.roles.includes(role))) {
      throw permissionDenied(`Actor '${actor.id}' cannot manage notification rules`);
    }
  }
}

function resolveActorTenant(actor: Actor, explicitTenantId: TenantId | undefined): TenantId {
  const actorTenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = explicitTenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${actor.id}' cannot manage notification rules for tenant '${tenantId}'`);
  }
  return tenantId;
}

function ensureExpectedVersion(state: NotificationRuleState, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected notification rules at version ${expectedVersion}, found ${state.version}`);
  }
}

function normalizeRequiredString(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new FrameworkError("NOTIFICATION_RULE_INVALID", `${label} must be a string`, { status: 400 });
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new FrameworkError("NOTIFICATION_RULE_INVALID", `${label} is required`, { status: 400 });
  }
  return normalized;
}

function ruleNameForPayload(payload: NewDomainEvent["payload"]): string {
  if (payload.kind === "NotificationRuleSaved") {
    return payload.rule.name;
  }
  if (payload.kind === "NotificationRuleCleared") {
    return payload.ruleName;
  }
  return "rule";
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
