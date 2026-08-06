import {
  applyDocumentDataChange,
  foldDocument,
  foldDocumentAssignments,
  foldDocumentFollowers,
  foldDocumentTags
} from "../core/events.js";
import {
  type DocumentSharePermission,
  type DocumentShareProvider
} from "../core/document-shares.js";
import { applyDefaults, compactData, validateDocumentData } from "../core/schema.js";
import { documentChangeContext } from "../core/document-change.js";
import {
  planDocumentFieldMerge,
  type DocumentFieldMergePlan
} from "../core/document-merge.js";
import {
  documentCollaborationEventCommand,
  documentCollaborationPlanDisposition,
  ensureSharedGrantDelegabilityForLookup,
  type CollaborationCollectionAction,
  planDocumentActivityPolicy,
  planDocumentAssignmentChangePolicy,
  planDocumentCommentPolicy,
  planDocumentFollowerChangePolicy,
  planDocumentSharePolicy,
  planDocumentShareRevocationPolicy,
  planDocumentTagChangePolicy,
} from "./document-collaboration-policy.js";
import {
  bulkNamedCommand,
  bulkDocumentFailure,
  runBulkDocumentSelections
} from "./document-bulk-policy.js";
import {
  documentAtomicAuxiliarySnapshots,
  documentAtomicCommitEntries,
  type AtomicNamingSeriesWrite,
  type AtomicUniqueReleaseWrite,
  type AtomicUniqueReservationWrite
} from "./document-atomic-commit-policy.js";
import {
  AutomationRunPlanner,
  type AutomationRunCommitPlan
} from "./automation-run-service.js";
import { isDocumentConflictError } from "./concurrency-policy.js";
import {
  canReadLinkedDocumentTarget,
  documentSatisfiesUserPermissions,
  planDocTypeActionAccess,
  planDocumentActionAccess,
  planDocumentUserPermissionAccess,
  resolveDocumentSharedPermissionsForAction,
  type DocumentSharedPermissionResolution
} from "./document-access-policy.js";
import {
  ensureDocumentStatus,
  ensureDocumentUpdateStatus,
  ensureExpectedVersion,
  ensureMergeBaseVersion,
  ensureDocumentCreateAvailable,
  mergeSnapshotFromDocument,
  normalizeUnsetFields,
  documentCreateEventCommand,
  documentDeleteEventCommand,
  domainCommandEventCommand,
  documentCreateValidationIssues,
  documentDomainCommandValidationIssues,
  documentMergeDisposition,
  documentStatusChangeEventCommand,
  documentUpdateEventCommand,
  ensureDomainCommandRoleAccess,
  documentUpdateValidationIssues,
  planDocumentCopyPolicy,
  planDocumentCreatePolicy,
  planDocumentDeletePolicy,
  planDocumentStatusChangePolicy,
  type DocumentStatusChangePolicyPlan,
  planDocumentUpdatePolicy,
  planDomainCommandPolicy,
  planDomainCommandTransitions,
  planWorkflowTransitionPolicy,
  requireDomainCommandDefinition,
  requireMergeBaseSnapshot,
  requireNamedWorkflowDefinition,
  workflowTransitionEventCommand
} from "./document-command-policy.js";
import { documentShareStateFromEvents } from "./document-share-events.js";
import {
  requireFirstSavedEvent,
  requireLiveDocumentSnapshot,
  requireSavedEvent,
  snapshotFromCommittedDocumentEvent,
  snapshotFromDocumentCreatedEvent
} from "./document-lifecycle-events.js";
import {
  planUniqueValueReservationOwnerLookup,
  planUniqueValueReleaseWriteDecision,
  planUniqueValueReservationWriteDecision,
  planUniqueValueReleaseEvent,
  planUniqueValueReservationEvent,
  releasedUniqueValueReservations,
  uniqueReservationOwnerStillOwnsValue,
  uniqueValueEventCommand,
  uniqueValueReservations,
  type UniqueValueReservation
} from "./document-unique-values.js";
import {
  ensureCreateNameAllowed,
  generatedNamingFieldMutationIssues,
  namingSeriesEventCommand,
  planNamingSeriesEvent,
  resolveDocumentName
} from "./document-naming.js";
import {
  DEFAULT_NAMING_MAX_ATTEMPTS,
  namingSeriesCurrentValue,
  namingTargetData,
  scanNamingCandidates,
  resolveNamingSeriesIdentity
} from "../core/naming.js";
import {
  applyFetchedFields,
  validateDocumentLinks,
  type RelatedDocTypeResolver
} from "./document-reference-policy.js";
import {
  resolveTenant,
  resolveTenantDocType,
  resolveTenantDocTypeContext,
  type TenantDocTypeResolver
} from "./document-tenant-policy.js";
import {
  allowOnSubmitIssues,
  childTableOriginIssues,
  documentUnsetIssues,
  preserveReadOnlyTableValues,
  readonlyIssues,
  stripInternalTableFields,
  workflowStateCreateIssues,
  workflowStateMutationIssues
} from "./document-field-policy.js";
import {
  fieldPermissionIssues,
  projectDocumentMergePlanForFieldAccess,
  redactDocumentSnapshot
} from "./document-field-access-policy.js";
import { documentStream, namingSeriesStream } from "../core/streams.js";
import {
  type UserPermissionProvider
} from "../core/user-permissions.js";
import {
  documentValidationIssues,
  runDocumentAfterCommitHooks,
  runDocumentBeforeValidateHooks,
  runDocumentValidationHooks,
  type AfterCommitContext
} from "../core/document-hooks.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Clock } from "../ports/clock.js";
import { systemClock } from "../ports/clock.js";
import type { DocumentCommit, DocumentStore } from "../ports/document-store.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { cryptoIdGenerator } from "../ports/id-generator.js";
import {
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocStatus,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentSnapshot,
  type DomainEvent,
  type FieldDefinition,
  type MutableDocumentData,
  type NamingSeriesStrategy,
  type NewDomainEvent,
  type PermissionAction,
  type ValidationIssue
} from "../core/types.js";
import {
  conflict,
  FrameworkError,
  permissionDenied,
  validationFailed,
  type FrameworkErrorCode
} from "../core/errors.js";

export type { DocumentCommandEventPayload } from "./document-command-events.js";
export type { DocumentCollaborationEventPayload } from "./document-collaboration-events.js";
export type { DocumentLifecycleEventPayload } from "./document-lifecycle-events.js";
export type { DocumentShareEventPayload } from "./document-share-events.js";
export {
  bulkDeleteDocumentFailure,
  bulkDocumentFailure,
  normalizeBulkDeleteDocumentSelections,
  normalizeBulkDocumentSelections
} from "./document-bulk-policy.js";

export interface DocumentServiceOptions {
  readonly registry: ModelRegistry;
  readonly store: DocumentStore;
  readonly doctypeResolver?: DocumentServiceDocTypeResolver;
  readonly userPermissions?: UserPermissionProvider;
  readonly documentShares?: DocumentShareProvider;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly automationRuns?: AutomationRunPlanner;
  readonly onHookError?: (error: unknown, event: DomainEvent) => void | Promise<void>;
  readonly afterCommit?: (context: AfterCommitContext) => void | Promise<void>;
}

export type DocumentServiceDocTypeResolver = TenantDocTypeResolver;

interface DocumentServiceDocTypeContext {
  readonly doctype: DocTypeDefinition;
  readonly relatedDocType: RelatedDocTypeResolver;
}

interface DocumentNameResolution {
  readonly name: string;
  readonly data: DocumentData;
  readonly namingSeriesWrite?: AtomicNamingSeriesWrite & {
    readonly name: string;
    readonly candidateAttempts: number;
  };
}

export interface CreateDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly data: MutableDocumentData;
  readonly tenantId?: string;
  readonly name?: string;
  readonly metadata?: DocumentData;
  readonly eventType?: string;
}

export interface UpdateDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly patch: MutableDocumentData;
  readonly unset?: readonly string[];
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
  readonly eventType?: string;
}

export interface MergeDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly baseVersion: number;
  readonly patch: MutableDocumentData;
  readonly unset?: readonly string[];
  readonly tenantId?: string;
  readonly metadata?: DocumentData;
  readonly eventType?: string;
}

export interface MergeDocumentAppliedResult {
  readonly status: "applied";
  readonly plan: DocumentFieldMergePlan;
  readonly document: DocumentSnapshot;
}

export interface MergeDocumentNoopResult {
  readonly status: "noop";
  readonly plan: DocumentFieldMergePlan;
  readonly document: DocumentSnapshot;
}

export interface MergeDocumentConflictResult {
  readonly status: "conflict";
  readonly plan: DocumentFieldMergePlan;
  readonly document: DocumentSnapshot;
}

export type MergeDocumentResult =
  | MergeDocumentAppliedResult
  | MergeDocumentNoopResult
  | MergeDocumentConflictResult;

export interface DuplicateDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly data?: MutableDocumentData;
  readonly tenantId?: string;
  readonly newName?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
  readonly eventType?: string;
}

export interface AmendDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly data?: MutableDocumentData;
  readonly tenantId?: string;
  readonly newName?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
  readonly eventType?: string;
}

export interface DeleteDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface BulkDocumentSelection {
  readonly name: string;
  readonly expectedVersion?: number;
}

export interface BulkDocumentsCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly documents: readonly BulkDocumentSelection[];
  readonly tenantId?: string;
  readonly metadata?: DocumentData;
}

export interface BulkDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface BulkDocumentCommandEntry {
  readonly name: string;
  readonly snapshot: DocumentSnapshot;
}

export interface BulkDocumentCommandFailure {
  readonly name: string;
  readonly code: FrameworkErrorCode | "UNKNOWN";
  readonly message: string;
  readonly status: number;
}

export interface BulkDocumentCommandResult {
  readonly succeeded: readonly BulkDocumentCommandEntry[];
  readonly failed: readonly BulkDocumentCommandFailure[];
}

export interface BulkDeleteDocumentSelection extends BulkDocumentSelection {}

export interface BulkDeleteDocumentsCommand extends BulkDocumentsCommand {}

export interface BulkDeletedDocument extends BulkDocumentCommandEntry {}

export interface BulkDeleteDocumentFailure extends BulkDocumentCommandFailure {}

export interface BulkDeleteDocumentsResult {
  readonly deleted: readonly BulkDeletedDocument[];
  readonly failed: readonly BulkDeleteDocumentFailure[];
}

export interface BulkSubmitDocumentsCommand extends BulkDocumentsCommand {}

export interface BulkCancelDocumentsCommand extends BulkDocumentsCommand {}

export interface BulkTransitionDocumentsCommand extends BulkDocumentsCommand {
  readonly workflow: string;
  readonly action: string;
}

export interface SubmitDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface CancelDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface TransitionDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly workflow: string;
  readonly action: string;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface ExecuteDomainCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly command: string;
  readonly input: MutableDocumentData;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface AddDocumentCommentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly text: string;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface RecordDocumentActivityCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly activityType?: string;
  readonly subject: string;
  readonly detail?: string;
  readonly channel?: string;
  readonly externalId?: string;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface AssignDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly assignee: string;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface UnassignDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly assignee: string;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface TagDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly tag: string;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface UntagDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly tag: string;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface FollowDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly follower?: string;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface UnfollowDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly follower?: string;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface ShareDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly userId: string;
  readonly permissions: readonly string[];
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface RevokeDocumentShareCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly userId: string;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface DocumentCommandExecutor {
  create(command: CreateDocumentCommand): Promise<DocumentSnapshot>;
  duplicate(command: DuplicateDocumentCommand): Promise<DocumentSnapshot>;
  amend(command: AmendDocumentCommand): Promise<DocumentSnapshot>;
  update(command: UpdateDocumentCommand): Promise<DocumentSnapshot>;
  merge(command: MergeDocumentCommand): Promise<MergeDocumentResult>;
  submit(command: SubmitDocumentCommand): Promise<DocumentSnapshot>;
  bulkSubmit(command: BulkSubmitDocumentsCommand): Promise<BulkDocumentCommandResult>;
  cancel(command: CancelDocumentCommand): Promise<DocumentSnapshot>;
  bulkCancel(command: BulkCancelDocumentsCommand): Promise<BulkDocumentCommandResult>;
  delete(command: DeleteDocumentCommand): Promise<DocumentSnapshot>;
  bulkDelete(command: BulkDeleteDocumentsCommand): Promise<BulkDeleteDocumentsResult>;
  transition(command: TransitionDocumentCommand): Promise<DocumentSnapshot>;
  bulkTransition(command: BulkTransitionDocumentsCommand): Promise<BulkDocumentCommandResult>;
  execute(command: ExecuteDomainCommand): Promise<DocumentSnapshot>;
  comment(command: AddDocumentCommentCommand): Promise<DocumentSnapshot>;
  recordActivity(command: RecordDocumentActivityCommand): Promise<DocumentSnapshot>;
  assign(command: AssignDocumentCommand): Promise<DocumentSnapshot>;
  unassign(command: UnassignDocumentCommand): Promise<DocumentSnapshot>;
  tag(command: TagDocumentCommand): Promise<DocumentSnapshot>;
  untag(command: UntagDocumentCommand): Promise<DocumentSnapshot>;
  follow(command: FollowDocumentCommand): Promise<DocumentSnapshot>;
  unfollow(command: UnfollowDocumentCommand): Promise<DocumentSnapshot>;
  share(command: ShareDocumentCommand): Promise<DocumentSnapshot>;
  revokeShare(command: RevokeDocumentShareCommand): Promise<DocumentSnapshot>;
}

export class DocumentService implements DocumentCommandExecutor {
  private readonly registry: ModelRegistry;
  private readonly store: DocumentStore;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly doctypeResolver: DocumentServiceDocTypeResolver | undefined;
  private readonly userPermissions: UserPermissionProvider | undefined;
  private readonly documentShares: DocumentShareProvider | undefined;
  private readonly automationRuns: AutomationRunPlanner;
  private readonly onHookError: ((error: unknown, event: DomainEvent) => void | Promise<void>) | undefined;
  private readonly afterCommit: ((context: AfterCommitContext) => void | Promise<void>) | undefined;

  constructor(options: DocumentServiceOptions) {
    this.registry = options.registry;
    this.store = options.store;
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.doctypeResolver = options.doctypeResolver;
    this.userPermissions = options.userPermissions;
    this.documentShares = options.documentShares;
    this.automationRuns = options.automationRuns ?? new AutomationRunPlanner({ ids: this.ids });
    this.onHookError = options.onHookError;
    this.afterCommit = options.afterCommit;
  }

  async create(command: CreateDocumentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    this.ensureDocTypeActionAccess(command.actor, doctype, "create");
    ensureCreateNameAllowed(doctype, command.name);
    ensureGeneratedNamingFieldNotSupplied(doctype, command.data);

    const now = this.clock.now();
    const withDefaults = applyDefaults(doctype, command.data, { actor: command.actor, now });
    const withValidatedHooks = await this.runBeforeValidate(doctype, withDefaults);
    const withFetchedFields = await this.applyFetchedFields(
      command.actor,
      tenantId,
      doctype,
      withValidatedHooks,
      relatedDocType
    );
    const preparedData = stripInternalTableFields(
      doctype,
      withFetchedFields,
      relatedDocType
    );
    const userSuppliedData = stripInternalTableFields(
      doctype,
      compactData(command.data),
      relatedDocType
    );
    let occupiedNamingCurrent: number | undefined;
    let remainingNamingAttempts = doctype.naming?.kind === "series"
      ? doctype.naming.maxAttempts ?? DEFAULT_NAMING_MAX_ATTEMPTS
      : 1;
    while (remainingNamingAttempts > 0) {
      const nameResolution = command.name === undefined
        ? await this.resolveName(doctype, preparedData, {
            actor: command.actor,
            tenantId,
            now,
            maxCandidateAttempts: remainingNamingAttempts,
            ...(occupiedNamingCurrent === undefined ? {} : { occupiedNamingCurrent })
          })
        : { name: command.name, data: preparedData };
      if (nameResolution.namingSeriesWrite !== undefined) {
        remainingNamingAttempts -= nameResolution.namingSeriesWrite.candidateAttempts;
      } else {
        remainingNamingAttempts = 0;
      }
      const name = nameResolution.name;
      const data = nameResolution.data;
      const draft = draftDocumentSnapshot({
        tenantId,
        doctype,
        name,
        version: 0,
        data,
        now
      });
      const issues = documentCreateValidationIssues({
        workflowStateIssues: workflowStateCreateIssues(doctype, data),
        fieldPermissionIssues: fieldPermissionIssues({
          actor: command.actor,
          action: "create",
          doctype,
          data: userSuppliedData,
          relatedDocType,
          document: draft
        }),
        validationIssues: await this.validate(doctype, data, relatedDocType),
        linkIssues: await this.validateLinks(command.actor, tenantId, doctype, data, relatedDocType)
      });
      if (issues.length > 0) {
        throw validationFailed(issues);
      }
      const stream = documentStream(tenantId, doctype.name, name);
      const existing = foldDocument(await this.store.readStream(stream));
      try {
        ensureDocumentCreateAvailable({ doctypeName: doctype.name, documentName: name, existing });
      } catch (error) {
        if (
          nameResolution.namingSeriesWrite !== undefined &&
          isDocumentConflictError(error) &&
          remainingNamingAttempts > 0
        ) {
          occupiedNamingCurrent = nameResolution.namingSeriesWrite.next;
          continue;
        }
        throw error;
      }
      const uniqueReservations = uniqueValueReservations(tenantId, doctype, data, name);
      const uniqueReservationWrites = await this.planUniqueValueReservationWrites(
        command.actor,
        uniqueReservations,
        now
      );
      const plan = planDocumentCreatePolicy({
        doctype,
        data,
        eventType: command.eventType
      });
      const event = this.newEvent(documentCreateEventCommand({
        tenantId,
        stream,
        doctypeName: doctype.name,
        documentName: name,
        actorId: command.actor.id,
        occurredAt: now,
        plan,
        metadata: command.metadata ?? {}
      }));
      const after = {
        tenantId,
        doctype: doctype.name,
        name,
        version: 1,
        docstatus: plan.docstatus,
        data,
        createdAt: now,
        updatedAt: now
      } satisfies DocumentSnapshot;
      const automationPlan = this.planAutomationRuns({
        doctype,
        event,
        before: null,
        after,
        touchedFields: Object.keys(data),
        input: userSuppliedData,
        actor: command.actor
      });
      try {
        const commit = await this.store.commitBatch(
          [
            ...documentAtomicCommitEntries({
              ...(nameResolution.namingSeriesWrite === undefined
                ? {}
                : { namingSeriesWrite: nameResolution.namingSeriesWrite }),
              uniqueReservationWrites,
              document: { stream, expectedVersion: 0, event }
            }),
            ...automationPlan.entries
          ],
          (savedEvents) => {
            const saved = requireSavedEvent(savedEvents, event.id);
            return {
              snapshot: snapshotFromDocumentCreatedEvent(saved),
              auxiliarySnapshots: [
                ...documentAtomicAuxiliarySnapshots({
                  savedEvents,
                  ...(nameResolution.namingSeriesWrite === undefined
                    ? {}
                    : { namingSeriesWrite: nameResolution.namingSeriesWrite }),
                  uniqueReservationWrites
                }),
                ...automationPlan.auxiliarySnapshots(savedEvents)
              ]
            };
          }
        );
        return this.finishAfterCommit(command.actor, doctype, commit, requireSavedEvent(commit.events, event.id), relatedDocType);
      } catch (error) {
        const namingConflict = await this.namingConflictDisposition({
          error,
          doctype,
          tenantId,
          documentName: name,
          nameResolution
        });
        if (namingConflict !== null && remainingNamingAttempts > 0) {
          if (namingConflict === "document") {
            occupiedNamingCurrent = nameResolution.namingSeriesWrite!.next;
          }
          continue;
        }
        throw error;
      }
    }
    throw conflict(`Could not allocate naming series for ${doctype.name}`);
  }

  async update(command: UpdateDocumentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    await this.ensureSharedDocumentActionAccess(command.actor, doctype, "update", existing);
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    return this.applyDocumentUpdate({
      action: "update",
      command,
      doctype,
      existing,
      patch: command.patch,
      relatedDocType,
      stream,
      tenantId,
      ...(command.unset === undefined ? {} : { unset: command.unset })
    });
  }

  async merge(command: MergeDocumentCommand): Promise<MergeDocumentResult> {
    ensureMergeBaseVersion(command.baseVersion);
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const { snapshot: existing, events } = await this.requireExistingEventStream(stream, doctype, command.name);
    await this.ensureSharedDocumentActionAccess(command.actor, doctype, "update", existing);
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);

    const base = requireMergeBaseSnapshot({
      base: foldDocument(events.filter((event) => event.sequence <= command.baseVersion)),
      baseVersion: command.baseVersion,
      doctypeName: doctype.name,
      documentName: command.name
    });

    const patch = await this.runBeforeValidate(doctype, compactData(command.patch), existing);
    const patchWithoutInternalFields = stripInternalTableFields(doctype, patch, relatedDocType);
    const normalizedPatch = preserveReadOnlyTableValues(doctype, patch, existing, relatedDocType);
    const unset = normalizeUnsetFields(command.unset);
    const preflightDraft = {
      ...existing,
      data: applyDocumentDataChange(existing.data, normalizedPatch, unset),
      version: existing.version + 1
    };
    const fieldAccessIssues = fieldPermissionIssues({
      actor: command.actor,
      action: "update",
      doctype,
      data: patchWithoutInternalFields,
      relatedDocType,
      document: preflightDraft,
      unset
    });
    if (fieldAccessIssues.length > 0) {
      throw validationFailed(fieldAccessIssues);
    }
    const draft = applyDocumentDataChange(base.data, normalizedPatch, unset);
    const plan = planDocumentFieldMerge({
      base: mergeSnapshotFromDocument(base),
      remote: mergeSnapshotFromDocument(existing),
      draft
    });
    const responsePlan = projectDocumentMergePlanForFieldAccess({
      actor: command.actor,
      doctype,
      document: existing,
      plan,
      relatedDocType
    });
    const disposition = documentMergeDisposition(plan);
    if (disposition === "conflict") {
      return {
        status: "conflict",
        plan: responsePlan,
        document: await this.redactDocumentForActor(command.actor, doctype, existing, relatedDocType)
      };
    }
    if (disposition === "noop") {
      return {
        status: "noop",
        plan: responsePlan,
        document: await this.redactDocumentForActor(command.actor, doctype, existing, relatedDocType)
      };
    }

    const document = await this.applyDocumentUpdate({
      action: "merge",
      command,
      doctype,
      existing,
      patch: plan.patch,
      prevalidatedPatch: compactData(plan.patch),
      relatedDocType,
      stream,
      tenantId,
      unset: plan.unset
    });
    return { status: "applied", plan: responsePlan, document };
  }

  private async applyDocumentUpdate(options: {
    readonly action: "update" | "merge";
    readonly command: UpdateDocumentCommand | MergeDocumentCommand;
    readonly doctype: DocTypeDefinition;
    readonly existing: DocumentSnapshot;
    readonly patch: MutableDocumentData;
    readonly prevalidatedPatch?: DocumentData;
    readonly relatedDocType: RelatedDocTypeResolver;
    readonly stream: string;
    readonly tenantId: string;
    readonly unset?: readonly string[];
  }): Promise<DocumentSnapshot> {
    ensureDocumentUpdateStatus(options.existing, options.action);

    const patch = options.prevalidatedPatch ??
      await this.runBeforeValidate(options.doctype, compactData(options.patch), options.existing);
    const patchWithoutInternalFields = stripInternalTableFields(options.doctype, patch, options.relatedDocType);
    const patchWithFetchedFields = await this.applyFetchedFields(
      options.command.actor,
      options.tenantId,
      options.doctype,
      patch,
      options.relatedDocType,
      { existing: options.existing }
    );
    const fetchedPatchWithoutInternalFields = stripInternalTableFields(
      options.doctype,
      patchWithFetchedFields,
      options.relatedDocType
    );
    const unset = normalizeUnsetFields(options.unset);
    const submittedUpdateIssues = options.existing.docstatus === "submitted"
      ? allowOnSubmitIssues(options.doctype, fetchedPatchWithoutInternalFields, unset)
      : [];
    const unsetIssues = documentUnsetIssues(
      options.doctype,
      unset,
      options.existing.data,
      fetchedPatchWithoutInternalFields
    );
    const originIssues = childTableOriginIssues(
      options.doctype,
      patchWithFetchedFields,
      options.existing.data,
      options.relatedDocType
    );
    const normalizedPatch = preserveReadOnlyTableValues(
      options.doctype,
      patchWithFetchedFields,
      options.existing,
      options.relatedDocType
    );
    const data = applyDocumentDataChange(options.existing.data, normalizedPatch, unset);
    const draft = {
      ...options.existing,
      data,
      version: options.existing.version + 1
    };
    const readOnlyIssues = readonlyIssues(
      options.doctype,
      patchWithoutInternalFields,
      options.relatedDocType,
      data,
      unset
    );
    const fieldAccessIssues = fieldPermissionIssues({
      actor: options.command.actor,
      action: "update",
      doctype: options.doctype,
      data: patchWithoutInternalFields,
      relatedDocType: options.relatedDocType,
      document: draft,
      unset
    });
    const validationIssues = await this.validate(
      options.doctype,
      normalizedPatch,
      options.relatedDocType,
      options.existing,
      data
    );
    const linkIssues = await this.validateLinks(
      options.command.actor,
      options.tenantId,
      options.doctype,
      normalizedPatch,
      options.relatedDocType
    );
    const issues = documentUpdateValidationIssues({
      submittedUpdateIssues,
      unsetIssues,
      originIssues,
      workflowStateIssues: workflowStateMutationIssues(options.doctype, fetchedPatchWithoutInternalFields, unset),
      generatedNamingIssues: generatedNamingFieldMutationIssues(
        options.doctype,
        [...Object.keys(normalizedPatch), ...unset]
      ),
      readOnlyIssues,
      fieldPermissionIssues: fieldAccessIssues,
      validationIssues,
      linkIssues
    });
    if (issues.length > 0) {
      throw validationFailed(issues);
    }

    const now = this.clock.now();
    const nextReservations = uniqueValueReservations(
      options.tenantId,
      options.doctype,
      data,
      options.existing.name
    );
    const existingReservations = uniqueValueReservations(
      options.tenantId,
      options.doctype,
      options.existing.data,
      options.existing.name
    );
    const releasedReservations = releasedUniqueValueReservations(existingReservations, nextReservations);
    const uniqueReservationWrites = await this.planUniqueValueReservationWrites(
      options.command.actor,
      nextReservations,
      now
    );
    const uniqueReleaseWrites = await this.planUniqueValueReleaseWrites(
      options.command.actor,
      releasedReservations,
      now
    );
    const plan = planDocumentUpdatePolicy({
      doctype: options.doctype,
      patch: normalizedPatch,
      unset,
      eventType: options.command.eventType
    });
    const event = this.newEvent(documentUpdateEventCommand({
      tenantId: options.tenantId,
      stream: options.stream,
      doctypeName: options.doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      plan,
      metadata: options.command.metadata ?? {}
    }));
    const after = {
      ...options.existing,
      version: options.existing.version + 1,
      data,
      updatedAt: now
    } satisfies DocumentSnapshot;
    const automationPlan = this.planAutomationRuns({
      doctype: options.doctype,
      event,
      before: options.existing,
      after,
      touchedFields: [...Object.keys(options.command.patch), ...unset],
      input: patchWithoutInternalFields,
      actor: options.command.actor
    });
    const commit = await this.store.commitBatch(
      [
        ...documentAtomicCommitEntries({
          uniqueReservationWrites,
          uniqueReleaseWrites,
          document: { stream: options.stream, expectedVersion: options.existing.version, event }
        }),
        ...automationPlan.entries
      ],
      (savedEvents) => {
        const saved = requireSavedEvent(savedEvents, event.id);
        return {
          snapshot: snapshotFromCommittedDocumentEvent(options.existing, saved, { data }),
          auxiliarySnapshots: [
            ...documentAtomicAuxiliarySnapshots({
              savedEvents,
              uniqueReservationWrites,
              uniqueReleaseWrites
            }),
            ...automationPlan.auxiliarySnapshots(savedEvents)
          ]
        };
      }
    );
    const saved = requireSavedEvent(commit.events, event.id);
    return this.finishAfterCommit(options.command.actor, options.doctype, commit, saved, options.relatedDocType);
  }

  async duplicate(command: DuplicateDocumentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    await this.ensureSharedDocumentActionAccess(command.actor, doctype, "read", existing, "duplicate");
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    const readableExisting = await this.redactDocumentForActor(command.actor, doctype, existing, relatedDocType);
    const plan = planDocumentCopyPolicy({
      action: "duplicate",
      doctype,
      existing: readableExisting,
      data: command.data,
      metadata: command.metadata,
      relatedDocType
    });
    return this.create({
      actor: command.actor,
      doctype: doctype.name,
      data: withoutGeneratedNamingField(doctype, plan.data),
      ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
      ...(command.newName === undefined ? {} : { name: command.newName }),
      ...(command.eventType === undefined ? {} : { eventType: command.eventType }),
      metadata: plan.metadata
    });
  }

  async amend(command: AmendDocumentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    await this.ensureSharedDocumentActionAccess(command.actor, doctype, "read", existing, "amend");
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    ensureDocumentStatus(existing, ["cancelled"], "amend");
    const readableExisting = await this.redactDocumentForActor(command.actor, doctype, existing, relatedDocType);
    const plan = planDocumentCopyPolicy({
      action: "amend",
      doctype,
      existing: readableExisting,
      data: command.data,
      metadata: command.metadata,
      relatedDocType
    });
    return this.create({
      actor: command.actor,
      doctype: doctype.name,
      data: withoutGeneratedNamingField(doctype, plan.data),
      ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
      ...(command.newName === undefined ? {} : { name: command.newName }),
      ...(command.eventType === undefined ? {} : { eventType: command.eventType }),
      metadata: plan.metadata
    });
  }

  async transition(command: TransitionDocumentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    const workflow = requireNamedWorkflowDefinition(doctype, command.workflow);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    this.ensureDocumentActionAccess(command.actor, doctype, "transition", existing);
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    ensureDocumentStatus(existing, ["draft"], "transition");

    const plan = planWorkflowTransitionPolicy({
      actor: command.actor,
      action: command.action,
      doctypeName: doctype.name,
      document: existing,
      workflow,
      input: { workflow: command.workflow, action: command.action }
    });
    const hookPatch = await this.runBeforeValidate(doctype, plan.patch, existing);
    const authorizedPatch = { ...hookPatch, [plan.stateField]: plan.to };
    const patchWithoutInternalFields = stripInternalTableFields(doctype, authorizedPatch, relatedDocType);
    const patchWithFetchedFields = await this.applyFetchedFields(
      command.actor,
      tenantId,
      doctype,
      authorizedPatch,
      relatedDocType,
      { existing }
    );
    const fetchedPatchWithoutInternalFields = stripInternalTableFields(doctype, patchWithFetchedFields, relatedDocType);
    const exactPatch = { ...patchWithFetchedFields, [plan.stateField]: plan.to };
    const originIssues = childTableOriginIssues(doctype, exactPatch, existing.data, relatedDocType);
    const normalizedPatch = preserveReadOnlyTableValues(doctype, exactPatch, existing, relatedDocType);
    const data = applyDocumentDataChange(existing.data, normalizedPatch, []);
    const draft = {
      ...existing,
      data,
      version: existing.version + 1
    };
    const actorControlledPatch = Object.fromEntries(
      Object.entries(patchWithoutInternalFields).filter(([field]) => field !== plan.stateField)
    ) as DocumentData;
    const readOnlyIssues = readonlyIssues(doctype, actorControlledPatch, relatedDocType, data);
    const fieldAccessIssues = fieldPermissionIssues({
      actor: command.actor,
      action: "update",
      doctype,
      data: actorControlledPatch,
      relatedDocType,
      document: draft
    });
    const validationIssues = await this.validate(doctype, normalizedPatch, relatedDocType, existing, data);
    const linkIssues = await this.validateLinks(command.actor, tenantId, doctype, normalizedPatch, relatedDocType);
    const issues = documentDomainCommandValidationIssues({
      originIssues,
      workflowStateIssues: workflowStateMutationIssues(
        doctype,
        fetchedPatchWithoutInternalFields,
        [],
        { [plan.stateField]: plan.to }
      ),
      generatedNamingIssues: generatedNamingFieldMutationIssues(doctype, Object.keys(normalizedPatch)),
      readOnlyIssues,
      fieldPermissionIssues: fieldAccessIssues,
      validationIssues,
      linkIssues
    });
    if (issues.length > 0) {
      throw validationFailed(issues);
    }

    const now = this.clock.now();
    const nextReservations = uniqueValueReservations(tenantId, doctype, data, existing.name);
    const existingReservations = uniqueValueReservations(tenantId, doctype, existing.data, existing.name);
    const releasedReservations = releasedUniqueValueReservations(existingReservations, nextReservations);
    const uniqueReservationWrites = await this.planUniqueValueReservationWrites(
      command.actor,
      nextReservations,
      now
    );
    const uniqueReleaseWrites = await this.planUniqueValueReleaseWrites(
      command.actor,
      releasedReservations,
      now
    );
    const event = this.newEvent(workflowTransitionEventCommand({
      tenantId,
      stream,
      doctypeName: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      action: command.action,
      plan: { ...plan, patch: normalizedPatch },
      metadata: command.metadata ?? {}
    }));
    const after = {
      ...existing,
      version: existing.version + 1,
      data,
      updatedAt: now
    } satisfies DocumentSnapshot;
    const automationPlan = this.planAutomationRuns({
      doctype,
      event,
      before: existing,
      after,
      touchedFields: Object.keys(normalizedPatch),
      input: { workflow: command.workflow, action: command.action },
      actor: command.actor
    });
    const commit = await this.store.commitBatch(
      [
        ...documentAtomicCommitEntries({
          uniqueReservationWrites,
          uniqueReleaseWrites,
          document: { stream, expectedVersion: existing.version, event }
        }),
        ...automationPlan.entries
      ],
      (savedEvents) => {
        const saved = requireSavedEvent(savedEvents, event.id);
        return {
          snapshot: snapshotFromCommittedDocumentEvent(existing, saved, { data }),
          auxiliarySnapshots: [
            ...documentAtomicAuxiliarySnapshots({
              savedEvents,
              uniqueReservationWrites,
              uniqueReleaseWrites
            }),
            ...automationPlan.auxiliarySnapshots(savedEvents)
          ]
        };
      }
    );
    return this.finishAfterCommit(command.actor, doctype, commit, requireSavedEvent(commit.events, event.id), relatedDocType);
  }

  async execute(command: ExecuteDomainCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    const commandDefinition = requireDomainCommandDefinition(doctype, command.command);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    const now = this.clock.now();
    const commandPlan = planDomainCommandPolicy({
      actor: command.actor,
      definition: commandDefinition,
      document: existing,
      input: command.input,
      now
    });
    await this.ensureSharedDocumentActionAccess(
      command.actor,
      doctype,
      commandPlan.permissionAction,
      existing,
      `execute ${command.command} on`
    );
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureDomainCommandRoleAccess(command.actor, commandDefinition, command.command);
    ensureExpectedVersion(existing, command.expectedVersion);
    ensureDocumentStatus(existing, ["draft"], `execute ${command.command}`);

    const sanitizedInput = stripInternalTableFields(doctype, commandPlan.input, relatedDocType);
    const normalizedPatch = await this.runBeforeValidate(doctype, commandPlan.patch, existing);
    const transitionPlan = planDomainCommandTransitions({
      actor: command.actor,
      doctype,
      document: existing,
      patch: normalizedPatch,
      transitions: commandPlan.transitions,
      commandInput: sanitizedInput
    });
    const patchWithoutInternalFields = stripInternalTableFields(doctype, transitionPlan.patch, relatedDocType);
    const patchWithFetchedFields = await this.applyFetchedFields(
      command.actor,
      tenantId,
      doctype,
      transitionPlan.patch,
      relatedDocType,
      { existing }
    );
    const fetchedPatchWithoutInternalFields = stripInternalTableFields(doctype, patchWithFetchedFields, relatedDocType);
    const originIssues = childTableOriginIssues(doctype, patchWithFetchedFields, existing.data, relatedDocType);
    const patchWithReadOnlyValues = preserveReadOnlyTableValues(
      doctype,
      patchWithFetchedFields,
      existing,
      relatedDocType
    );
    const data = applyDocumentDataChange(existing.data, patchWithReadOnlyValues, []);
    const draft = {
      ...existing,
      data,
      version: existing.version + 1
    };
    const readOnlyIssues = commandPlan.allowReadOnlyFields
      ? []
      : readonlyIssues(doctype, patchWithoutInternalFields, relatedDocType, data);
    const fieldAccessIssues = commandPlan.bypassFieldPermissions && command.actor.roles.includes(SYSTEM_MANAGER_ROLE)
      ? []
      : fieldPermissionIssues({
          actor: command.actor,
          action: "update",
          doctype,
          data: patchWithoutInternalFields,
          relatedDocType,
          document: draft
        });
    const validationIssues = await this.validate(doctype, patchWithReadOnlyValues, relatedDocType, existing);
    const linkIssues = await this.validateLinks(command.actor, tenantId, doctype, patchWithReadOnlyValues, relatedDocType);
    const issues = documentDomainCommandValidationIssues({
      originIssues,
      workflowStateIssues: workflowStateMutationIssues(
        doctype,
        fetchedPatchWithoutInternalFields,
        [],
        Object.fromEntries(transitionPlan.transitions.map((transition) => [transition.stateField, transition.to]))
      ),
      generatedNamingIssues: generatedNamingFieldMutationIssues(doctype, Object.keys(patchWithReadOnlyValues)),
      readOnlyIssues,
      fieldPermissionIssues: fieldAccessIssues,
      validationIssues,
      linkIssues
    });
    if (issues.length > 0) {
      throw validationFailed(issues);
    }

    const nextReservations = uniqueValueReservations(tenantId, doctype, data, existing.name);
    const existingReservations = uniqueValueReservations(tenantId, doctype, existing.data, existing.name);
    const releasedReservations = releasedUniqueValueReservations(existingReservations, nextReservations);
    const uniqueReservationWrites = await this.planUniqueValueReservationWrites(
      command.actor,
      nextReservations,
      now
    );
    const uniqueReleaseWrites = await this.planUniqueValueReleaseWrites(
      command.actor,
      releasedReservations,
      now
    );
    const event = this.newEvent(domainCommandEventCommand({
      tenantId,
      stream,
      doctypeName: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      eventType: commandDefinition.eventType,
      commandName: command.command,
      commandInput: sanitizedInput,
      patch: patchWithReadOnlyValues,
      transitions: transitionPlan.transitions,
      metadata: command.metadata ?? {}
    }));
    const after = {
      ...existing,
      version: existing.version + 1,
      data,
      updatedAt: now
    } satisfies DocumentSnapshot;
    const automationPlan = this.planAutomationRuns({
      doctype,
      event,
      before: existing,
      after,
      touchedFields: Object.keys(patchWithReadOnlyValues),
      input: sanitizedInput,
      actor: command.actor
    });
    const commit = await this.store.commitBatch(
      [
        ...documentAtomicCommitEntries({
          uniqueReservationWrites,
          uniqueReleaseWrites,
          document: { stream, expectedVersion: existing.version, event }
        }),
        ...automationPlan.entries
      ],
      (savedEvents) => {
        const saved = requireSavedEvent(savedEvents, event.id);
        return {
          snapshot: snapshotFromCommittedDocumentEvent(existing, saved, { data }),
          auxiliarySnapshots: [
            ...documentAtomicAuxiliarySnapshots({
              savedEvents,
              uniqueReservationWrites,
              uniqueReleaseWrites
            }),
            ...automationPlan.auxiliarySnapshots(savedEvents)
          ]
        };
      }
    );
    return this.finishAfterCommit(
      command.actor,
      doctype,
      commit,
      requireSavedEvent(commit.events, event.id),
      relatedDocType
    );
  }

  async comment(command: AddDocumentCommentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    this.ensureDocumentActionAccess(command.actor, doctype, "comment", existing, "comment on");
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    const plan = planDocumentCommentPolicy(doctype, command.text);
    const now = this.clock.now();
    const event = this.newEvent(documentCollaborationEventCommand({
      tenantId,
      stream,
      doctypeName: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      plan,
      metadata: command.metadata ?? {}
    }));
    return this.commitDocumentEvent(command.actor, doctype, existing, stream, event, relatedDocType);
  }

  async recordActivity(command: RecordDocumentActivityCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    this.ensureDocumentActionAccess(command.actor, doctype, "activity", existing, "record activity on");
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    const plan = planDocumentActivityPolicy(doctype, command);
    const now = this.clock.now();
    const event = this.newEvent(documentCollaborationEventCommand({
      tenantId,
      stream,
      doctypeName: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      plan,
      metadata: command.metadata ?? {}
    }));
    return this.commitDocumentEvent(command.actor, doctype, existing, stream, event, relatedDocType);
  }

  async assign(command: AssignDocumentCommand): Promise<DocumentSnapshot> {
    return this.changeAssignment({
      command,
      action: "add"
    });
  }

  async unassign(command: UnassignDocumentCommand): Promise<DocumentSnapshot> {
    return this.changeAssignment({
      command,
      action: "remove"
    });
  }

  async tag(command: TagDocumentCommand): Promise<DocumentSnapshot> {
    return this.changeTag({
      command,
      action: "add"
    });
  }

  async untag(command: UntagDocumentCommand): Promise<DocumentSnapshot> {
    return this.changeTag({
      command,
      action: "remove"
    });
  }

  async follow(command: FollowDocumentCommand): Promise<DocumentSnapshot> {
    return this.changeFollower({
      command,
      action: "add"
    });
  }

  async unfollow(command: UnfollowDocumentCommand): Promise<DocumentSnapshot> {
    return this.changeFollower({
      command,
      action: "remove"
    });
  }

  async share(command: ShareDocumentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const { snapshot: existing, events } = await this.requireExistingEventStream(stream, doctype, command.name);
    const access = await this.ensureSharedDocumentActionAccess(command.actor, doctype, "share", existing);
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    const state = documentShareStateFromEvents({
      tenantId,
      doctype: doctype.name,
      name: command.name,
      events
    });
    const plan = planDocumentSharePolicy({
      doctype,
      currentGrants: state.grants,
      command
    });
    ensureSharedGrantDelegabilityForLookup({
      lookupStatus: access.lookup.status,
      actor: command.actor,
      doctype,
      document: existing,
      actorPermissions: access.sharedPermissions,
      grant: plan.grant
    });
    if (documentCollaborationPlanDisposition(plan) === "noop") {
      return this.redactDocumentForActor(command.actor, doctype, existing, relatedDocType);
    }
    const now = this.clock.now();
    const event = this.newEvent(documentCollaborationEventCommand({
      tenantId,
      stream,
      doctypeName: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      plan,
      metadata: command.metadata ?? {}
    }));
    return this.commitDocumentEvent(command.actor, doctype, existing, stream, event, relatedDocType);
  }

  async revokeShare(command: RevokeDocumentShareCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const { snapshot: existing, events } = await this.requireExistingEventStream(stream, doctype, command.name);
    await this.ensureSharedDocumentActionAccess(command.actor, doctype, "share", existing, "revoke shares for");
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    const state = documentShareStateFromEvents({
      tenantId,
      doctype: doctype.name,
      name: command.name,
      events
    });
    const plan = planDocumentShareRevocationPolicy({
      doctype,
      currentGrants: state.grants,
      userId: command.userId
    });
    if (documentCollaborationPlanDisposition(plan) === "noop") {
      return this.redactDocumentForActor(command.actor, doctype, existing, relatedDocType);
    }
    const now = this.clock.now();
    const event = this.newEvent(documentCollaborationEventCommand({
      tenantId,
      stream,
      doctypeName: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      plan,
      metadata: command.metadata ?? {}
    }));
    return this.commitDocumentEvent(command.actor, doctype, existing, stream, event, relatedDocType);
  }

  async delete(command: DeleteDocumentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    this.ensureDocumentActionAccess(command.actor, doctype, "delete", existing);
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    const plan = planDocumentDeletePolicy(doctype);
    ensureDocumentStatus(existing, plan.allowedStatus, "delete");

    const now = this.clock.now();
    const uniqueReservations = uniqueValueReservations(tenantId, doctype, existing.data, existing.name);
    const uniqueReleaseWrites = await this.planUniqueValueReleaseWrites(command.actor, uniqueReservations, now);
    const event = this.newEvent(documentDeleteEventCommand({
      tenantId,
      stream,
      doctypeName: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      plan,
      metadata: command.metadata ?? {}
    }));
    const commit = await this.store.commitBatch(
      documentAtomicCommitEntries({
        uniqueReleaseWrites,
        document: { stream, expectedVersion: existing.version, event }
      }),
      (savedEvents) => {
        const saved = requireSavedEvent(savedEvents, event.id);
        return {
          snapshot: snapshotFromCommittedDocumentEvent(existing, saved, { docstatus: plan.nextStatus }),
          auxiliarySnapshots: documentAtomicAuxiliarySnapshots({ savedEvents, uniqueReleaseWrites })
        };
      }
    );
    const saved = requireSavedEvent(commit.events, event.id);
    return this.finishAfterCommit(command.actor, doctype, commit, saved, relatedDocType);
  }

  async bulkDelete(command: BulkDeleteDocumentsCommand): Promise<BulkDeleteDocumentsResult> {
    const result = await this.runBulkDocumentCommand(command, (selection) => this.delete(bulkNamedCommand(command, selection)));
    return { deleted: result.succeeded, failed: result.failed };
  }

  async bulkSubmit(command: BulkSubmitDocumentsCommand): Promise<BulkDocumentCommandResult> {
    return this.runBulkDocumentCommand(command, (selection) => this.submit(bulkNamedCommand(command, selection)));
  }

  async bulkCancel(command: BulkCancelDocumentsCommand): Promise<BulkDocumentCommandResult> {
    return this.runBulkDocumentCommand(command, (selection) => this.cancel(bulkNamedCommand(command, selection)));
  }

  async bulkTransition(command: BulkTransitionDocumentsCommand): Promise<BulkDocumentCommandResult> {
    return this.runBulkDocumentCommand(command, (selection) =>
      this.transition({
        ...bulkNamedCommand(command, selection),
        workflow: command.workflow,
        action: command.action
      })
    );
  }

  async submit(command: SubmitDocumentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    this.ensureDocumentActionAccess(command.actor, doctype, "submit", existing);
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    const plan = planDocumentStatusChangePolicy(doctype, "submit");
    ensureDocumentStatus(existing, plan.allowedStatus, "submit");
    return this.changeDocStatus({
      command,
      doctype,
      tenantId,
      stream,
      existing,
      plan,
      relatedDocType
    });
  }

  async cancel(command: CancelDocumentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    this.ensureDocumentActionAccess(command.actor, doctype, "cancel", existing);
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    const plan = planDocumentStatusChangePolicy(doctype, "cancel");
    ensureDocumentStatus(existing, plan.allowedStatus, "cancel");
    return this.changeDocStatus({
      command,
      doctype,
      tenantId,
      stream,
      existing,
      plan,
      relatedDocType
    });
  }

  private async runBulkDocumentCommand(
    command: BulkDocumentsCommand,
    run: (selection: BulkDocumentSelection) => Promise<DocumentSnapshot>
  ): Promise<BulkDocumentCommandResult> {
    return runBulkDocumentSelections(command, async (selection) => {
      try {
        return { ok: true, snapshot: await run(selection) };
      } catch (error) {
        return { ok: false, failure: bulkDocumentFailure(selection.name, error) };
      }
    });
  }

  private async requireExistingFromEvents(
    stream: string,
    doctype: DocTypeDefinition,
    name: string
  ): Promise<DocumentSnapshot> {
    return (await this.requireExistingEventStream(stream, doctype, name)).snapshot;
  }

  private async requireExistingEventStream(
    stream: string,
    doctype: DocTypeDefinition,
    name: string
  ): Promise<{ readonly snapshot: DocumentSnapshot; readonly events: readonly DomainEvent[] }> {
    const events = await this.store.readStream(stream);
    return {
      snapshot: requireLiveDocumentSnapshot({
        snapshot: foldDocument(events),
        doctypeName: doctype.name,
        documentName: name
      }),
      events
    };
  }

  private async changeAssignment(options: {
    readonly command: AssignDocumentCommand | UnassignDocumentCommand;
    readonly action: CollaborationCollectionAction;
  }): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(options.command.actor, options.command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(options.command.actor, options.command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, options.command.name);
    const { snapshot: existing, events } = await this.requireExistingEventStream(stream, doctype, options.command.name);
    this.ensureDocumentActionAccess(options.command.actor, doctype, "assign", existing);
    await this.ensureUserPermissionAccess(options.command.actor, doctype, existing);
    ensureExpectedVersion(existing, options.command.expectedVersion);
    const plan = planDocumentAssignmentChangePolicy({
      doctype,
      currentAssignees: foldDocumentAssignments(events),
      assignee: options.command.assignee,
      action: options.action
    });
    if (documentCollaborationPlanDisposition(plan) === "noop") {
      return this.redactDocumentForActor(options.command.actor, doctype, existing, relatedDocType);
    }
    const now = this.clock.now();
    const event = this.newEvent(documentCollaborationEventCommand({
      tenantId,
      stream,
      doctypeName: doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      plan,
      metadata: options.command.metadata ?? {}
    }));
    return this.commitDocumentEvent(options.command.actor, doctype, existing, stream, event, relatedDocType);
  }

  private async changeTag(options: {
    readonly command: TagDocumentCommand | UntagDocumentCommand;
    readonly action: CollaborationCollectionAction;
  }): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(options.command.actor, options.command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(options.command.actor, options.command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, options.command.name);
    const { snapshot: existing, events } = await this.requireExistingEventStream(stream, doctype, options.command.name);
    this.ensureDocumentActionAccess(options.command.actor, doctype, "tag", existing);
    await this.ensureUserPermissionAccess(options.command.actor, doctype, existing);
    ensureExpectedVersion(existing, options.command.expectedVersion);
    const plan = planDocumentTagChangePolicy({
      doctype,
      currentTags: foldDocumentTags(events),
      tag: options.command.tag,
      action: options.action
    });
    if (documentCollaborationPlanDisposition(plan) === "noop") {
      return this.redactDocumentForActor(options.command.actor, doctype, existing, relatedDocType);
    }
    const now = this.clock.now();
    const event = this.newEvent(documentCollaborationEventCommand({
      tenantId,
      stream,
      doctypeName: doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      plan,
      metadata: options.command.metadata ?? {}
    }));
    return this.commitDocumentEvent(options.command.actor, doctype, existing, stream, event, relatedDocType);
  }

  private async changeFollower(options: {
    readonly command: FollowDocumentCommand | UnfollowDocumentCommand;
    readonly action: CollaborationCollectionAction;
  }): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(options.command.actor, options.command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(options.command.actor, options.command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, options.command.name);
    const { snapshot: existing, events } = await this.requireExistingEventStream(stream, doctype, options.command.name);
    this.ensureDocumentActionAccess(options.command.actor, doctype, "follow", existing);
    await this.ensureUserPermissionAccess(options.command.actor, doctype, existing);
    ensureExpectedVersion(existing, options.command.expectedVersion);
    const plan = planDocumentFollowerChangePolicy({
      doctype,
      actor: options.command.actor,
      currentFollowers: foldDocumentFollowers(events),
      follower: options.command.follower,
      action: options.action
    });
    if (documentCollaborationPlanDisposition(plan) === "noop") {
      return this.redactDocumentForActor(options.command.actor, doctype, existing, relatedDocType);
    }
    const now = this.clock.now();
    const event = this.newEvent(documentCollaborationEventCommand({
      tenantId,
      stream,
      doctypeName: doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      plan,
      metadata: options.command.metadata ?? {}
    }));
    return this.commitDocumentEvent(options.command.actor, doctype, existing, stream, event, relatedDocType);
  }

  private async commitDocumentEvent(
    actor: Actor,
    doctype: DocTypeDefinition,
    existing: DocumentSnapshot,
    stream: string,
    event: NewDomainEvent,
    relatedDocType: RelatedDocTypeResolver
  ): Promise<DocumentSnapshot> {
    const commit = await this.store.commit(stream, existing.version, [event], (savedEvents) => {
      const saved = requireFirstSavedEvent(savedEvents);
      return snapshotFromCommittedDocumentEvent(existing, saved);
    });
    return this.finishAfterCommit(actor, doctype, commit, requireFirstSavedEvent(commit.events), relatedDocType);
  }

  private async changeDocStatus(options: {
    readonly command: SubmitDocumentCommand | CancelDocumentCommand;
    readonly doctype: DocTypeDefinition;
    readonly relatedDocType: RelatedDocTypeResolver;
    readonly tenantId: string;
    readonly stream: string;
    readonly existing: DocumentSnapshot;
    readonly plan: DocumentStatusChangePolicyPlan;
  }): Promise<DocumentSnapshot> {
    const now = this.clock.now();
    const event = this.newEvent(documentStatusChangeEventCommand({
      tenantId: options.tenantId,
      stream: options.stream,
      doctypeName: options.doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      plan: options.plan,
      metadata: options.command.metadata ?? {}
    }));
    const after = {
      ...options.existing,
      version: options.existing.version + 1,
      docstatus: options.plan.nextStatus,
      updatedAt: now
    } satisfies DocumentSnapshot;
    const automationPlan = this.planAutomationRuns({
      doctype: options.doctype,
      event,
      before: options.existing,
      after,
      touchedFields: [],
      input: {},
      actor: options.command.actor
    });
    const commit = await this.store.commitBatch(
      [
        { stream: options.stream, expectedVersion: options.existing.version, events: [event] },
        ...automationPlan.entries
      ],
      (savedEvents) => {
        const saved = requireFirstSavedEvent(savedEvents);
        return {
          snapshot: snapshotFromCommittedDocumentEvent(options.existing, saved, { docstatus: options.plan.nextStatus }),
          auxiliarySnapshots: automationPlan.auxiliarySnapshots(savedEvents)
        };
      }
    );
    return this.finishAfterCommit(
      options.command.actor,
      options.doctype,
      commit,
      requireFirstSavedEvent(commit.events),
      options.relatedDocType
    );
  }

  private async finishAfterCommit(
    actor: Actor,
    doctype: DocTypeDefinition,
    commit: DocumentCommit,
    saved: DomainEvent,
    relatedDocType: RelatedDocTypeResolver
  ): Promise<DocumentSnapshot> {
    const snapshot = await this.runAfterCommit(doctype, saved, commit.snapshot) ?? commit.snapshot;
    return this.redactDocumentForActor(actor, doctype, snapshot, relatedDocType);
  }

  private async redactDocumentForActor(
    actor: Actor,
    doctype: DocTypeDefinition,
    document: DocumentSnapshot,
    relatedDocType: RelatedDocTypeResolver
  ): Promise<DocumentSnapshot> {
    return redactDocumentSnapshot({
      actor,
      doctype,
      document,
      relatedDocType
    });
  }

  private planAutomationRuns(options: {
    readonly doctype: DocTypeDefinition;
    readonly event: NewDomainEvent;
    readonly before: DocumentSnapshot | null;
    readonly after: DocumentSnapshot | null;
    readonly touchedFields: readonly string[];
    readonly input: DocumentData;
    readonly actor: Actor;
  }): AutomationRunCommitPlan {
    return this.automationRuns.planEnqueueFromDomainEvent({
      event: options.event,
      change: documentChangeContext(options.before, options.after, options.touchedFields),
      input: options.input,
      actor: options.actor,
      rules: options.doctype.automationRules
    });
  }

  private async runBeforeValidate(
    doctype: DocTypeDefinition,
    data: DocumentData,
    existing?: DocumentSnapshot
  ): Promise<DocumentData> {
    return runDocumentBeforeValidateHooks({
      doctype,
      data,
      hooks: this.registry.hooksFor(doctype.name),
      ...(existing === undefined ? {} : { existing })
    });
  }

  private async validate(
    doctype: DocTypeDefinition,
    data: MutableDocumentData,
    relatedDocType: RelatedDocTypeResolver,
    existing?: DocumentSnapshot,
    hookDataOverride?: DocumentData
  ): Promise<readonly ValidationIssue[]> {
    return documentValidationIssues({
      schemaIssues: validateDocumentData(doctype, data, {
        partial: existing !== undefined,
        relatedDocType
      }),
      hookIssues: await runDocumentValidationHooks({
        doctype,
        data,
        hooks: this.registry.hooksFor(doctype.name),
        ...(existing === undefined ? {} : { existing }),
        ...(hookDataOverride === undefined ? {} : { hookDataOverride })
      })
    });
  }

  private async applyFetchedFields(
    actor: Actor,
    tenantId: string,
    doctype: DocTypeDefinition,
    data: MutableDocumentData,
    relatedDocType: RelatedDocTypeResolver,
    options: { readonly existing?: DocumentSnapshot } = {}
  ): Promise<DocumentData> {
    return applyFetchedFields({
      doctype,
      data,
      relatedDocType,
      ...(options.existing === undefined ? {} : { existing: options.existing }),
      readFetchedTarget: async ({ sourceDoctype, field, targetDoctype, targetName }) => {
        const target = await this.readDocumentFromEvents(tenantId, targetDoctype, targetName);
        if (!target || !(await this.canReadLinkedDocument(actor, sourceDoctype, field, targetDoctype, target))) {
          return null;
        }
        return target;
      }
    });
  }

  private async validateLinks(
    actor: Actor,
    tenantId: string,
    doctype: DocTypeDefinition,
    data: MutableDocumentData,
    relatedDocType: RelatedDocTypeResolver
  ): Promise<readonly ValidationIssue[]> {
    return validateDocumentLinks({
      doctype,
      data,
      relatedDocType,
      canReadLinkedTarget: async ({ sourceDoctype, field, targetDoctype, targetName }) => {
        const target = await this.readDocumentFromEvents(tenantId, targetDoctype, targetName);
        return target !== null &&
          await this.canReadLinkedDocument(actor, sourceDoctype, field, targetDoctype, target);
      }
    });
  }

  private async ensureUserPermissionAccess(
    actor: Actor,
    doctype: DocTypeDefinition,
    document: DocumentSnapshot
  ): Promise<void> {
    const grants = await this.userPermissions?.permissionsFor(actor, document.tenantId);
    const decision = planDocumentUserPermissionAccess({
      actor,
      doctype,
      document,
      userPermissionGrants: grants ?? []
    });
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
    }
  }

  private async canReadLinkedDocument(
    actor: Actor,
    sourceDoctype: DocTypeDefinition,
    field: FieldDefinition,
    targetDoctype: DocTypeDefinition,
    target: DocumentSnapshot
  ): Promise<boolean> {
    const sharedPermissions = await this.sharedPermissionsForAction(actor, targetDoctype, "read", target);
    const userPermissionGrants = await this.userPermissions?.permissionsFor(actor, target.tenantId);
    return canReadLinkedDocumentTarget({
      actor,
      sourceDoctype,
      field,
      targetDoctype,
      target,
      sharedPermissions: sharedPermissions ?? [],
      userPermissionGrants: userPermissionGrants ?? []
    });
  }

  private async sharedPermissionsForAction(
    actor: Actor,
    doctype: DocTypeDefinition,
    action: PermissionAction,
    document: DocumentSnapshot
  ): Promise<readonly DocumentSharePermission[]> {
    const access = await resolveDocumentSharedPermissionsForAction({
      actor,
      doctype,
      action,
      document,
      readSharedPermissions: (shareActor, shareDocument) =>
        this.readSharedPermissions(shareActor, shareDocument)
    });
    return access.sharedPermissions;
  }

  private async readSharedPermissions(
    actor: Actor,
    document: DocumentSnapshot
  ): Promise<readonly DocumentSharePermission[]> {
    return (await this.documentShares?.sharedPermissionsFor(actor, document)) ?? [];
  }

  private ensureDocTypeActionAccess(
    actor: Actor,
    doctype: DocTypeDefinition,
    action: PermissionAction
  ): void {
    const decision = planDocTypeActionAccess({ actor, doctype, action });
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
    }
  }

  private ensureDocumentActionAccess(
    actor: Actor,
    doctype: DocTypeDefinition,
    action: PermissionAction,
    document: DocumentSnapshot,
    deniedAction?: string
  ): void {
    const decision = planDocumentActionAccess({
      actor,
      doctype,
      action,
      document,
      ...(deniedAction === undefined ? {} : { deniedAction })
    });
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
    }
  }

  private async ensureSharedDocumentActionAccess(
    actor: Actor,
    doctype: DocTypeDefinition,
    action: PermissionAction,
    document: DocumentSnapshot,
    deniedAction?: string
  ): Promise<DocumentSharedPermissionResolution> {
    const access = await resolveDocumentSharedPermissionsForAction({
      actor,
      doctype,
      action,
      document,
      readSharedPermissions: (shareActor, shareDocument) =>
        this.readSharedPermissions(shareActor, shareDocument)
    });
    const decision = planDocumentActionAccess({
      actor,
      doctype,
      action,
      document,
      sharedPermissions: access.sharedPermissions,
      ...(deniedAction === undefined ? {} : { deniedAction })
    });
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
    }
    return access;
  }

  private async doctypeContext(
    actor: Actor,
    doctypeName: string,
    tenantId: string
  ): Promise<DocumentServiceDocTypeContext> {
    const root = await this.doctypeFor(actor, doctypeName, tenantId);
    return resolveTenantDocTypeContext(root, (name) => this.doctypeFor(actor, name, tenantId));
  }

  private async doctypeFor(actor: Actor, doctypeName: string, tenantId: string): Promise<DocTypeDefinition> {
    const base = this.registry.get(doctypeName);
    return resolveTenantDocType(base, { actor, tenantId }, this.doctypeResolver);
  }

  private async readDocumentFromEvents(
    tenantId: string,
    doctype: DocTypeDefinition,
    name: string
  ): Promise<DocumentSnapshot | null> {
    return foldDocument(await this.store.readStream(documentStream(tenantId, doctype.name, name)));
  }

  private async planUniqueValueReservationWrites(
    actor: Actor,
    reservations: readonly UniqueValueReservation[],
    occurredAt: string
  ): Promise<readonly AtomicUniqueReservationWrite[]> {
    const planned: Array<{ readonly reservation: UniqueValueReservation; readonly existing: DocumentSnapshot | null }> = [];
    for (const reservation of reservations) {
      const existing = foldDocument(await this.store.readStream(reservation.stream));
      const ownerLookup = planUniqueValueReservationOwnerLookup({ reservation, existing });
      const ownerStillOwnsValue = ownerLookup.status === "read-owner"
        ? await this.uniqueReservationOwnerStillOwnsValue(reservation, ownerLookup.documentName)
        : ownerLookup.ownerStillOwnsValue;
      const decision = planUniqueValueReservationWriteDecision({
        reservation,
        existing,
        ownerStillOwnsValue
      });
      if (decision.status === "skip") {
        continue;
      }
      if (decision.status === "conflict") {
        throw conflict(decision.message);
      }
      planned.push({ reservation: decision.reservation, existing: decision.existing });
    }
    return planned.map(({ reservation, existing }) => {
      const eventPlan = planUniqueValueReservationEvent(reservation, existing);
      return {
        reservation,
        existing,
        event: this.newEvent(uniqueValueEventCommand({
          reservation,
          actorId: actor.id,
          occurredAt,
          plan: eventPlan
        }))
      };
    });
  }

  private async planUniqueValueReleaseWrites(
    actor: Actor,
    reservations: readonly UniqueValueReservation[],
    occurredAt: string
  ): Promise<readonly AtomicUniqueReleaseWrite[]> {
    const planned: AtomicUniqueReleaseWrite[] = [];
    for (const reservation of reservations) {
      const existing = foldDocument(await this.store.readStream(reservation.stream));
      const decision = planUniqueValueReleaseWriteDecision({ reservation, existing });
      if (decision.status === "skip") {
        continue;
      }
      const eventPlan = planUniqueValueReleaseEvent(decision.reservation);
      planned.push({
        reservation: decision.reservation,
        existing: decision.existing,
        event: this.newEvent(uniqueValueEventCommand({
          reservation: decision.reservation,
          actorId: actor.id,
          occurredAt,
          plan: eventPlan
        }))
      });
    }
    return planned;
  }

  private async uniqueReservationOwnerStillOwnsValue(
    reservation: UniqueValueReservation,
    documentName: string
  ): Promise<boolean> {
    const owner = foldDocument(
      await this.store.readStream(documentStream(reservation.tenantId, reservation.doctype, documentName))
    );
    return uniqueReservationOwnerStillOwnsValue(reservation, owner);
  }

  private async runAfterCommit(
    doctype: DocTypeDefinition,
    event: DomainEvent,
    snapshot: DocumentSnapshot | null
  ): Promise<DocumentSnapshot | null> {
    await runDocumentAfterCommitHooks({
      doctype,
      event,
      snapshot,
      hooks: this.registry.hooksFor(doctype.name),
      ...(this.afterCommit === undefined ? {} : { afterCommit: this.afterCommit }),
      ...(this.onHookError === undefined ? {} : { onHookError: this.onHookError })
    });
    return this.readDocumentFromEvents(event.tenantId, doctype, event.documentName);
  }

  private newEvent<TPayload extends NewDomainEvent["payload"]>(
    event: Omit<NewDomainEvent<TPayload>, "id" | "sequence">
  ): NewDomainEvent<TPayload> {
    return {
      ...event,
      id: this.ids.next("evt_")
    };
  }

  private async resolveName(
    doctype: DocTypeDefinition,
    data: DocumentData,
    context: {
      readonly actor: Actor;
      readonly tenantId: string;
      readonly now: string;
      readonly occupiedNamingCurrent?: number;
      readonly maxCandidateAttempts: number;
    }
  ): Promise<DocumentNameResolution> {
    const naming = doctype.naming ?? { kind: "uuid" };
    if (naming.kind !== "series") {
      return { name: resolveDocumentName(doctype, data, this.ids), data };
    }
    const write = await this.planNamingSeriesWrite(doctype, naming, data, context);
    return {
      name: write.name,
      data: namingTargetData(naming, data, write.name),
      namingSeriesWrite: write
    };
  }

  private async planNamingSeriesWrite(
    doctype: DocTypeDefinition,
    strategy: NamingSeriesStrategy,
    data: DocumentData,
    context: {
      readonly actor: Actor;
      readonly tenantId: string;
      readonly now: string;
      readonly occupiedNamingCurrent?: number;
      readonly maxCandidateAttempts: number;
    }
  ): Promise<AtomicNamingSeriesWrite & { readonly name: string; readonly candidateAttempts: number }> {
    const identity = resolveNamingSeriesIdentity(doctype, strategy, data, context);
    const stream = namingSeriesStream(context.tenantId, doctype.name, identity.counter, identity.scope);
    const existing = foldDocument(await this.store.readStream(stream));
    const storedCurrent = namingSeriesCurrentValue(existing?.data.current);
    const current = storedCurrent === undefined
      ? context.occupiedNamingCurrent
      : context.occupiedNamingCurrent === undefined
        ? storedCurrent
        : Math.max(storedCurrent, context.occupiedNamingCurrent);
    const scan = scanNamingCandidates({
      doctype,
      strategy,
      data,
      context,
      ...(current === undefined ? {} : { current }),
      attemptLimit: context.maxCandidateAttempts
    });
    const candidate = scan.candidates[0]!;
    const eventPlan = planNamingSeriesEvent({
      doctypeName: doctype.name,
      pattern: strategy.pattern,
      counter: identity.counter,
      scope: identity.scope,
      next: candidate.value,
      existing
    });
    return {
      stream,
      existing,
      next: candidate.value,
      name: candidate.name,
      candidateAttempts: scan.attempts,
      event: this.newEvent(namingSeriesEventCommand({
        tenantId: context.tenantId,
        stream,
        actorId: context.actor.id,
        occurredAt: context.now,
        plan: eventPlan
      }))
    };
  }

  private async namingConflictDisposition(input: {
    readonly error: unknown;
    readonly doctype: DocTypeDefinition;
    readonly tenantId: string;
    readonly documentName: string;
    readonly nameResolution: DocumentNameResolution;
  }): Promise<"counter" | "document" | null> {
    const write = input.nameResolution.namingSeriesWrite;
    if (write === undefined || !isDocumentConflictError(input.error)) {
      return null;
    }
    const counterEvents = await this.store.readStream(write.stream);
    const expectedCounterVersion = write.existing?.version ?? 0;
    if ((counterEvents.at(-1)?.sequence ?? 0) !== expectedCounterVersion) {
      return "counter";
    }
    const document = foldDocument(await this.store.readStream(
      documentStream(input.tenantId, input.doctype.name, input.documentName)
    ));
    return document !== null && document.docstatus !== "deleted" ? "document" : null;
  }
}

function ensureGeneratedNamingFieldNotSupplied(
  doctype: DocTypeDefinition,
  data: MutableDocumentData
): void {
  const naming = doctype.naming;
  if (
    naming?.kind !== "series" ||
    naming.targetField === undefined ||
    !Object.prototype.hasOwnProperty.call(data, naming.targetField)
  ) {
    return;
  }
  throw validationFailed([{
    field: naming.targetField,
    code: "generated_name",
    message: `Field '${naming.targetField}' is generated by the naming series for ${doctype.name}`
  }]);
}

function withoutGeneratedNamingField(
  doctype: DocTypeDefinition,
  data: MutableDocumentData
): MutableDocumentData {
  const naming = doctype.naming;
  if (naming?.kind !== "series" || naming.targetField === undefined) {
    return data;
  }
  const { [naming.targetField]: _generated, ...remaining } = data;
  return remaining;
}

function draftDocumentSnapshot(input: {
  readonly tenantId: string;
  readonly doctype: DocTypeDefinition;
  readonly name: string;
  readonly version: number;
  readonly data: DocumentData;
  readonly now: string;
}): DocumentSnapshot {
  return {
    tenantId: input.tenantId,
    doctype: input.doctype.name,
    name: input.name,
    version: input.version,
    docstatus: "draft",
    data: input.data,
    createdAt: input.now,
    updatedAt: input.now
  };
}
