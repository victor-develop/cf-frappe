import { namedWorkflowStateFieldStream, namedWorkflowStream } from "../core/streams.js";
import {
  applyNamedWorkflowDefinitionToDocType,
  foldNamedWorkflowDefinition,
  normalizeNamedWorkflowDefinition,
  normalizeNamedWorkflows,
  type NamedWorkflowDefinitionState,
  type WorkflowNormalizationLimits
} from "../core/workflow.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocTypeDefinition,
  type DocumentData,
  type NamedWorkflowDefinition,
  type TenantId
} from "../core/types.js";
import {
  NAMED_WORKFLOW_PAYLOAD_KINDS,
  NAMED_WORKFLOW_FIELD_OWNERSHIP_PAYLOAD_KINDS,
  foldNamedWorkflowFieldOwnership,
  namedWorkflowClearedPayload,
  namedWorkflowDefinitionEvent,
  namedWorkflowFieldClaimedPayload,
  namedWorkflowFieldOwnershipEvent,
  namedWorkflowFieldReleasedPayload,
  namedWorkflowSavedPayload,
  replayNamedWorkflowAppend,
  type NamedWorkflowEventPayload,
  type NamedWorkflowFieldOwnershipState
} from "./workflow-events.js";
import {
  authorizeWorkflowAdministration,
  ensureWorkflowRolesKnown,
  ensureWorkflowExpectedVersion,
  planWorkflowDefinitionClear,
  planWorkflowDefinitionSave
} from "./workflow-policy.js";
import { projectDocTypeForFieldAccess } from "./document-field-access-policy.js";
import { FrameworkError } from "../core/errors.js";
import type { ModelRegistry } from "../core/registry.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventBatchStore, EventStore, StreamCatalog } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";

export type { NamedWorkflowEventPayload } from "./workflow-events.js";

export type PreWorkflowDocTypeResolver = (
  base: DocTypeDefinition,
  context: { readonly tenantId: TenantId }
) => DocTypeDefinition | Promise<DocTypeDefinition>;

export interface WorkflowRoleRecord {
  readonly name: string;
  readonly enabled: boolean;
}

export type WorkflowRoleResolver = (
  actor: Actor,
  tenantId: TenantId
) => Promise<readonly WorkflowRoleRecord[]>;

export interface WorkflowServiceOptions {
  readonly registry: ModelRegistry;
  readonly events: EventStore & EventBatchStore & StreamCatalog;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly adminRoles?: readonly string[];
  readonly preWorkflowDocTypeResolver?: PreWorkflowDocTypeResolver;
  readonly roleResolver?: WorkflowRoleResolver;
  readonly limits?: WorkflowNormalizationLimits;
}

export interface SaveWorkflowDefinitionCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly workflow: NamedWorkflowDefinition;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface ClearWorkflowDefinitionCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly workflowName: string;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export class WorkflowService {
  private readonly registry: ModelRegistry;
  private readonly events: EventStore & EventBatchStore & StreamCatalog;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];
  private readonly preWorkflowDocTypeResolver: PreWorkflowDocTypeResolver | undefined;
  private readonly roleResolver: WorkflowRoleResolver | undefined;
  private readonly limits: WorkflowNormalizationLimits;

  constructor(options: WorkflowServiceOptions) {
    this.registry = options.registry;
    this.events = options.events;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
    this.preWorkflowDocTypeResolver = options.preWorkflowDocTypeResolver;
    this.roleResolver = options.roleResolver;
    this.limits = options.limits ?? {};
  }

  async list(
    actor: Actor,
    doctypeName: string,
    tenantId?: TenantId
  ): Promise<readonly NamedWorkflowDefinitionState[]> {
    const resolvedTenantId = this.authorizeAdministration(actor, tenantId);
    const doctype = await this.preWorkflowDocTypeFor(doctypeName, resolvedTenantId);
    return this.statesFor(resolvedTenantId, doctype);
  }

  async get(
    actor: Actor,
    doctypeName: string,
    workflowName: string,
    tenantId?: TenantId
  ): Promise<NamedWorkflowDefinitionState> {
    const resolvedTenantId = this.authorizeAdministration(actor, tenantId);
    const doctype = await this.preWorkflowDocTypeFor(doctypeName, resolvedTenantId);
    return this.stateFor(resolvedTenantId, doctype, workflowName);
  }

  async effectiveDocType(
    doctypeName: string,
    tenantId: TenantId = DEFAULT_TENANT_ID,
    base?: DocTypeDefinition
  ): Promise<DocTypeDefinition> {
    const doctype = base ?? await this.preWorkflowDocTypeFor(doctypeName, tenantId);
    let effective = doctype;
    for (const state of await this.statesFor(tenantId, doctype)) {
      effective = applyNamedWorkflowDefinitionToDocType(effective, state, this.limits);
    }
    return effective;
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): TenantId {
    return authorizeWorkflowAdministration({ actor, tenantId, adminRoles: this.adminRoles });
  }

  async save(command: SaveWorkflowDefinitionCommand): Promise<NamedWorkflowDefinitionState> {
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    const doctype = await this.preWorkflowDocTypeFor(command.doctype, tenantId);
    const visibleDoctype = projectDocTypeForFieldAccess({
      actor: command.actor,
      doctype,
      action: "read",
      tenantId
    });
    const workflow = normalizeNamedWorkflowDefinition(visibleDoctype, command.workflow, this.limits);
    ensureWorkflowRolesKnown(workflow, await this.knownRoles(command.actor, tenantId));
    const state = await this.stateFor(tenantId, doctype, workflow.name);
    ensureWorkflowExpectedVersion(state, command.expectedVersion);
    const effective = await this.effectiveDocType(doctype.name, tenantId, doctype);
    normalizeNamedWorkflows(doctype, [
      ...(effective.workflows ?? []).filter((candidate) => candidate.name !== workflow.name),
      workflow
    ], this.limits);
    if (planWorkflowDefinitionSave(state.workflow, workflow).status === "noop" && !state.cleared) {
      return state;
    }
    const ownershipWrites = await this.planFieldOwnershipChange({
      tenantId,
      doctypeName: doctype.name,
      workflowName: workflow.name,
      beforeField: state.workflow?.stateField,
      afterField: workflow.stateField
    });
    return this.appendAndFold(state, {
      actor: command.actor,
      metadata: command.metadata,
      payload: namedWorkflowSavedPayload({ doctypeName: doctype.name, workflow }),
      ownershipWrites
    });
  }

  async clear(command: ClearWorkflowDefinitionCommand): Promise<NamedWorkflowDefinitionState> {
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    const doctype = await this.preWorkflowDocTypeFor(command.doctype, tenantId);
    const state = await this.stateFor(tenantId, doctype, command.workflowName);
    ensureWorkflowExpectedVersion(state, command.expectedVersion);
    if (planWorkflowDefinitionClear(state).status === "noop") {
      return state;
    }
    const ownershipWrites = await this.planFieldOwnershipChange({
      tenantId,
      doctypeName: doctype.name,
      workflowName: state.workflowName,
      beforeField: state.workflow?.stateField,
      afterField: undefined
    });
    return this.appendAndFold(state, {
      actor: command.actor,
      metadata: command.metadata,
      payload: namedWorkflowClearedPayload({
        doctypeName: doctype.name,
        workflowName: state.workflowName
      }),
      ownershipWrites
    });
  }

  private async statesFor(
    tenantId: TenantId,
    doctype: DocTypeDefinition
  ): Promise<readonly NamedWorkflowDefinitionState[]> {
    const names = new Set((doctype.workflows ?? []).map((workflow) => workflow.name));
    const streams = await this.events.listStreams({ tenantId, doctype: "__NamedWorkflows" });
    const runtimeStates: NamedWorkflowDefinitionState[] = [];
    for (const stream of streams) {
      const events = await this.events.readStream(stream, { payloadKinds: NAMED_WORKFLOW_PAYLOAD_KINDS });
      const first = events.find((event) =>
        (event.payload.kind === "NamedWorkflowSaved" || event.payload.kind === "NamedWorkflowCleared") &&
        event.payload.doctypeName === doctype.name
      );
      if (first === undefined ||
        (first.payload.kind !== "NamedWorkflowSaved" && first.payload.kind !== "NamedWorkflowCleared")) {
        continue;
      }
      names.add(first.payload.workflowName);
      runtimeStates.push(this.withStaticFallback(
        doctype,
        foldNamedWorkflowDefinition(tenantId, doctype.name, first.payload.workflowName, events)
      ));
    }
    const runtimeNames = new Set(runtimeStates.map((state) => state.workflowName));
    for (const name of names) {
      if (!runtimeNames.has(name)) {
        runtimeStates.push(this.withStaticFallback(
          doctype,
          foldNamedWorkflowDefinition(tenantId, doctype.name, name, [])
        ));
      }
    }
    return Object.freeze(runtimeStates.sort((left, right) => left.workflowName.localeCompare(right.workflowName)));
  }

  private async stateFor(
    tenantId: TenantId,
    doctype: DocTypeDefinition,
    workflowName: string
  ): Promise<NamedWorkflowDefinitionState> {
    const stream = namedWorkflowStream(tenantId, doctype.name, workflowName);
    const events = await this.events.readStream(stream, { payloadKinds: NAMED_WORKFLOW_PAYLOAD_KINDS });
    return this.withStaticFallback(
      doctype,
      foldNamedWorkflowDefinition(tenantId, doctype.name, workflowName, events)
    );
  }

  private withStaticFallback(
    doctype: DocTypeDefinition,
    state: NamedWorkflowDefinitionState
  ): NamedWorkflowDefinitionState {
    if (state.version !== 0 || state.workflow !== undefined || state.cleared) {
      return state;
    }
    const workflow = doctype.workflows?.find((candidate) => candidate.name === state.workflowName);
    return workflow === undefined ? state : Object.freeze({ ...state, workflow });
  }

  private async preWorkflowDocTypeFor(doctypeName: string, tenantId: TenantId): Promise<DocTypeDefinition> {
    const base = this.registry.get(doctypeName);
    return this.preWorkflowDocTypeResolver ? await this.preWorkflowDocTypeResolver(base, { tenantId }) : base;
  }

  private async knownRoles(actor: Actor, tenantId: TenantId): Promise<ReadonlyMap<string, "enabled" | "disabled">> {
    const roles = new Map<string, "enabled" | "disabled">();
    for (const role of [...this.adminRoles, ...registryRoleNames(this.registry)]) {
      roles.set(role, "enabled");
    }
    for (const role of await this.roleResolver?.(actor, tenantId) ?? []) {
      roles.set(role.name, role.enabled ? "enabled" : "disabled");
    }
    return roles;
  }

  private async appendAndFold<TPayload extends NamedWorkflowEventPayload>(
    state: NamedWorkflowDefinitionState,
    options: {
      readonly actor: Actor;
      readonly metadata: DocumentData | undefined;
      readonly payload: TPayload;
      readonly ownershipWrites: readonly WorkflowFieldOwnershipWrite[];
    }
  ): Promise<NamedWorkflowDefinitionState> {
    const stream = namedWorkflowStream(state.tenantId, state.doctypeName, state.workflowName);
    const event = namedWorkflowDefinitionEvent({
      id: this.ids.next("evt_"),
      tenantId: state.tenantId,
      stream,
      actor: options.actor,
      occurredAt: this.clock.now(),
      payload: options.payload,
      ...(options.metadata === undefined ? {} : { metadata: options.metadata })
    });
    const previous = await this.events.readStream(stream, { maxSequence: state.version });
    const saved = await this.events.appendBatch([
      { stream, expectedVersion: state.version, events: [event] },
      ...options.ownershipWrites.map((write) => {
        const ownershipStream = namedWorkflowStateFieldStream(
          write.state.tenantId,
          write.state.doctypeName,
          write.state.stateField
        );
        const payload = write.action === "claim"
          ? namedWorkflowFieldClaimedPayload({
              doctypeName: write.state.doctypeName,
              stateField: write.state.stateField,
              workflowName: state.workflowName
            })
          : namedWorkflowFieldReleasedPayload({
              doctypeName: write.state.doctypeName,
              stateField: write.state.stateField,
              workflowName: state.workflowName
            });
        return {
          stream: ownershipStream,
          expectedVersion: write.state.version,
          events: [namedWorkflowFieldOwnershipEvent({
            id: `${event.id}:field:${write.action}:${encodeURIComponent(write.state.stateField)}`,
            tenantId: write.state.tenantId,
            stream: ownershipStream,
            actor: options.actor,
            occurredAt: event.occurredAt,
            payload,
            ...(options.metadata === undefined ? {} : { metadata: options.metadata })
          })]
        };
      })
    ]);
    return replayNamedWorkflowAppend(
      state,
      previous,
      saved.filter((savedEvent) => savedEvent.stream === stream)
    );
  }

  private async planFieldOwnershipChange(input: {
    readonly tenantId: TenantId;
    readonly doctypeName: string;
    readonly workflowName: string;
    readonly beforeField: string | undefined;
    readonly afterField: string | undefined;
  }): Promise<readonly WorkflowFieldOwnershipWrite[]> {
    const writes: WorkflowFieldOwnershipWrite[] = [];
    if (input.beforeField !== undefined && input.beforeField !== input.afterField) {
      const previous = await this.fieldOwnershipFor(input.tenantId, input.doctypeName, input.beforeField);
      if (previous.workflowName !== undefined && previous.workflowName !== input.workflowName) {
        throw workflowFieldOwnershipError(input.doctypeName, input.beforeField, previous.workflowName);
      }
      if (previous.workflowName === input.workflowName) {
        writes.push({ action: "release", state: previous });
      }
    }
    if (input.afterField !== undefined) {
      const next = await this.fieldOwnershipFor(input.tenantId, input.doctypeName, input.afterField);
      if (next.workflowName !== undefined && next.workflowName !== input.workflowName) {
        throw workflowFieldOwnershipError(input.doctypeName, input.afterField, next.workflowName);
      }
      if (next.workflowName === undefined) {
        writes.push({ action: "claim", state: next });
      }
    }
    return Object.freeze(writes);
  }

  private async fieldOwnershipFor(
    tenantId: TenantId,
    doctypeName: string,
    stateField: string
  ): Promise<NamedWorkflowFieldOwnershipState> {
    const stream = namedWorkflowStateFieldStream(tenantId, doctypeName, stateField);
    const events = await this.events.readStream(stream, {
      payloadKinds: NAMED_WORKFLOW_FIELD_OWNERSHIP_PAYLOAD_KINDS
    });
    return foldNamedWorkflowFieldOwnership(tenantId, doctypeName, stateField, events);
  }
}

interface WorkflowFieldOwnershipWrite {
  readonly action: "claim" | "release";
  readonly state: NamedWorkflowFieldOwnershipState;
}

function workflowFieldOwnershipError(doctypeName: string, stateField: string, workflowName: string): FrameworkError {
  return new FrameworkError(
    "WORKFLOW_INVALID",
    `Workflow state field '${doctypeName}.${stateField}' is already owned by workflow '${workflowName}'`,
    { status: 400 }
  );
}

function registryRoleNames(registry: ModelRegistry): readonly string[] {
  const roles = new Set<string>();
  const add = (values: readonly string[] | undefined) => {
    for (const value of values ?? []) {
      roles.add(value);
    }
  };
  for (const doctype of registry.list()) {
    for (const rule of doctype.permissions ?? []) add(rule.roles);
    for (const field of doctype.fields) {
      for (const rule of field.permissions ?? []) add(rule.roles);
    }
    for (const workflow of doctype.workflows ?? []) {
      for (const transition of workflow.transitions) add(transition.roles);
    }
    for (const command of doctype.commands ?? []) add(command.roles);
  }
  for (const report of registry.listReports()) add(report.roles);
  for (const dashboard of registry.listDashboards()) add(dashboard.roles);
  for (const kanban of registry.listKanbans()) add(kanban.roles);
  for (const calendar of registry.listCalendars()) add(calendar.roles);
  for (const webForm of registry.listWebForms()) add(webForm.roles);
  for (const webView of registry.listWebViews()) add(webView.roles);
  for (const webPage of registry.listWebPages()) add(webPage.roles);
  for (const printFormat of registry.listPrintFormats()) add(printFormat.roles);
  for (const letterhead of registry.listPrintLetterheads()) add(letterhead.roles);
  for (const workspace of registry.listWorkspaces()) {
    add(workspace.roles);
    for (const section of workspace.sections) {
      for (const shortcut of section.shortcuts) add(shortcut.roles);
    }
  }
  return [...roles];
}
