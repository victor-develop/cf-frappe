import type { DocumentMergeSnapshot } from "../core/document-merge.js";
import { badRequest, conflict, FrameworkError } from "../core/errors.js";
import { compactData } from "../core/schema.js";
import { allowedWorkflowTransitions, currentWorkflowState } from "../core/workflow.js";
import { copyDocumentData } from "./document-field-policy.js";
import {
  documentCreatedPayload,
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
  PermissionAction,
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

export function normalizeUnsetFields(fields: readonly string[] | undefined): readonly string[] {
  if (fields === undefined) {
    return [];
  }
  const normalized = fields.map((field) => field.trim()).filter((field) => field.length > 0);
  return [...new Set(normalized)];
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
    eventType: input.eventType ?? input.doctype.events?.create ?? `${input.doctype.name}Created`,
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
    eventType: input.eventType ?? input.doctype.events?.update ?? `${input.doctype.name}Updated`,
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
    eventType:
      transition.eventType ??
      `${input.doctypeName}${input.action[0]?.toUpperCase() ?? ""}${input.action.slice(1)}`
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
      eventType: doctype.events?.submit ?? `${doctype.name}Submitted`,
      payloadKind: "DocumentSubmitted"
    };
  }
  return {
    allowedStatus: ["submitted"],
    nextStatus: "cancelled",
    eventType: doctype.events?.cancel ?? `${doctype.name}Cancelled`,
    payloadKind: "DocumentCancelled"
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
    eventType: doctype.events?.delete ?? `${doctype.name}Deleted`,
    payloadKind: "DocumentDeleted"
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
