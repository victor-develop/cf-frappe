import type { DocumentFieldMergePlan, DocumentMergeSnapshot } from "../core/document-merge.js";
import { badRequest, conflict, FrameworkError, permissionDenied } from "../core/errors.js";
import { compactData } from "../core/schema.js";
import { evaluateNamedWorkflowTransition } from "../core/workflow.js";
import { copyDocumentData } from "./document-field-policy.js";
import {
  domainCommandAppliedPayload,
  workflowTransitionedPayload,
  workflowTransitionEventType,
  type DocumentCommandEventPayload,
  type DomainCommandTransitionFact
} from "./document-command-events.js";
import {
  documentCreatedPayload,
  documentDeletedPayload,
  documentLifecycleEventType,
  documentStatusChangedPayload,
  documentUpdatedPayload,
  type DocumentLifecycleEventPayload
} from "./document-lifecycle-events.js";
import type { RelatedDocTypeResolver } from "./document-reference-policy.js";
import type {
  Actor,
  DomainCommandDefinition,
  DomainCommandTransitionIntent,
  DocStatus,
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  MutableDocumentData,
  NamedWorkflowDefinition,
  NewDomainEvent,
  PermissionAction,
  ValidationIssue
} from "../core/types.js";

export function ensureExpectedVersion(existing: DocumentSnapshot, expectedVersion?: number): void {
  if (expectedVersion !== undefined && existing.version !== expectedVersion) {
    throw conflict(`Expected version ${expectedVersion}, found ${existing.version}`);
  }
}

export function ensureMergeBaseVersion(baseVersion: number): void {
  if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) {
    throw badRequest("baseVersion must be a non-negative integer");
  }
}

export function requireMergeBaseSnapshot<TSnapshot extends Pick<DocumentSnapshot, "version">>(input: {
  readonly base: TSnapshot | null | undefined;
  readonly baseVersion: number;
  readonly doctypeName: string;
  readonly documentName: string;
}): TSnapshot {
  if (!input.base || input.base.version !== input.baseVersion) {
    throw conflict(
      `Merge base version ${String(input.baseVersion)} was not found for ${input.doctypeName}/${input.documentName}`
    );
  }
  return input.base;
}

export function mergeSnapshotFromDocument(document: DocumentSnapshot): DocumentMergeSnapshot {
  return {
    version: document.version,
    docstatus: document.docstatus,
    data: document.data
  };
}

export function ensureDocumentStatus(
  document: DocumentSnapshot,
  allowed: readonly DocStatus[],
  action: string
): void {
  if (!allowed.includes(document.docstatus)) {
    throw new FrameworkError(
      "DOCUMENT_STATUS_CONFLICT",
      `Cannot ${action} ${document.doctype}/${document.name} while it is ${document.docstatus}`,
      { status: 409 }
    );
  }
}

export function ensureDocumentUpdateStatus(document: DocumentSnapshot, action: string): void {
  if (document.docstatus !== "draft" && document.docstatus !== "submitted") {
    ensureDocumentStatus(document, ["draft"], action);
  }
}

export function normalizeUnsetFields(fields: readonly string[] | undefined): readonly string[] {
  if (fields === undefined) {
    return [];
  }
  const normalized = fields.map((field) => field.trim()).filter((field) => field.length > 0);
  return [...new Set(normalized)];
}

export function ensureDocumentCreateAvailable(input: {
  readonly doctypeName: string;
  readonly documentName: string;
  readonly existing: Pick<DocumentSnapshot, "docstatus"> | null | undefined;
}): void {
  if (input.existing !== undefined && input.existing !== null && input.existing.docstatus !== "deleted") {
    throw conflict(`${input.doctypeName}/${input.documentName} already exists`);
  }
}

export type DocumentMergeDisposition = "conflict" | "noop" | "apply";

export function documentMergeDisposition(plan: Pick<DocumentFieldMergePlan, "status" | "patch" | "unset">): DocumentMergeDisposition {
  if (plan.status === "conflict") {
    return "conflict";
  }
  return Object.keys(plan.patch).length === 0 && plan.unset.length === 0 ? "noop" : "apply";
}

export interface DocumentUpdateValidationIssueGroups {
  readonly submittedUpdateIssues?: readonly ValidationIssue[] | undefined;
  readonly unsetIssues?: readonly ValidationIssue[] | undefined;
  readonly originIssues?: readonly ValidationIssue[] | undefined;
  readonly workflowStateIssues?: readonly ValidationIssue[] | undefined;
  readonly generatedNamingIssues?: readonly ValidationIssue[] | undefined;
  readonly readOnlyIssues?: readonly ValidationIssue[] | undefined;
  readonly fieldPermissionIssues?: readonly ValidationIssue[] | undefined;
  readonly validationIssues?: readonly ValidationIssue[] | undefined;
  readonly linkIssues?: readonly ValidationIssue[] | undefined;
}

export function documentUpdateValidationIssues(
  groups: DocumentUpdateValidationIssueGroups
): readonly ValidationIssue[] {
  return [
    ...(groups.submittedUpdateIssues ?? []),
    ...(groups.unsetIssues ?? []),
    ...(groups.originIssues ?? []),
    ...(groups.workflowStateIssues ?? []),
    ...(groups.generatedNamingIssues ?? []),
    ...(groups.readOnlyIssues ?? []),
    ...(groups.fieldPermissionIssues ?? []),
    ...(groups.validationIssues ?? []),
    ...(groups.linkIssues ?? [])
  ];
}

export interface DocumentCreateValidationIssueGroups {
  readonly workflowStateIssues?: readonly ValidationIssue[] | undefined;
  readonly fieldPermissionIssues?: readonly ValidationIssue[] | undefined;
  readonly validationIssues?: readonly ValidationIssue[] | undefined;
  readonly linkIssues?: readonly ValidationIssue[] | undefined;
}

export function documentCreateValidationIssues(
  groups: DocumentCreateValidationIssueGroups
): readonly ValidationIssue[] {
  return [
    ...(groups.workflowStateIssues ?? []),
    ...(groups.fieldPermissionIssues ?? []),
    ...(groups.validationIssues ?? []),
    ...(groups.linkIssues ?? [])
  ];
}

export interface DocumentDomainCommandValidationIssueGroups {
  readonly originIssues?: readonly ValidationIssue[] | undefined;
  readonly workflowStateIssues?: readonly ValidationIssue[] | undefined;
  readonly generatedNamingIssues?: readonly ValidationIssue[] | undefined;
  readonly readOnlyIssues?: readonly ValidationIssue[] | undefined;
  readonly fieldPermissionIssues?: readonly ValidationIssue[] | undefined;
  readonly validationIssues?: readonly ValidationIssue[] | undefined;
  readonly linkIssues?: readonly ValidationIssue[] | undefined;
}

export function documentDomainCommandValidationIssues(
  groups: DocumentDomainCommandValidationIssueGroups
): readonly ValidationIssue[] {
  return [
    ...(groups.originIssues ?? []),
    ...(groups.workflowStateIssues ?? []),
    ...(groups.generatedNamingIssues ?? []),
    ...(groups.readOnlyIssues ?? []),
    ...(groups.fieldPermissionIssues ?? []),
    ...(groups.validationIssues ?? []),
    ...(groups.linkIssues ?? [])
  ];
}

export function pickCommandFields(fields: readonly string[] | undefined, input: DocumentData): DocumentData {
  if (!fields) {
    return input;
  }
  return Object.fromEntries(fields.map((field) => [field, input[field]]).filter(([, value]) => value !== undefined)) as DocumentData;
}

export interface DocumentCreatePolicyPlan {
  readonly eventType: string;
  readonly docstatus: "draft";
  readonly payload: Extract<DocumentLifecycleEventPayload, { readonly kind: "DocumentCreated" }>;
}

export function planDocumentCreatePolicy(input: {
  readonly doctype: Pick<DocTypeDefinition, "name" | "events">;
  readonly data: DocumentData;
  readonly eventType?: string | undefined;
}): DocumentCreatePolicyPlan {
  return {
    eventType: documentLifecycleEventType({
      doctypeName: input.doctype.name,
      kind: "DocumentCreated",
      commandEventType: input.eventType,
      createEventType: input.doctype.events?.create
    }),
    docstatus: "draft",
    payload: documentCreatedPayload(input.data, "draft")
  };
}

export function documentCreateEventCommand(input: {
  readonly tenantId: string;
  readonly stream: string;
  readonly doctypeName: string;
  readonly documentName: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly plan: Pick<DocumentCreatePolicyPlan, "eventType" | "payload">;
  readonly metadata?: DocumentData | undefined;
}): Omit<NewDomainEvent<Extract<DocumentLifecycleEventPayload, { readonly kind: "DocumentCreated" }>>, "id" | "sequence"> {
  return {
    tenantId: input.tenantId,
    stream: input.stream,
    type: input.plan.eventType,
    doctype: input.doctypeName,
    documentName: input.documentName,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    payload: input.plan.payload,
    metadata: input.metadata ?? {}
  };
}

export interface DocumentUpdatePolicyPlan {
  readonly eventType: string;
  readonly payload: Extract<DocumentLifecycleEventPayload, { readonly kind: "DocumentUpdated" }>;
}

export function planDocumentUpdatePolicy(input: {
  readonly doctype: Pick<DocTypeDefinition, "name" | "events">;
  readonly patch: DocumentData;
  readonly unset?: readonly string[] | undefined;
  readonly eventType?: string | undefined;
}): DocumentUpdatePolicyPlan {
  return {
    eventType: documentLifecycleEventType({
      doctypeName: input.doctype.name,
      kind: "DocumentUpdated",
      commandEventType: input.eventType,
      updateEventType: input.doctype.events?.update
    }),
    payload: documentUpdatedPayload(input.patch, input.unset ?? [])
  };
}

export function documentUpdateEventCommand(input: {
  readonly tenantId: string;
  readonly stream: string;
  readonly doctypeName: string;
  readonly documentName: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly plan: Pick<DocumentUpdatePolicyPlan, "eventType" | "payload">;
  readonly metadata?: DocumentData | undefined;
}): Omit<NewDomainEvent<Extract<DocumentLifecycleEventPayload, { readonly kind: "DocumentUpdated" }>>, "id" | "sequence"> {
  return {
    tenantId: input.tenantId,
    stream: input.stream,
    type: input.plan.eventType,
    doctype: input.doctypeName,
    documentName: input.documentName,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    payload: input.plan.payload,
    metadata: input.metadata ?? {}
  };
}

export interface DomainCommandPolicyPlan {
  readonly input: DocumentData;
  readonly patch: DocumentData;
  readonly transitions: readonly DomainCommandTransitionIntent[];
  readonly permissionAction: PermissionAction;
  readonly allowReadOnlyFields: boolean;
  readonly bypassFieldPermissions: boolean;
}

export function canExecuteDomainCommandForRoles(
  actor: Actor,
  definition: Pick<DomainCommandDefinition, "roles">
): boolean {
  return definition.roles === undefined || definition.roles.some((role) => actor.roles.includes(role));
}

export function ensureDomainCommandRoleAccess(
  actor: Actor,
  definition: Pick<DomainCommandDefinition, "roles">,
  command: string
): void {
  if (!canExecuteDomainCommandForRoles(actor, definition)) {
    throw permissionDenied(`Actor '${actor.id}' cannot execute ${command}`);
  }
}

export function requireDomainCommandDefinition(
  doctype: Pick<DocTypeDefinition, "name" | "commands">,
  command: string
): DomainCommandDefinition {
  const definition = doctype.commands?.find((item) => item.name === command);
  if (!definition) {
    throw new FrameworkError("BAD_REQUEST", `${doctype.name} has no command '${command}'`, {
      status: 400
    });
  }
  return definition;
}

export function requireNamedWorkflowDefinition(
  doctype: Pick<DocTypeDefinition, "name" | "workflows">,
  workflowName: string
): NamedWorkflowDefinition {
  const workflow = doctype.workflows?.find((candidate) => candidate.name === workflowName);
  if (!workflow) {
    throw new FrameworkError("WORKFLOW_NOT_FOUND", `${doctype.name} has no workflow '${workflowName}'`, { status: 404 });
  }
  return workflow;
}

export function planDomainCommandPolicy(input: {
  readonly actor: Actor;
  readonly definition: DomainCommandDefinition;
  readonly document: DocumentSnapshot;
  readonly input: MutableDocumentData;
  readonly now: string;
}): DomainCommandPolicyPlan {
  const commandInput = compactData(input.input);
  if (input.definition.buildPatch !== undefined && input.definition.buildPlan !== undefined) {
    throw new FrameworkError("BAD_REQUEST", "Domain command cannot define both buildPatch and buildPlan", { status: 400 });
  }
  const context = {
    actor: input.actor,
    document: input.document,
    input: commandInput,
    now: input.now
  };
  const built = input.definition.buildPlan?.(context);
  const patch = built?.patch ?? (input.definition.buildPatch
    ? input.definition.buildPatch(context)
    : pickCommandFields(input.definition.fields, commandInput));
  return {
    input: commandInput,
    patch: compactData(patch),
    transitions: normalizeDomainCommandTransitionIntents(built?.transitions),
    permissionAction: input.definition.permissionAction ?? "update",
    allowReadOnlyFields: input.definition.allowReadOnlyFields ?? false,
    bypassFieldPermissions: input.definition.bypassFieldPermissions ?? false
  };
}

function normalizeDomainCommandTransitionIntents(
  transitions: readonly DomainCommandTransitionIntent[] | undefined
): readonly DomainCommandTransitionIntent[] {
  if (transitions === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(transitions)) {
    throw new FrameworkError("BAD_REQUEST", "Domain command transitions must be an array", { status: 400 });
  }
  return Object.freeze(transitions.map((transition, index) => {
    if (typeof transition !== "object" || transition === null || Array.isArray(transition)) {
      throw new FrameworkError("BAD_REQUEST", `Domain command transition ${String(index + 1)} must be an object`, {
        status: 400
      });
    }
    const suffix = String(index + 1);
    return Object.freeze({
      workflow: requiredDomainCommandTransitionId(transition.workflow, `transition ${suffix} workflow`),
      action: requiredDomainCommandTransitionId(transition.action, `transition ${suffix} action`)
    });
  }));
}

function requiredDomainCommandTransitionId(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FrameworkError("BAD_REQUEST", `Domain command ${label} is required`, { status: 400 });
  }
  return value.trim();
}

export function domainCommandEventCommand(input: {
  readonly tenantId: string;
  readonly stream: string;
  readonly doctypeName: string;
  readonly documentName: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly eventType: string;
  readonly commandName: string;
  readonly commandInput: DocumentData;
  readonly patch: DocumentData;
  readonly transitions?: readonly DomainCommandTransitionFact[];
  readonly metadata?: DocumentData | undefined;
}): Omit<
  NewDomainEvent<Extract<DocumentCommandEventPayload, { readonly kind: "DomainCommandApplied" }>>,
  "id" | "sequence"
> {
  return {
    tenantId: input.tenantId,
    stream: input.stream,
    type: input.eventType,
    doctype: input.doctypeName,
    documentName: input.documentName,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    payload: domainCommandAppliedPayload({
      command: input.commandName,
      input: input.commandInput,
      patch: input.patch,
      ...(input.transitions === undefined ? {} : { transitions: input.transitions })
    }),
    metadata: input.metadata ?? {}
  };
}

export interface WorkflowTransitionPolicyPlan {
  readonly workflow: string;
  readonly stateField: string;
  readonly action: string;
  readonly from: string;
  readonly to: string;
  readonly patch: DocumentData;
  readonly eventType: string;
}

export interface DomainCommandTransitionsPlan {
  readonly patch: DocumentData;
  readonly transitions: readonly DomainCommandTransitionFact[];
}

export function planDomainCommandTransitions(input: {
  readonly actor: Actor;
  readonly doctype: Pick<DocTypeDefinition, "name" | "workflows">;
  readonly document: DocumentSnapshot;
  readonly patch: DocumentData;
  readonly transitions: readonly DomainCommandTransitionIntent[];
  readonly commandInput: DocumentData;
}): DomainCommandTransitionsPlan {
  const controlledFields = new Set((input.doctype.workflows ?? []).map((workflow) => workflow.stateField));
  const ordinaryPatch = Object.freeze(Object.fromEntries(
    Object.entries(input.patch).filter(([field]) => !controlledFields.has(field))
  )) as DocumentData;
  let proposed = Object.freeze({
    ...input.document,
    data: Object.freeze({ ...input.document.data, ...ordinaryPatch })
  });
  const authorizedPatch: Record<string, string> = {};
  const facts: DomainCommandTransitionFact[] = [];
  for (const intent of input.transitions) {
    const workflow = requireNamedWorkflowDefinition(input.doctype, intent.workflow);
    const plan = planWorkflowTransitionPolicy({
      actor: input.actor,
      action: intent.action,
      doctypeName: input.doctype.name,
      document: proposed,
      workflow,
      input: input.commandInput
    });
    authorizedPatch[plan.stateField] = plan.to;
    facts.push(Object.freeze({
      workflow: plan.workflow,
      stateField: plan.stateField,
      action: plan.action,
      from: plan.from,
      to: plan.to
    }));
    proposed = Object.freeze({
      ...proposed,
      data: Object.freeze({ ...proposed.data, ...plan.patch })
    });
  }
  for (const workflow of input.doctype.workflows ?? []) {
    if (!Object.prototype.hasOwnProperty.call(input.patch, workflow.stateField)) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(authorizedPatch, workflow.stateField) ||
      input.patch[workflow.stateField] !== authorizedPatch[workflow.stateField]) {
      throw new FrameworkError(
        "WORKFLOW_STATE_PROTECTED",
        `Field '${workflow.stateField}' can only be changed by an explicit '${workflow.name}' transition intent`,
        { status: 409 }
      );
    }
  }
  return Object.freeze({
    patch: Object.freeze({ ...ordinaryPatch, ...authorizedPatch }),
    transitions: Object.freeze(facts)
  });
}

export function planWorkflowTransitionPolicy(input: {
  readonly actor: Actor;
  readonly action: string;
  readonly doctypeName: string;
  readonly document: DocumentSnapshot;
  readonly workflow: NamedWorkflowDefinition;
  readonly input?: DocumentData;
}): WorkflowTransitionPolicyPlan {
  const decision = evaluateNamedWorkflowTransition({
    actor: input.actor,
    document: input.document,
    workflow: input.workflow,
    ...(input.input === undefined ? {} : { input: input.input })
  }, input.action);
  if (decision.status === "action-not-found") {
    throw new FrameworkError(
      "WORKFLOW_ACTION_NOT_FOUND",
      `Workflow '${input.workflow.name}' has no action '${input.action}'`,
      { status: 404 }
    );
  }
  if (decision.status === "state-denied") {
    throw new FrameworkError(
      "WORKFLOW_TRANSITION_DENIED",
      `Workflow '${input.workflow.name}' action '${input.action}' is not allowed from '${decision.from}'`,
      { status: 409 }
    );
  }
  if (decision.status === "role-denied") {
    throw new FrameworkError(
      "WORKFLOW_TRANSITION_DENIED",
      `Actor '${input.actor.id}' cannot execute '${input.workflow.name}.${input.action}'`,
      { status: 403 }
    );
  }
  if (decision.status === "condition-denied") {
    throw new FrameworkError(
      "WORKFLOW_TRANSITION_CONDITION_FAILED",
      `Workflow '${input.workflow.name}' action '${input.action}' conditions were not met`,
      { status: 409 }
    );
  }
  const transition = decision.transition;
  return {
    workflow: input.workflow.name,
    stateField: input.workflow.stateField,
    action: input.action,
    from: decision.from,
    to: transition.to,
    patch: { [input.workflow.stateField]: transition.to },
    eventType: workflowTransitionEventType({
      doctypeName: input.doctypeName,
      workflow: input.workflow.name,
      action: input.action,
      transitionEventType: transition.eventType
    })
  };
}

export function workflowTransitionEventCommand(input: {
  readonly tenantId: string;
  readonly stream: string;
  readonly doctypeName: string;
  readonly documentName: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly action: string;
  readonly plan: WorkflowTransitionPolicyPlan;
  readonly metadata?: DocumentData | undefined;
}): Omit<
  NewDomainEvent<Extract<DocumentCommandEventPayload, { readonly kind: "WorkflowTransitioned" }>>,
  "id" | "sequence"
> {
  return {
    tenantId: input.tenantId,
    stream: input.stream,
    type: input.plan.eventType,
    doctype: input.doctypeName,
    documentName: input.documentName,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    payload: workflowTransitionedPayload({
      workflow: input.plan.workflow,
      stateField: input.plan.stateField,
      action: input.action,
      from: input.plan.from,
      to: input.plan.to,
      patch: input.plan.patch
    }),
    metadata: input.metadata ?? {}
  };
}

export type DocumentStatusChangeAction = "submit" | "cancel";

export interface DocumentStatusChangePolicyPlan {
  readonly allowedStatus: readonly DocStatus[];
  readonly nextStatus: DocStatus;
  readonly eventType: string;
  readonly payloadKind: "DocumentSubmitted" | "DocumentCancelled";
}

export function planDocumentStatusChangePolicy(
  doctype: Pick<DocTypeDefinition, "name" | "events">,
  action: DocumentStatusChangeAction
): DocumentStatusChangePolicyPlan {
  if (action === "submit") {
    return {
      allowedStatus: ["draft"],
      nextStatus: "submitted",
      eventType: documentLifecycleEventType({
        doctypeName: doctype.name,
        kind: "DocumentSubmitted",
        submitEventType: doctype.events?.submit
      }),
      payloadKind: "DocumentSubmitted"
    };
  }
  return {
    allowedStatus: ["submitted"],
    nextStatus: "cancelled",
    eventType: documentLifecycleEventType({
      doctypeName: doctype.name,
      kind: "DocumentCancelled",
      cancelEventType: doctype.events?.cancel
    }),
    payloadKind: "DocumentCancelled"
  };
}

export function documentStatusChangeEventCommand(input: {
  readonly tenantId: string;
  readonly stream: string;
  readonly doctypeName: string;
  readonly documentName: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly plan: Pick<DocumentStatusChangePolicyPlan, "eventType" | "payloadKind">;
  readonly metadata?: DocumentData | undefined;
}): Omit<
  NewDomainEvent<Extract<DocumentLifecycleEventPayload, { readonly kind: "DocumentSubmitted" | "DocumentCancelled" }>>,
  "id" | "sequence"
> {
  return {
    tenantId: input.tenantId,
    stream: input.stream,
    type: input.plan.eventType,
    doctype: input.doctypeName,
    documentName: input.documentName,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    payload: documentStatusChangedPayload(input.plan.payloadKind),
    metadata: input.metadata ?? {}
  };
}

export interface DocumentDeletePolicyPlan {
  readonly allowedStatus: readonly DocStatus[];
  readonly nextStatus: "deleted";
  readonly eventType: string;
  readonly payloadKind: "DocumentDeleted";
}

export function planDocumentDeletePolicy(
  doctype: Pick<DocTypeDefinition, "name" | "events">
): DocumentDeletePolicyPlan {
  return {
    allowedStatus: ["draft", "cancelled"],
    nextStatus: "deleted",
    eventType: documentLifecycleEventType({
      doctypeName: doctype.name,
      kind: "DocumentDeleted",
      deleteEventType: doctype.events?.delete
    }),
    payloadKind: "DocumentDeleted"
  };
}

export function documentDeleteEventCommand(input: {
  readonly tenantId: string;
  readonly stream: string;
  readonly doctypeName: string;
  readonly documentName: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly plan: Pick<DocumentDeletePolicyPlan, "eventType">;
  readonly metadata?: DocumentData | undefined;
}): Omit<NewDomainEvent<Extract<DocumentLifecycleEventPayload, { readonly kind: "DocumentDeleted" }>>, "id" | "sequence"> {
  return {
    tenantId: input.tenantId,
    stream: input.stream,
    type: input.plan.eventType,
    doctype: input.doctypeName,
    documentName: input.documentName,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    payload: documentDeletedPayload(),
    metadata: input.metadata ?? {}
  };
}

export type DocumentCopyAction = "duplicate" | "amend";

export interface DocumentCopyPolicyPlan {
  readonly data: DocumentData;
  readonly metadata: DocumentData;
}

export function planDocumentCopyPolicy(input: {
  readonly action: DocumentCopyAction;
  readonly doctype: DocTypeDefinition;
  readonly existing: DocumentSnapshot;
  readonly data?: MutableDocumentData | undefined;
  readonly metadata?: DocumentData | undefined;
  readonly relatedDocType: RelatedDocTypeResolver;
}): DocumentCopyPolicyPlan {
  const overrides = compactData(input.data ?? {});
  if (input.action === "duplicate") {
    return {
      data: copyDocumentData(
        input.doctype,
        {
          ...copyDocumentData(input.doctype, input.existing.data, input.relatedDocType, { skipNoCopy: true }),
          ...overrides
        },
        input.relatedDocType
      ),
      metadata: {
        ...(input.metadata ?? {}),
        duplicatedFrom: input.existing.name,
        duplicatedFromVersion: input.existing.version
      }
    };
  }
  return {
    data: copyDocumentData(
      input.doctype,
      {
        ...input.existing.data,
        ...overrides
      },
      input.relatedDocType
    ),
    metadata: {
      ...(input.metadata ?? {}),
      amendedFrom: input.existing.name,
      amendedFromVersion: input.existing.version
    }
  };
}
