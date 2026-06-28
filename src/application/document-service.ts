import {
  applyDocumentDataChange,
  foldDocument,
  foldDocumentAssignments,
  foldDocumentFollowers,
  foldDocumentTags
} from "../core/events.js";
import {
  documentShareAllows,
  foldDocumentShares,
  type DocumentShareProvider
} from "../core/document-shares.js";
import { can } from "../core/permissions.js";
import { applyDefaults, compactData, validateDocumentData } from "../core/schema.js";
import {
  planDocumentFieldMerge,
  type DocumentFieldMergePlan
} from "../core/document-merge.js";
import {
  ensureSharedGrantIsDelegable,
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
  normalizeBulkDocumentSelections
} from "./document-bulk-policy.js";
import {
  canReadLinkedDocumentTarget,
  canUseDocumentAction,
  documentSatisfiesUserPermissions
} from "./document-access-policy.js";
import {
  ensureDocumentStatus,
  ensureExpectedVersion,
  ensureMergeBaseVersion,
  mergeSnapshotFromDocument,
  normalizeUnsetFields,
  canExecuteDomainCommandForRoles,
  planDocumentCopyPolicy,
  planDocumentCreatePolicy,
  planDocumentDeletePolicy,
  planDocumentStatusChangePolicy,
  planDocumentUpdatePolicy,
  planDomainCommandPolicy,
  planWorkflowTransitionPolicy
} from "./document-command-policy.js";
import {
  domainCommandAppliedPayload,
  workflowTransitionedPayload
} from "./document-command-events.js";
import {
  documentDeletedPayload,
  documentStatusChangedPayload,
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
  projectUniqueValueReleaseWrite,
  projectUniqueValueReservationWrite,
  releasedUniqueValueReservations,
  uniqueReservationOwnerStillOwnsValue,
  uniqueValueReservations,
  UNIQUE_VALUE_DOCTYPE,
  type UniqueValueReservation
} from "./document-unique-values.js";
import {
  ensureCreateNameAllowed,
  namingSeriesCurrentValue,
  NAMING_SERIES_DOCTYPE,
  planNamingSeriesEvent,
  renderNamingSeries,
  resolveDocumentName
} from "./document-naming.js";
import {
  applyFetchedFields,
  relatedDocTypeNames,
  validateDocumentLinks,
  type RelatedDocTypeResolver
} from "./document-reference-policy.js";
import { resolveTenant } from "./document-tenant-policy.js";
import {
  allowOnSubmitIssues,
  childTableOriginIssues,
  documentUnsetIssues,
  preserveReadOnlyTableValues,
  readonlyIssues,
  stripInternalTableFields
} from "./document-field-policy.js";
import { documentStream, namingSeriesStream } from "../core/streams.js";
import {
  type UserPermissionProvider
} from "../core/user-permissions.js";
import {
  documentAfterCommitContext,
  documentHookContext,
  documentValidationHookData,
  mergeDocumentHookPatch,
  type AfterCommitContext
} from "../core/document-hooks.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Clock } from "../ports/clock.js";
import { systemClock } from "../ports/clock.js";
import type { DocumentCommit, DocumentStore } from "../ports/document-store.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { cryptoIdGenerator } from "../ports/id-generator.js";
import {
  type Actor,
  type DocStatus,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentSnapshot,
  type DomainEvent,
  type FieldDefinition,
  type MutableDocumentData,
  type NewDomainEvent,
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
  readonly onHookError?: (error: unknown, event: DomainEvent) => void | Promise<void>;
  readonly afterCommit?: (context: AfterCommitContext) => void | Promise<void>;
}

export type DocumentServiceDocTypeResolver = (
  base: DocTypeDefinition,
  context: { readonly actor: Actor; readonly tenantId: string }
) => DocTypeDefinition | Promise<DocTypeDefinition>;

interface DocumentServiceDocTypeContext {
  readonly doctype: DocTypeDefinition;
  readonly relatedDocType: RelatedDocTypeResolver;
}

interface UniqueValueReservationWrite {
  readonly reservation: UniqueValueReservation;
  readonly existing: DocumentSnapshot | null;
  readonly event: NewDomainEvent;
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

const NAMING_SERIES_MAX_ATTEMPTS = 10;

export class DocumentService implements DocumentCommandExecutor {
  private readonly registry: ModelRegistry;
  private readonly store: DocumentStore;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly doctypeResolver: DocumentServiceDocTypeResolver | undefined;
  private readonly userPermissions: UserPermissionProvider | undefined;
  private readonly documentShares: DocumentShareProvider | undefined;
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
    this.onHookError = options.onHookError;
    this.afterCommit = options.afterCommit;
  }

  async create(command: CreateDocumentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    if (!can(command.actor, doctype, "create")) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot create ${doctype.name}`);
    }
    ensureCreateNameAllowed(doctype, command.name);

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
    const data = stripInternalTableFields(
      doctype,
      withFetchedFields,
      relatedDocType
    );
    const issues = [
      ...(await this.validate(doctype, data, relatedDocType)),
      ...(await this.validateLinks(command.actor, tenantId, doctype, data, relatedDocType))
    ];
    if (issues.length > 0) {
      throw validationFailed(issues);
    }

    const name = command.name ?? await this.resolveName(doctype, data, {
      actor: command.actor,
      tenantId,
      now
    });
    const stream = documentStream(tenantId, doctype.name, name);
    const existing = foldDocument(await this.store.readStream(stream));
    if (existing && existing.docstatus !== "deleted") {
      throw conflict(`${doctype.name}/${name} already exists`);
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
    const event = this.newEvent({
      tenantId,
      stream,
      type: plan.eventType,
      doctype: doctype.name,
      documentName: name,
      actorId: command.actor.id,
      occurredAt: now,
      payload: plan.payload,
      metadata: command.metadata ?? {}
    });
    const commit = await this.store.commitBatch(
      [
        ...uniqueReservationWrites.map((write) => ({
          stream: write.reservation.stream,
          expectedVersion: write.existing?.version ?? 0,
          events: [write.event]
        })),
        { stream, expectedVersion: 0, events: [event] }
      ],
      (savedEvents) => {
        const saved = requireSavedEvent(savedEvents, event.id);
        return {
          snapshot: snapshotFromDocumentCreatedEvent(saved),
          auxiliarySnapshots: uniqueReservationWrites.map((write) =>
            projectUniqueValueReservationWrite({
              reservation: write.reservation,
              existing: write.existing,
              saved: requireSavedEvent(savedEvents, write.event.id)
            })
          )
        };
      }
    );
    return this.finishAfterCommit(doctype, commit, requireSavedEvent(commit.events, event.id));
  }

  async update(command: UpdateDocumentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    if (!(await this.canActOnDocument(command.actor, doctype, "update", existing))) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot update ${doctype.name}/${command.name}`);
    }
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
    if (!(await this.canActOnDocument(command.actor, doctype, "update", existing))) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot update ${doctype.name}/${command.name}`);
    }
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);

    const base = foldDocument(events.filter((event) => event.sequence <= command.baseVersion));
    if (!base || base.version !== command.baseVersion) {
      throw conflict(`Merge base version ${String(command.baseVersion)} was not found for ${doctype.name}/${command.name}`);
    }

    const patch = await this.runBeforeValidate(doctype, compactData(command.patch), existing);
    const normalizedPatch = preserveReadOnlyTableValues(doctype, patch, existing, relatedDocType);
    const unset = normalizeUnsetFields(command.unset);
    const draft = applyDocumentDataChange(base.data, normalizedPatch, unset);
    const plan = planDocumentFieldMerge({
      base: mergeSnapshotFromDocument(base),
      remote: mergeSnapshotFromDocument(existing),
      draft
    });
    if (plan.status === "conflict") {
      return { status: "conflict", plan, document: existing };
    }
    if (Object.keys(plan.patch).length === 0 && plan.unset.length === 0) {
      return { status: "noop", plan, document: existing };
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
    return { status: "applied", plan, document };
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
    if (options.existing.docstatus !== "draft" && options.existing.docstatus !== "submitted") {
      ensureDocumentStatus(options.existing, ["draft"], options.action);
    }

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
    const readOnlyIssues = readonlyIssues(
      options.doctype,
      patchWithoutInternalFields,
      options.relatedDocType,
      data,
      unset
    );
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
    const issues = [
      ...submittedUpdateIssues,
      ...unsetIssues,
      ...originIssues,
      ...readOnlyIssues,
      ...validationIssues,
      ...linkIssues
    ];
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
    const plan = planDocumentUpdatePolicy({
      doctype: options.doctype,
      patch: normalizedPatch,
      unset,
      eventType: options.command.eventType
    });
    const event = this.newEvent({
      tenantId: options.tenantId,
      stream: options.stream,
      type: plan.eventType,
      doctype: options.doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      payload: plan.payload,
      metadata: options.command.metadata ?? {}
    });
    const commit = await this.store.commitBatch(
      [
        ...uniqueReservationWrites.map((write) => ({
          stream: write.reservation.stream,
          expectedVersion: write.existing?.version ?? 0,
          events: [write.event]
        })),
        { stream: options.stream, expectedVersion: options.existing.version, events: [event] }
      ],
      (savedEvents) => {
        const saved = requireSavedEvent(savedEvents, event.id);
        return {
          snapshot: snapshotFromCommittedDocumentEvent(options.existing, saved, { data }),
          auxiliarySnapshots: uniqueReservationWrites.map((write) =>
            projectUniqueValueReservationWrite({
              reservation: write.reservation,
              existing: write.existing,
              saved: requireSavedEvent(savedEvents, write.event.id)
            })
          )
        };
      }
    );
    const saved = requireSavedEvent(commit.events, event.id);
    await this.releaseUniqueValues(options.command.actor, releasedReservations, saved.occurredAt, {
      suppressErrors: true
    });
    return this.finishAfterCommit(options.doctype, commit, saved);
  }

  async duplicate(command: DuplicateDocumentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    if (!(await this.canActOnDocument(command.actor, doctype, "read", existing))) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot duplicate ${doctype.name}/${command.name}`);
    }
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    const plan = planDocumentCopyPolicy({
      action: "duplicate",
      doctype,
      existing,
      data: command.data,
      metadata: command.metadata,
      relatedDocType
    });
    return this.create({
      actor: command.actor,
      doctype: doctype.name,
      data: plan.data,
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
    if (!(await this.canActOnDocument(command.actor, doctype, "read", existing))) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot amend ${doctype.name}/${command.name}`);
    }
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    ensureDocumentStatus(existing, ["cancelled"], "amend");
    const plan = planDocumentCopyPolicy({
      action: "amend",
      doctype,
      existing,
      data: command.data,
      metadata: command.metadata,
      relatedDocType
    });
    return this.create({
      actor: command.actor,
      doctype: doctype.name,
      data: plan.data,
      ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
      ...(command.newName === undefined ? {} : { name: command.newName }),
      ...(command.eventType === undefined ? {} : { eventType: command.eventType }),
      metadata: plan.metadata
    });
  }

  async transition(command: TransitionDocumentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const doctype = await this.doctypeFor(command.actor, command.doctype, tenantId);
    const workflow = doctype.workflow;
    if (!workflow) {
      throw new FrameworkError("BAD_REQUEST", `${doctype.name} has no workflow`, { status: 400 });
    }
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    if (!can(command.actor, doctype, "transition", existing)) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot transition ${doctype.name}/${command.name}`);
    }
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    ensureDocumentStatus(existing, ["draft"], "transition");

    const plan = planWorkflowTransitionPolicy({
      actor: command.actor,
      action: command.action,
      doctypeName: doctype.name,
      document: existing,
      workflow
    });
    const payload = workflowTransitionedPayload({
      action: command.action,
      from: plan.from,
      to: plan.to,
      patch: plan.patch
    });
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: plan.eventType,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload,
      metadata: command.metadata ?? {}
    });
    const commit = await this.store.commit(stream, existing.version, [event], (savedEvents) => {
      const saved = requireFirstSavedEvent(savedEvents);
      return snapshotFromCommittedDocumentEvent(existing, saved, {
        data: { ...existing.data, ...plan.patch }
      });
    });
    return this.finishAfterCommit(doctype, commit, requireFirstSavedEvent(commit.events));
  }

  async execute(command: ExecuteDomainCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const { doctype, relatedDocType } = await this.doctypeContext(command.actor, command.doctype, tenantId);
    const commandDefinition = doctype.commands?.find((item) => item.name === command.command);
    if (!commandDefinition) {
      throw new FrameworkError("BAD_REQUEST", `${doctype.name} has no command '${command.command}'`, {
        status: 400
      });
    }
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
    if (!(await this.canActOnDocument(command.actor, doctype, commandPlan.permissionAction, existing))) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot execute ${command.command} on ${doctype.name}/${command.name}`);
    }
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    if (!canExecuteDomainCommandForRoles(command.actor, commandDefinition)) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot execute ${command.command}`);
    }
    ensureExpectedVersion(existing, command.expectedVersion);
    ensureDocumentStatus(existing, ["draft"], `execute ${command.command}`);

    const sanitizedInput = stripInternalTableFields(doctype, commandPlan.input, relatedDocType);
    const normalizedPatch = await this.runBeforeValidate(doctype, commandPlan.patch, existing);
    const patchWithoutInternalFields = stripInternalTableFields(doctype, normalizedPatch, relatedDocType);
    const patchWithFetchedFields = await this.applyFetchedFields(
      command.actor,
      tenantId,
      doctype,
      normalizedPatch,
      relatedDocType,
      { existing }
    );
    const originIssues = childTableOriginIssues(doctype, patchWithFetchedFields, existing.data, relatedDocType);
    const patchWithReadOnlyValues = preserveReadOnlyTableValues(
      doctype,
      patchWithFetchedFields,
      existing,
      relatedDocType
    );
    const data = applyDocumentDataChange(existing.data, patchWithReadOnlyValues, []);
    const readOnlyIssues = commandPlan.allowReadOnlyFields
      ? []
      : readonlyIssues(doctype, patchWithoutInternalFields, relatedDocType, data);
    const validationIssues = await this.validate(doctype, patchWithReadOnlyValues, relatedDocType, existing);
    const linkIssues = await this.validateLinks(command.actor, tenantId, doctype, patchWithReadOnlyValues, relatedDocType);
    const issues = [...originIssues, ...readOnlyIssues, ...validationIssues, ...linkIssues];
    if (issues.length > 0) {
      throw validationFailed(issues);
    }

    const payload = domainCommandAppliedPayload({
      command: command.command,
      input: sanitizedInput,
      patch: patchWithReadOnlyValues
    });
    const event = this.newEvent({
      tenantId,
      stream,
      type: commandDefinition.eventType,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload,
      metadata: command.metadata ?? {}
    });
    const commit = await this.store.commit(stream, existing.version, [event], (savedEvents) => {
      const saved = requireFirstSavedEvent(savedEvents);
      return snapshotFromCommittedDocumentEvent(existing, saved, {
        data: { ...existing.data, ...patchWithReadOnlyValues }
      });
    });
    return this.finishAfterCommit(doctype, commit, requireFirstSavedEvent(commit.events));
  }

  async comment(command: AddDocumentCommentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const doctype = await this.doctypeFor(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    if (!can(command.actor, doctype, "comment", existing)) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot comment on ${doctype.name}/${command.name}`);
    }
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    const plan = planDocumentCommentPolicy(doctype, command.text);
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: plan.eventType,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload: plan.payload,
      metadata: command.metadata ?? {}
    });
    return this.commitDocumentEvent(doctype, existing, stream, event);
  }

  async recordActivity(command: RecordDocumentActivityCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const doctype = await this.doctypeFor(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    if (!can(command.actor, doctype, "activity", existing)) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot record activity on ${doctype.name}/${command.name}`);
    }
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    const plan = planDocumentActivityPolicy(doctype, command);
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: plan.eventType,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload: plan.payload,
      metadata: command.metadata ?? {}
    });
    return this.commitDocumentEvent(doctype, existing, stream, event);
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
    const doctype = await this.doctypeFor(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const { snapshot: existing, events } = await this.requireExistingEventStream(stream, doctype, command.name);
    const staticShareAllowed = can(command.actor, doctype, "share", existing);
    const sharedPermissions = staticShareAllowed
      ? []
      : (await this.documentShares?.sharedPermissionsFor(command.actor, existing)) ?? [];
    if (!staticShareAllowed && !documentShareAllows(sharedPermissions, "share")) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot share ${doctype.name}/${command.name}`);
    }
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    const state = foldDocumentShares(tenantId, doctype.name, command.name, events);
    const plan = planDocumentSharePolicy({
      doctype,
      currentGrants: state.grants,
      command
    });
    if (!staticShareAllowed) {
      ensureSharedGrantIsDelegable(command.actor, doctype, existing, sharedPermissions, plan.grant);
    }
    if (plan.noop) {
      return existing;
    }
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: plan.eventType,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload: plan.payload,
      metadata: command.metadata ?? {}
    });
    return this.commitDocumentEvent(doctype, existing, stream, event);
  }

  async revokeShare(command: RevokeDocumentShareCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const doctype = await this.doctypeFor(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const { snapshot: existing, events } = await this.requireExistingEventStream(stream, doctype, command.name);
    if (!(await this.canActOnDocument(command.actor, doctype, "share", existing))) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot revoke shares for ${doctype.name}/${command.name}`);
    }
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    const state = foldDocumentShares(tenantId, doctype.name, command.name, events);
    const plan = planDocumentShareRevocationPolicy({
      doctype,
      currentGrants: state.grants,
      userId: command.userId
    });
    if (plan.noop) {
      return existing;
    }
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: plan.eventType,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload: plan.payload,
      metadata: command.metadata ?? {}
    });
    return this.commitDocumentEvent(doctype, existing, stream, event);
  }

  async delete(command: DeleteDocumentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const doctype = await this.doctypeFor(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    if (!can(command.actor, doctype, "delete", existing)) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot delete ${doctype.name}/${command.name}`);
    }
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    const plan = planDocumentDeletePolicy(doctype);
    ensureDocumentStatus(existing, plan.allowedStatus, "delete");

    const now = this.clock.now();
    const uniqueReservations = uniqueValueReservations(tenantId, doctype, existing.data, existing.name);
    const event = this.newEvent({
      tenantId,
      stream,
      type: plan.eventType,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload: documentDeletedPayload(),
      metadata: command.metadata ?? {}
    });
    const commit = await this.store.commit(stream, existing.version, [event], (savedEvents) => {
      const saved = requireFirstSavedEvent(savedEvents);
      return snapshotFromCommittedDocumentEvent(existing, saved, { docstatus: plan.nextStatus });
    });
    const saved = requireFirstSavedEvent(commit.events);
    await this.releaseUniqueValues(command.actor, uniqueReservations, saved.occurredAt, { suppressErrors: true });
    return this.finishAfterCommit(doctype, commit, saved);
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
        action: command.action
      })
    );
  }

  async submit(command: SubmitDocumentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const doctype = await this.doctypeFor(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    if (!can(command.actor, doctype, "submit", existing)) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot submit ${doctype.name}/${command.name}`);
    }
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
      nextStatus: plan.nextStatus,
      eventType: plan.eventType,
      payloadKind: plan.payloadKind
    });
  }

  async cancel(command: CancelDocumentCommand): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const doctype = await this.doctypeFor(command.actor, command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    if (!can(command.actor, doctype, "cancel", existing)) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot cancel ${doctype.name}/${command.name}`);
    }
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
      nextStatus: plan.nextStatus,
      eventType: plan.eventType,
      payloadKind: plan.payloadKind
    });
  }

  private async runBulkDocumentCommand(
    command: BulkDocumentsCommand,
    run: (selection: BulkDocumentSelection) => Promise<DocumentSnapshot>
  ): Promise<BulkDocumentCommandResult> {
    const selections = normalizeBulkDocumentSelections(command.documents);
    const succeeded: BulkDocumentCommandEntry[] = [];
    const failed: BulkDocumentCommandFailure[] = [];
    for (const selection of selections) {
      try {
        const snapshot = await run(selection);
        succeeded.push({ name: selection.name, snapshot });
      } catch (error) {
        failed.push(bulkDocumentFailure(selection.name, error));
      }
    }
    return { succeeded, failed };
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
    const doctype = await this.doctypeFor(options.command.actor, options.command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, options.command.name);
    const { snapshot: existing, events } = await this.requireExistingEventStream(stream, doctype, options.command.name);
    if (!can(options.command.actor, doctype, "assign", existing)) {
      throw permissionDenied(`Actor '${options.command.actor.id}' cannot assign ${doctype.name}/${options.command.name}`);
    }
    await this.ensureUserPermissionAccess(options.command.actor, doctype, existing);
    ensureExpectedVersion(existing, options.command.expectedVersion);
    const plan = planDocumentAssignmentChangePolicy({
      doctype,
      currentAssignees: foldDocumentAssignments(events),
      assignee: options.command.assignee,
      action: options.action
    });
    if (plan.noop) {
      return existing;
    }
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: plan.eventType,
      doctype: doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      payload: plan.payload,
      metadata: options.command.metadata ?? {}
    });
    return this.commitDocumentEvent(doctype, existing, stream, event);
  }

  private async changeTag(options: {
    readonly command: TagDocumentCommand | UntagDocumentCommand;
    readonly action: CollaborationCollectionAction;
  }): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(options.command.actor, options.command.tenantId);
    const doctype = await this.doctypeFor(options.command.actor, options.command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, options.command.name);
    const { snapshot: existing, events } = await this.requireExistingEventStream(stream, doctype, options.command.name);
    if (!can(options.command.actor, doctype, "tag", existing)) {
      throw permissionDenied(`Actor '${options.command.actor.id}' cannot tag ${doctype.name}/${options.command.name}`);
    }
    await this.ensureUserPermissionAccess(options.command.actor, doctype, existing);
    ensureExpectedVersion(existing, options.command.expectedVersion);
    const plan = planDocumentTagChangePolicy({
      doctype,
      currentTags: foldDocumentTags(events),
      tag: options.command.tag,
      action: options.action
    });
    if (plan.noop) {
      return existing;
    }
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: plan.eventType,
      doctype: doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      payload: plan.payload,
      metadata: options.command.metadata ?? {}
    });
    return this.commitDocumentEvent(doctype, existing, stream, event);
  }

  private async changeFollower(options: {
    readonly command: FollowDocumentCommand | UnfollowDocumentCommand;
    readonly action: CollaborationCollectionAction;
  }): Promise<DocumentSnapshot> {
    const tenantId = resolveTenant(options.command.actor, options.command.tenantId);
    const doctype = await this.doctypeFor(options.command.actor, options.command.doctype, tenantId);
    const stream = documentStream(tenantId, doctype.name, options.command.name);
    const { snapshot: existing, events } = await this.requireExistingEventStream(stream, doctype, options.command.name);
    if (!can(options.command.actor, doctype, "follow", existing)) {
      throw permissionDenied(`Actor '${options.command.actor.id}' cannot follow ${doctype.name}/${options.command.name}`);
    }
    await this.ensureUserPermissionAccess(options.command.actor, doctype, existing);
    ensureExpectedVersion(existing, options.command.expectedVersion);
    const plan = planDocumentFollowerChangePolicy({
      doctype,
      actor: options.command.actor,
      currentFollowers: foldDocumentFollowers(events),
      follower: options.command.follower,
      action: options.action
    });
    if (plan.noop) {
      return existing;
    }
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: plan.eventType,
      doctype: doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      payload: plan.payload,
      metadata: options.command.metadata ?? {}
    });
    return this.commitDocumentEvent(doctype, existing, stream, event);
  }

  private async commitDocumentEvent(
    doctype: DocTypeDefinition,
    existing: DocumentSnapshot,
    stream: string,
    event: NewDomainEvent
  ): Promise<DocumentSnapshot> {
    const commit = await this.store.commit(stream, existing.version, [event], (savedEvents) => {
      const saved = requireFirstSavedEvent(savedEvents);
      return snapshotFromCommittedDocumentEvent(existing, saved);
    });
    return this.finishAfterCommit(doctype, commit, requireFirstSavedEvent(commit.events));
  }

  private async changeDocStatus(options: {
    readonly command: SubmitDocumentCommand | CancelDocumentCommand;
    readonly doctype: DocTypeDefinition;
    readonly tenantId: string;
    readonly stream: string;
    readonly existing: DocumentSnapshot;
    readonly nextStatus: DocStatus;
    readonly eventType: string;
    readonly payloadKind: "DocumentSubmitted" | "DocumentCancelled";
  }): Promise<DocumentSnapshot> {
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId: options.tenantId,
      stream: options.stream,
      type: options.eventType,
      doctype: options.doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      payload: documentStatusChangedPayload(options.payloadKind),
      metadata: options.command.metadata ?? {}
    });
    const commit = await this.store.commit(options.stream, options.existing.version, [event], (savedEvents) => {
      const saved = requireFirstSavedEvent(savedEvents);
      return snapshotFromCommittedDocumentEvent(options.existing, saved, { docstatus: options.nextStatus });
    });
    return this.finishAfterCommit(options.doctype, commit, requireFirstSavedEvent(commit.events));
  }

  private async finishAfterCommit(
    doctype: DocTypeDefinition,
    commit: DocumentCommit,
    saved: DomainEvent
  ): Promise<DocumentSnapshot> {
    return await this.runAfterCommit(doctype, saved, commit.snapshot) ?? commit.snapshot;
  }

  private async runBeforeValidate(
    doctype: DocTypeDefinition,
    data: DocumentData,
    existing?: DocumentSnapshot
  ): Promise<DocumentData> {
    let current: MutableDocumentData = { ...data };
    for (const hook of this.registry.hooksFor(doctype.name)) {
      const context = documentHookContext({ doctype, data: current, existing });
      const patch = await hook.beforeValidate?.(context);
      current = mergeDocumentHookPatch(current, patch);
    }
    return compactData(current);
  }

  private async validate(
    doctype: DocTypeDefinition,
    data: MutableDocumentData,
    relatedDocType: RelatedDocTypeResolver,
    existing?: DocumentSnapshot,
    hookDataOverride?: DocumentData
  ): Promise<readonly ValidationIssue[]> {
    const issues = [
      ...validateDocumentData(doctype, data, {
        partial: existing !== undefined,
        relatedDocType
      })
    ];
    const hookData = documentValidationHookData({ data, existing, override: hookDataOverride });
    for (const hook of this.registry.hooksFor(doctype.name)) {
      const context = documentHookContext({ doctype, data: hookData, existing });
      const hookIssues = await hook.validate?.(context);
      if (hookIssues) {
        issues.push(...hookIssues);
      }
    }
    return issues;
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
    if (!(await this.matchesUserPermissions(actor, doctype, document))) {
      throw permissionDenied(`Actor '${actor.id}' cannot access ${doctype.name}/${document.name}`);
    }
  }

  private async matchesUserPermissions(
    actor: Actor,
    doctype: DocTypeDefinition,
    document: DocumentSnapshot
  ): Promise<boolean> {
    const grants = await this.userPermissions?.permissionsFor(actor, document.tenantId);
    return documentSatisfiesUserPermissions({
      doctype,
      document,
      userPermissionGrants: grants ?? []
    });
  }

  private async canReadLinkedDocument(
    actor: Actor,
    sourceDoctype: DocTypeDefinition,
    field: FieldDefinition,
    targetDoctype: DocTypeDefinition,
    target: DocumentSnapshot
  ): Promise<boolean> {
    const sharedPermissions = await this.documentShares?.sharedPermissionsFor(actor, target);
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

  private async canActOnDocument(
    actor: Actor,
    doctype: DocTypeDefinition,
    action: Parameters<typeof can>[2],
    document: DocumentSnapshot
  ): Promise<boolean> {
    if (canUseDocumentAction({ actor, doctype, action, document })) {
      return true;
    }
    const permissions = await this.documentShares?.sharedPermissionsFor(actor, document);
    return canUseDocumentAction({
      actor,
      doctype,
      action,
      document,
      sharedPermissions: permissions ?? []
    });
  }

  private async doctypeContext(
    actor: Actor,
    doctypeName: string,
    tenantId: string
  ): Promise<DocumentServiceDocTypeContext> {
    const root = await this.doctypeFor(actor, doctypeName, tenantId);
    const related = new Map<string, DocTypeDefinition>();
    related.set(root.name, root);
    await this.resolveReachableDocTypes(root, actor, tenantId, related);
    return {
      doctype: root,
      relatedDocType: (name) => related.get(name)
    };
  }

  private async doctypeFor(actor: Actor, doctypeName: string, tenantId: string): Promise<DocTypeDefinition> {
    const base = this.registry.get(doctypeName);
    return this.resolveDocType(base, actor, tenantId);
  }

  private async resolveDocType(
    base: DocTypeDefinition,
    actor: Actor,
    tenantId: string
  ): Promise<DocTypeDefinition> {
    return await this.doctypeResolver?.(base, { actor, tenantId }) ?? base;
  }

  private async resolveReachableDocTypes(
    doctype: DocTypeDefinition,
    actor: Actor,
    tenantId: string,
    related: Map<string, DocTypeDefinition>
  ): Promise<void> {
    for (const name of relatedDocTypeNames(doctype)) {
      if (related.has(name)) {
        continue;
      }
      const resolved = await this.doctypeFor(actor, name, tenantId);
      related.set(name, resolved);
      await this.resolveReachableDocTypes(resolved, actor, tenantId, related);
    }
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
  ): Promise<readonly UniqueValueReservationWrite[]> {
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
        event: this.newEvent({
          tenantId: reservation.tenantId,
          stream: reservation.stream,
          type: eventPlan.eventType,
          doctype: UNIQUE_VALUE_DOCTYPE,
          documentName: eventPlan.documentName,
          actorId: actor.id,
          occurredAt,
          payload: eventPlan.payload,
          metadata: eventPlan.metadata
        })
      };
    });
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

  private async releaseUniqueValues(
    actor: Actor,
    reservations: readonly UniqueValueReservation[],
    occurredAt: string,
    options: { readonly suppressErrors?: boolean } = {}
  ): Promise<void> {
    for (const reservation of reservations) {
      try {
        const existing = foldDocument(await this.store.readStream(reservation.stream));
        const decision = planUniqueValueReleaseWriteDecision({ reservation, existing });
        if (decision.status === "skip") {
          continue;
        }
        const eventPlan = planUniqueValueReleaseEvent(decision.reservation);
        const event = this.newEvent({
          tenantId: decision.existing.tenantId,
          stream: decision.reservation.stream,
          type: eventPlan.eventType,
          doctype: UNIQUE_VALUE_DOCTYPE,
          documentName: eventPlan.documentName,
          actorId: actor.id,
          occurredAt,
          payload: eventPlan.payload,
          metadata: eventPlan.metadata
        });
        await this.store.commit(decision.reservation.stream, decision.existing.version, [event], (savedEvents) => {
          const saved = requireFirstSavedEvent(savedEvents);
          return projectUniqueValueReleaseWrite({ existing: decision.existing, saved });
        });
      } catch (error) {
        if (!options.suppressErrors) {
          throw error;
        }
      }
    }
  }

  private async runAfterCommit(
    doctype: DocTypeDefinition,
    event: DomainEvent,
    snapshot: DocumentSnapshot | null
  ): Promise<DocumentSnapshot | null> {
    const context = documentAfterCommitContext({ doctype, event, snapshot });
    for (const hook of this.registry.hooksFor(doctype.name)) {
      try {
        await hook.afterCommit?.(context);
      } catch (error) {
        await this.onHookError?.(error, event);
      }
    }
    try {
      await this.afterCommit?.(context);
    } catch (error) {
      await this.onHookError?.(error, event);
    }
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
    context: { readonly actor: Actor; readonly tenantId: string; readonly now: string }
  ): Promise<string> {
    const naming = doctype.naming ?? { kind: "uuid" };
    if (naming.kind !== "series") {
      return resolveDocumentName(doctype, data, this.ids);
    }
    return this.allocateSeriesName(doctype, naming.pattern, context);
  }

  private async allocateSeriesName(
    doctype: DocTypeDefinition,
    pattern: string,
    context: { readonly actor: Actor; readonly tenantId: string; readonly now: string }
  ): Promise<string> {
    const stream = namingSeriesStream(context.tenantId, doctype.name, pattern);
    for (let attempt = 0; attempt < NAMING_SERIES_MAX_ATTEMPTS; attempt += 1) {
      const existing = foldDocument(await this.store.readStream(stream));
      const current = namingSeriesCurrentValue(existing?.data.current) ?? 0;
      const next = current + 1;
      const eventPlan = planNamingSeriesEvent({
        doctypeName: doctype.name,
        pattern,
        next,
        existing
      });
      const event = this.newEvent({
        tenantId: context.tenantId,
        stream,
        type: eventPlan.eventType,
        doctype: NAMING_SERIES_DOCTYPE,
        documentName: eventPlan.documentName,
        actorId: context.actor.id,
        occurredAt: context.now,
        payload: eventPlan.payload,
        metadata: eventPlan.metadata
      });
      try {
        await this.store.commit(stream, existing?.version ?? 0, [event], (savedEvents) => {
          const saved = requireFirstSavedEvent(savedEvents);
          if (!existing) {
            return snapshotFromDocumentCreatedEvent(saved);
          }
          return snapshotFromCommittedDocumentEvent(existing, saved, {
            data: { ...existing.data, current: next }
          });
        });
        return renderNamingSeries(pattern, next);
      } catch (error) {
        if (isDocumentConflict(error) && attempt + 1 < NAMING_SERIES_MAX_ATTEMPTS) {
          continue;
        }
        throw error;
      }
    }
    throw conflict(`Could not allocate naming series '${pattern}' for ${doctype.name}`);
  }
}

function isDocumentConflict(error: unknown): boolean {
  return error instanceof FrameworkError && error.code === "DOCUMENT_CONFLICT";
}
