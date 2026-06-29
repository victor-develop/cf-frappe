import { conflict, permissionDenied } from "../core/errors.js";
import { workflowDefinitionsStream } from "../core/streams.js";
import {
  applyWorkflowDefinitionToDocType,
  foldWorkflowDefinition,
  normalizeWorkflowDefinition,
  type WorkflowDefinitionState
} from "../core/workflow.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocTypeDefinition,
  type DocumentData,
  type TenantId,
  type WorkflowDefinition
} from "../core/types.js";
import {
  replayWorkflowDefinitionAppend,
  WORKFLOW_DEFINITION_PAYLOAD_KINDS,
  workflowDefinitionClearedPayload,
  workflowDefinitionEvent,
  workflowDefinitionSavedPayload,
  type WorkflowEventPayload
} from "./workflow-events.js";
import type { ModelRegistry } from "../core/registry.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";

export type { WorkflowEventPayload } from "./workflow-events.js";

export type PreWorkflowDocTypeResolver = (
  base: DocTypeDefinition,
  context: { readonly tenantId: TenantId }
) => DocTypeDefinition | Promise<DocTypeDefinition>;

export interface WorkflowServiceOptions {
  readonly registry: ModelRegistry;
  readonly events: EventStore;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly adminRoles?: readonly string[];
  readonly preWorkflowDocTypeResolver?: PreWorkflowDocTypeResolver;
}

export interface SaveWorkflowDefinitionCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly workflow: WorkflowDefinition;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface ClearWorkflowDefinitionCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export class WorkflowService {
  private readonly registry: ModelRegistry;
  private readonly events: EventStore;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];
  private readonly preWorkflowDocTypeResolver: PreWorkflowDocTypeResolver | undefined;

  constructor(options: WorkflowServiceOptions) {
    this.registry = options.registry;
    this.events = options.events;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
    this.preWorkflowDocTypeResolver = options.preWorkflowDocTypeResolver;
  }

  async list(actor: Actor, doctypeName: string, tenantId?: TenantId): Promise<WorkflowDefinitionState> {
    this.authorizeAdministration(actor, tenantId);
    const doctype = this.registry.get(doctypeName);
    return this.stateFor(resolveActorTenant(actor, tenantId), doctype.name);
  }

  async effectiveDocType(
    doctypeName: string,
    tenantId: TenantId = DEFAULT_TENANT_ID,
    base?: DocTypeDefinition
  ) {
    const doctype = base ?? await this.preWorkflowDocTypeFor(doctypeName, tenantId);
    return applyWorkflowDefinitionToDocType(doctype, await this.stateFor(tenantId, doctype.name));
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): void {
    this.ensureAdmin(actor);
    resolveActorTenant(actor, tenantId);
  }

  async save(command: SaveWorkflowDefinitionCommand): Promise<WorkflowDefinitionState> {
    this.authorizeAdministration(command.actor, command.tenantId);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const doctype = await this.preWorkflowDocTypeFor(command.doctype, tenantId);
    const workflow = normalizeWorkflowDefinition(doctype, command.workflow);
    const state = await this.stateFor(tenantId, doctype.name);
    ensureExpectedVersion(state, command.expectedVersion);
    if (workflowEqual(state.workflow, workflow)) {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      metadata: command.metadata,
      payload: workflowDefinitionSavedPayload({
        doctypeName: doctype.name,
        workflow
      })
    });
  }

  async clear(command: ClearWorkflowDefinitionCommand): Promise<WorkflowDefinitionState> {
    this.authorizeAdministration(command.actor, command.tenantId);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const doctype = this.registry.get(command.doctype);
    const state = await this.stateFor(tenantId, doctype.name);
    ensureExpectedVersion(state, command.expectedVersion);
    if (state.workflow === undefined) {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      metadata: command.metadata,
      payload: workflowDefinitionClearedPayload({
        doctypeName: doctype.name
      })
    });
  }

  private async stateFor(tenantId: TenantId, doctypeName: string): Promise<WorkflowDefinitionState> {
    const stream = workflowDefinitionsStream(tenantId);
    const events = await this.events.readStream(stream, { payloadKinds: WORKFLOW_DEFINITION_PAYLOAD_KINDS });
    return foldWorkflowDefinition(
      tenantId,
      doctypeName,
      events
    );
  }

  private async preWorkflowDocTypeFor(doctypeName: string, tenantId: TenantId): Promise<DocTypeDefinition> {
    const base = this.registry.get(doctypeName);
    return this.preWorkflowDocTypeResolver ? await this.preWorkflowDocTypeResolver(base, { tenantId }) : base;
  }

  private async appendAndFold<TPayload extends WorkflowEventPayload>(
    state: WorkflowDefinitionState,
    options: {
      readonly actor: Actor;
      readonly metadata: DocumentData | undefined;
      readonly payload: TPayload;
    }
  ): Promise<WorkflowDefinitionState> {
    const stream = workflowDefinitionsStream(state.tenantId);
    const event = workflowDefinitionEvent({
      id: this.ids.next("evt_"),
      tenantId: state.tenantId,
      stream,
      actor: options.actor,
      occurredAt: this.clock.now(),
      payload: options.payload,
      ...(options.metadata === undefined ? {} : { metadata: options.metadata })
    });
    const saved = await this.events.append(stream, state.version, [event]);
    return replayWorkflowDefinitionAppend(
      state,
      await this.events.readStream(stream, { maxSequence: state.version }),
      saved
    );
  }

  private ensureAdmin(actor: Actor): void {
    if (!this.adminRoles.some((role) => actor.roles.includes(role))) {
      throw permissionDenied(`Actor '${actor.id}' cannot manage workflows`);
    }
  }
}

function resolveActorTenant(actor: Actor, explicitTenantId: TenantId | undefined): TenantId {
  const actorTenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = explicitTenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${actor.id}' cannot manage workflows for tenant '${tenantId}'`);
  }
  return tenantId;
}

function ensureExpectedVersion(state: WorkflowDefinitionState, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected workflow definitions at version ${expectedVersion}, found ${state.version}`);
  }
}

function workflowEqual(left: WorkflowDefinition | undefined, right: WorkflowDefinition): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}
