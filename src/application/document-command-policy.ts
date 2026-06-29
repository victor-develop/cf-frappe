import type { DocumentFieldMergePlan, DocumentMergeSnapshot } from "../core/document-merge.js";
import { badRequest, conflict, FrameworkError, permissionDenied } from "../core/errors.js";
import { compactData } from "../core/schema.js";
import { allowedWorkflowTransitions, currentWorkflowState } from "../core/workflow.js";
import { copyDocumentData } from "./document-field-policy.js";
import { workflowTransitionEventType } from "./document-command-events.js";
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
  DocStatus,
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  MutableDocumentData,
  NewDomainEvent,
  PermissionAction,
  ValidationIssue,
  WorkflowDefinition
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
  readonly readOnlyIssues?: readonly ValidationIssue[] | undefined;
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
    ...(groups.readOnlyIssues ?? []),
    ...(groups.validationIssues ?? []),
    ...(groups.linkIssues ?? [])
  ];
}

export interface DocumentCreateValidationIssueGroups {
  readonly validationIssues?: readonly ValidationIssue[] | undefined;
  readonly linkIssues?: readonly ValidationIssue[] | undefined;
}

export function documentCreateValidationIssues(
  groups: DocumentCreateValidationIssueGroups
): readonly ValidationIssue[] {
  return [
    ...(groups.validationIssues ?? []),
    ...(groups.linkIssues ?? [])
  ];
}

export interface DocumentDomainCommandValidationIssueGroups {
  readonly originIssues?: readonly ValidationIssue[] | undefined;
  readonly readOnlyIssues?: readonly ValidationIssue[] | undefined;
  readonly validationIssues?: readonly ValidationIssue[] | undefined;
  readonly linkIssues?: readonly ValidationIssue[] | undefined;
}

export function documentDomainCommandValidationIssues(
  groups: DocumentDomainCommandValidationIssueGroups
): readonly ValidationIssue[] {
  return [
    ...(groups.originIssues ?? []),
    ...(groups.readOnlyIssues ?? []),
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

export interface DomainCommandPolicyPlan {
  readonly input: DocumentData;
  readonly patch: DocumentData;
  readonly permissionAction: PermissionAction;
  readonly allowReadOnlyFields: boolean;
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

export function requireWorkflowDefinition(
  doctype: Pick<DocTypeDefinition, "name" | "workflow">
): WorkflowDefinition {
  if (!doctype.workflow) {
    throw new FrameworkError("BAD_REQUEST", `${doctype.name} has no workflow`, { status: 400 });
  }
  return doctype.workflow;
}

export function planDomainCommandPolicy(input: {
  readonly actor: Actor;
  readonly definition: DomainCommandDefinition;
  readonly document: DocumentSnapshot;
  readonly input: MutableDocumentData;
  readonly now: string;
}): DomainCommandPolicyPlan {
  const commandInput = compactData(input.input);
  const patch = input.definition.buildPatch
    ? input.definition.buildPatch({
        actor: input.actor,
        document: input.document,
        input: commandInput,
        now: input.now
      })
    : pickCommandFields(input.definition.fields, commandInput);
  return {
    input: commandInput,
    patch: compactData(patch),
    permissionAction: input.definition.permissionAction ?? "update",
    allowReadOnlyFields: input.definition.allowReadOnlyFields ?? false
  };
}

export interface WorkflowTransitionPolicyPlan {
  readonly from: string;
  readonly to: string;
  readonly patch: DocumentData;
  readonly eventType: string;
}

export function planWorkflowTransitionPolicy(input: {
  readonly actor: Actor;
  readonly action: string;
  readonly doctypeName: string;
  readonly document: DocumentSnapshot;
  readonly workflow: WorkflowDefinition;
}): WorkflowTransitionPolicyPlan {
  const from = currentWorkflowState(input.workflow, input.document);
  const transition = allowedWorkflowTransitions({
    actor: input.actor,
    workflow: input.workflow,
    document: input.document
  }).find((item) => item.action === input.action);
  if (!transition) {
    throw new FrameworkError(
      "WORKFLOW_TRANSITION_DENIED",
      `Transition '${input.action}' is not allowed from '${from}'`,
      { status: 409 }
    );
  }
  return {
    from,
    to: transition.to,
    patch: { [input.workflow.stateField ?? "workflow_state"]: transition.to },
    eventType: workflowTransitionEventType({
      doctypeName: input.doctypeName,
      action: input.action,
      transitionEventType: transition.eventType
    })
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
