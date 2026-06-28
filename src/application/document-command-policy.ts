import type { DocumentMergeSnapshot } from "../core/document-merge.js";
import { badRequest, conflict, FrameworkError } from "../core/errors.js";
import { compactData } from "../core/schema.js";
import { allowedWorkflowTransitions, currentWorkflowState } from "../core/workflow.js";
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
