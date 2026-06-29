import {
  assignmentRuleAssignmentsFromDomainEvent,
  foldAssignmentRules,
  normalizeAssignmentRule,
  type AssignmentRuleState,
  type AssignmentRuleDocumentAssignment
} from "../core/assignment-rules.js";
import { defineDocumentHooks, type AfterCommitContext, type DocumentHooks } from "../core/document-hooks.js";
import { conflict, FrameworkError, permissionDenied } from "../core/errors.js";
import { assignmentRulesStream } from "../core/streams.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type AssignmentRuleDefinition,
  type DocTypeDefinition,
  type DocumentData,
  type TenantId
} from "../core/types.js";
import {
  assignmentRuleClearedPayload,
  assignmentRuleEvent,
  assignmentRuleEventsVisibleAt,
  assignmentRuleSavedPayload,
  ASSIGNMENT_RULE_PAYLOAD_KINDS,
  replayAssignmentRuleAppend,
  type AssignmentRuleEventPayload
} from "./assignment-rule-events.js";
import type { ModelRegistry } from "../core/registry.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";
import type { DocumentCommandExecutor } from "./document-service.js";

export type { AssignmentRuleEventPayload } from "./assignment-rule-events.js";

export type PreAssignmentRuleDocTypeResolver = (
  base: DocTypeDefinition,
  context: { readonly tenantId: TenantId }
) => DocTypeDefinition | Promise<DocTypeDefinition>;

export interface AssignmentRuleServiceOptions {
  readonly registry: ModelRegistry;
  readonly events: EventStore;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly adminRoles?: readonly string[];
  readonly preAssignmentRuleDocTypeResolver?: PreAssignmentRuleDocTypeResolver;
}

export interface SaveAssignmentRuleCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly rule: AssignmentRuleDefinition;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface ClearAssignmentRuleCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly ruleName: string;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface SetAssignmentRuleEnabledCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly ruleName: string;
  readonly enabled: boolean;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface AssignmentRuleProvider {
  assignmentRulesFor(
    tenantId: TenantId,
    doctypeName: string,
    options?: { readonly occurredAt?: string }
  ): Promise<readonly AssignmentRuleDefinition[]>;
}

export type AssignmentRuleActorResolver = (
  context: AfterCommitContext
) => Actor | Promise<Actor>;

export interface DocumentAssignmentRuleHookOptions {
  readonly documents: Pick<DocumentCommandExecutor, "assign">;
  readonly actor: Actor | AssignmentRuleActorResolver;
  readonly assignmentRules?: AssignmentRuleProvider;
  readonly onAssignmentError?: (
    error: unknown,
    context: AfterCommitContext,
    assignment: AssignmentRuleDocumentAssignment
  ) => void | Promise<void>;
}

export function createDocumentAssignmentRuleHooks(
  options: DocumentAssignmentRuleHookOptions
): DocumentHooks {
  return defineDocumentHooks({
    async afterCommit(context) {
      const runtimeRules = await options.assignmentRules?.assignmentRulesFor(
        context.event.tenantId,
        context.event.doctype,
        { occurredAt: context.event.occurredAt }
      ) ?? [];
      const rules = composeAssignmentRules(context.doctype.assignmentRules ?? [], runtimeRules);
      if (rules.length === 0) {
        return;
      }
      const assignments = assignmentRuleAssignmentsFromDomainEvent({
        event: context.event,
        snapshot: context.snapshot,
        rules
      });
      if (assignments.length === 0) {
        return;
      }
      const actor = await resolveAssignmentRuleActor(options.actor, context);
      for (const assignment of assignments) {
        try {
          await options.documents.assign({
            actor: assignmentActorForTenant(actor, context.event.tenantId),
            tenantId: context.event.tenantId,
            doctype: context.event.doctype,
            name: context.event.documentName,
            assignee: assignment.assigneeId,
            metadata: {
              sourceEventId: context.event.id,
              sourcePayloadKind: context.event.payload.kind,
              assignmentRuleName: assignment.ruleName
            }
          });
        } catch (error) {
          if (options.onAssignmentError === undefined) {
            throw error;
          }
          await options.onAssignmentError(error, context, assignment);
        }
      }
    }
  });
}

export class AssignmentRuleService implements AssignmentRuleProvider {
  private readonly registry: ModelRegistry;
  private readonly events: EventStore;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];
  private readonly preAssignmentRuleDocTypeResolver: PreAssignmentRuleDocTypeResolver | undefined;

  constructor(options: AssignmentRuleServiceOptions) {
    this.registry = options.registry;
    this.events = options.events;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
    this.preAssignmentRuleDocTypeResolver = options.preAssignmentRuleDocTypeResolver;
  }

  async list(actor: Actor, doctypeName: string, tenantId?: TenantId): Promise<AssignmentRuleState> {
    this.authorizeAdministration(actor, tenantId);
    const doctype = this.registry.get(doctypeName);
    return this.stateFor(resolveActorTenant(actor, tenantId), doctype.name);
  }

  async assignmentRulesFor(
    tenantId: TenantId,
    doctypeName: string,
    options: { readonly occurredAt?: string } = {}
  ): Promise<readonly AssignmentRuleDefinition[]> {
    const doctype = this.registry.get(doctypeName);
    return (await this.stateFor(tenantId, doctype.name, options)).rules
      .filter((entry) => entry.enabled)
      .map((entry) => entry.rule);
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): void {
    this.ensureAdmin(actor);
    resolveActorTenant(actor, tenantId);
  }

  async save(command: SaveAssignmentRuleCommand): Promise<AssignmentRuleState> {
    this.authorizeAdministration(command.actor, command.tenantId);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const doctype = await this.preAssignmentRuleDocTypeFor(command.doctype, tenantId);
    const rule = normalizeAssignmentRule(doctype, command.rule);
    const state = await this.stateFor(tenantId, doctype.name);
    ensureExpectedVersion(state, command.expectedVersion);
    const existing = state.rules.find((entry) => entry.rule.name === rule.name);
    if (existing && jsonEqual(existing.rule, rule)) {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      metadata: command.metadata,
      payload: assignmentRuleSavedPayload({
        doctypeName: doctype.name,
        rule
      })
    });
  }

  async clear(command: ClearAssignmentRuleCommand): Promise<AssignmentRuleState> {
    this.authorizeAdministration(command.actor, command.tenantId);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const doctype = this.registry.get(command.doctype);
    const ruleName = normalizeRequiredString(command.ruleName, "Assignment rule name");
    const state = await this.stateFor(tenantId, doctype.name);
    ensureExpectedVersion(state, command.expectedVersion);
    if (!state.rules.some((entry) => entry.rule.name === ruleName)) {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      metadata: command.metadata,
      payload: assignmentRuleClearedPayload({
        doctypeName: doctype.name,
        ruleName
      })
    });
  }

  async setEnabled(command: SetAssignmentRuleEnabledCommand): Promise<AssignmentRuleState> {
    this.authorizeAdministration(command.actor, command.tenantId);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const doctype = this.registry.get(command.doctype);
    const ruleName = normalizeRequiredString(command.ruleName, "Assignment rule name");
    const state = await this.stateFor(tenantId, doctype.name);
    ensureExpectedVersion(state, command.expectedVersion);
    const existing = state.rules.find((entry) => entry.rule.name === ruleName);
    if (existing === undefined) {
      throw new FrameworkError(
        "ASSIGNMENT_RULE_NOT_FOUND",
        `Assignment rule '${ruleName}' was not found`,
        { status: 404 }
      );
    }
    if (existing.enabled === command.enabled) {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      metadata: command.metadata,
      payload: {
        kind: "AssignmentRuleSaved",
        doctypeName: doctype.name,
        rule: {
          ...existing.rule,
          enabled: command.enabled
        }
      }
    });
  }

  private async stateFor(
    tenantId: TenantId,
    doctypeName: string,
    options: { readonly occurredAt?: string } = {}
  ): Promise<AssignmentRuleState> {
    const stream = assignmentRulesStream(tenantId);
    const events = await this.events.readStream(stream, { payloadKinds: ASSIGNMENT_RULE_PAYLOAD_KINDS });
    return foldAssignmentRules(tenantId, doctypeName, assignmentRuleEventsVisibleAt(events, options.occurredAt));
  }

  private async preAssignmentRuleDocTypeFor(doctypeName: string, tenantId: TenantId): Promise<DocTypeDefinition> {
    const base = this.registry.get(doctypeName);
    return this.preAssignmentRuleDocTypeResolver
      ? await this.preAssignmentRuleDocTypeResolver(base, { tenantId })
      : base;
  }

  private async appendAndFold<TPayload extends AssignmentRuleEventPayload>(
    state: AssignmentRuleState,
    options: {
      readonly actor: Actor;
      readonly metadata: DocumentData | undefined;
      readonly payload: TPayload;
    }
  ): Promise<AssignmentRuleState> {
    const stream = assignmentRulesStream(state.tenantId);
    const event = assignmentRuleEvent({
      id: this.ids.next("evt_"),
      tenantId: state.tenantId,
      stream,
      actor: options.actor,
      occurredAt: this.clock.now(),
      payload: options.payload,
      ...(options.metadata === undefined ? {} : { metadata: options.metadata })
    });
    const saved = await this.events.append(stream, state.version, [event]);
    return replayAssignmentRuleAppend(
      state,
      await this.events.readStream(stream, { maxSequence: state.version }),
      saved
    );
  }

  private ensureAdmin(actor: Actor): void {
    if (!this.adminRoles.some((role) => actor.roles.includes(role))) {
      throw permissionDenied(`Actor '${actor.id}' cannot manage assignment rules`);
    }
  }
}

function composeAssignmentRules(
  metadataRules: readonly AssignmentRuleDefinition[],
  runtimeRules: readonly AssignmentRuleDefinition[]
): readonly AssignmentRuleDefinition[] {
  if (metadataRules.length === 0) {
    return runtimeRules;
  }
  if (runtimeRules.length === 0) {
    return metadataRules;
  }
  const runtimeNames = new Set(runtimeRules.map((rule) => rule.name));
  return Object.freeze([
    ...metadataRules.filter((rule) => !runtimeNames.has(rule.name)),
    ...runtimeRules
  ]);
}

function resolveAssignmentRuleActor(
  actor: Actor | AssignmentRuleActorResolver,
  context: AfterCommitContext
): Actor | Promise<Actor> {
  return typeof actor === "function" ? actor(context) : actor;
}

function assignmentActorForTenant(actor: Actor, tenantId: TenantId): Actor {
  if (actor.tenantId !== undefined && actor.tenantId !== tenantId) {
    throw permissionDenied(`Assignment rule actor '${actor.id}' cannot assign documents for tenant '${tenantId}'`);
  }
  return { ...actor, tenantId };
}

function resolveActorTenant(actor: Actor, explicitTenantId: TenantId | undefined): TenantId {
  const actorTenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = explicitTenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${actor.id}' cannot manage assignment rules for tenant '${tenantId}'`);
  }
  return tenantId;
}

function ensureExpectedVersion(state: AssignmentRuleState, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected assignment rules at version ${expectedVersion}, found ${state.version}`);
  }
}

function normalizeRequiredString(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new FrameworkError("ASSIGNMENT_RULE_INVALID", `${label} must be a string`, { status: 400 });
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new FrameworkError("ASSIGNMENT_RULE_INVALID", `${label} is required`, { status: 400 });
  }
  return normalized;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
