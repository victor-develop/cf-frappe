import {
  assignmentRuleAssignmentsFromDomainEvent,
  foldAssignmentRules,
  normalizeAssignmentRule,
  type AssignmentRuleState,
  type AssignmentRuleDocumentAssignment
} from "../core/assignment-rules.js";
import { defineDocumentHooks, type AfterCommitContext, type DocumentHooks } from "../core/document-hooks.js";
import { domainEventPayloadKind } from "../core/domain-events.js";
import { assignmentRulesStream } from "../core/streams.js";
import {
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type AssignmentRuleDefinition,
  type DocTypeDefinition,
  type DocumentData,
  type TenantId
} from "../core/types.js";
import {
  assignmentRuleClearedPayload,
  assignmentRuleEnabledPayload,
  assignmentRuleEvent,
  assignmentRuleEventsVisibleAt,
  assignmentRuleSavedPayload,
  ASSIGNMENT_RULE_PAYLOAD_KINDS,
  replayAssignmentRuleAppend,
  type AssignmentRuleEventPayload
} from "./assignment-rule-events.js";
import {
  assignmentActorForTenant,
  authorizeAssignmentRuleAdministration,
  composeAssignmentRules,
  enabledAssignmentRules,
  ensureAssignmentRuleExpectedVersion,
  findAssignmentRuleEntry,
  normalizeRequiredAssignmentRuleText,
  planAssignmentRuleClear,
  planAssignmentRuleSave,
  planAssignmentRuleStatusChange,
  requireAssignmentRuleEntry,
  resolveAssignmentRuleActor
} from "./assignment-rule-policy.js";
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
              sourcePayloadKind: domainEventPayloadKind(context.event),
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
    const resolvedTenantId = this.authorizeAdministration(actor, tenantId);
    const doctype = this.registry.get(doctypeName);
    return this.stateFor(resolvedTenantId, doctype.name);
  }

  async assignmentRulesFor(
    tenantId: TenantId,
    doctypeName: string,
    options: { readonly occurredAt?: string } = {}
  ): Promise<readonly AssignmentRuleDefinition[]> {
    const doctype = this.registry.get(doctypeName);
    return enabledAssignmentRules(await this.stateFor(tenantId, doctype.name, options));
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): TenantId {
    return authorizeAssignmentRuleAdministration({ actor, tenantId, adminRoles: this.adminRoles });
  }

  async save(command: SaveAssignmentRuleCommand): Promise<AssignmentRuleState> {
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    const doctype = await this.preAssignmentRuleDocTypeFor(command.doctype, tenantId);
    const rule = normalizeAssignmentRule(doctype, command.rule);
    const state = await this.stateFor(tenantId, doctype.name);
    ensureAssignmentRuleExpectedVersion(state, command.expectedVersion);
    const existing = findAssignmentRuleEntry(state, rule.name);
    if (planAssignmentRuleSave(existing, rule).status === "noop") {
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
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    const doctype = this.registry.get(command.doctype);
    const ruleName = normalizeRequiredAssignmentRuleText(command.ruleName, "Assignment rule name");
    const state = await this.stateFor(tenantId, doctype.name);
    ensureAssignmentRuleExpectedVersion(state, command.expectedVersion);
    if (planAssignmentRuleClear(findAssignmentRuleEntry(state, ruleName)).status === "noop") {
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
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    const doctype = this.registry.get(command.doctype);
    const ruleName = normalizeRequiredAssignmentRuleText(command.ruleName, "Assignment rule name");
    const state = await this.stateFor(tenantId, doctype.name);
    ensureAssignmentRuleExpectedVersion(state, command.expectedVersion);
    const existing = requireAssignmentRuleEntry(state, ruleName);
    if (planAssignmentRuleStatusChange(existing, command.enabled).status === "noop") {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      metadata: command.metadata,
      payload: assignmentRuleEnabledPayload({
        doctypeName: doctype.name,
        rule: existing.rule,
        enabled: command.enabled
      })
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
}
