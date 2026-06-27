import {
  applyDocumentDataChange,
  foldDocument,
  foldDocumentAssignments,
  foldDocumentFollowers,
  foldDocumentTags
} from "../core/events.js";
import {
  documentShareAllows,
  documentShareGrantKey,
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
  normalizeActivity,
  normalizeAssigneeId,
  normalizeCommentText,
  normalizeFollowerId,
  normalizeTag,
  normalizeValidDocumentShareGrant,
  normalizeValidDocumentShareUserId
} from "./document-collaboration-policy.js";
import {
  bulkNamedCommand,
  bulkDocumentFailure,
  normalizeBulkDocumentSelections
} from "./document-bulk-policy.js";
import {
  ensureDocumentStatus,
  ensureExpectedVersion,
  ensureMergeBaseVersion,
  mergeSnapshotFromDocument,
  normalizeUnsetFields,
  pickCommandFields
} from "./document-command-policy.js";
import {
  domainCommandAppliedPayload,
  workflowTransitionedPayload
} from "./document-command-events.js";
import {
  documentActivityRecordedPayload,
  documentAssignmentPayload,
  documentCommentAddedPayload,
  documentFollowerPayload,
  documentTagPayload,
  type DocumentAssignmentEventKind,
  type DocumentCollaborationEventPayload,
  type DocumentFollowerEventKind,
  type DocumentTagEventKind
} from "./document-collaboration-events.js";
import {
  documentCreatedPayload,
  documentDeletedPayload,
  documentStatusChangedPayload,
  documentUpdatedPayload,
  snapshotFromDocumentCreatedEvent
} from "./document-lifecycle-events.js";
import {
  documentSharedPayload,
  documentShareRevokedPayload
} from "./document-share-events.js";
import {
  activeUniqueValueOwner,
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
  renderNamingSeries,
  resolveDocumentName
} from "./document-naming.js";
import {
  isEmptyFetchedTarget,
  isMutableData,
  parseFetchFrom,
  relatedDocTypeNames
} from "./document-reference-policy.js";
import { resolveTenant } from "./document-tenant-policy.js";
import {
  allowOnSubmitIssues,
  childTableOriginIssues,
  copyDocumentData,
  documentUnsetIssues,
  preserveReadOnlyTableValues,
  readonlyIssues,
  stripInternalTableFields
} from "./document-field-policy.js";
import { documentStream, namingSeriesStream } from "../core/streams.js";
import {
  documentMatchesUserPermissions,
  linkTargetMatchesUserPermissions,
  type UserPermissionProvider
} from "../core/user-permissions.js";
import { allowedWorkflowTransitions, currentWorkflowState } from "../core/workflow.js";
import type { ModelRegistry } from "../core/registry.js";
import type { AfterCommitContext } from "../core/registry.js";
import type { Clock } from "../ports/clock.js";
import { systemClock } from "../ports/clock.js";
import type { DocumentStore } from "../ports/document-store.js";
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
  notFound,
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

type RelatedDocTypeResolver = (doctype: string) => DocTypeDefinition | undefined;

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
    const event = this.newEvent({
      tenantId,
      stream,
      type: command.eventType ?? doctype.events?.create ?? `${doctype.name}Created`,
      doctype: doctype.name,
      documentName: name,
      actorId: command.actor.id,
      occurredAt: now,
      payload: documentCreatedPayload(data, "draft"),
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
            this.projectUniqueReservationWrite(write, requireSavedEvent(savedEvents, write.event.id))
          )
        };
      }
    );
    const saved = commit.events.find((item) => item.id === event.id);
    if (saved) {
      return await this.runAfterCommit(doctype, saved, commit.snapshot) ?? commit.snapshot;
    }
    return commit.snapshot;
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
    const payload = documentUpdatedPayload(normalizedPatch, unset);
    const event = this.newEvent({
      tenantId: options.tenantId,
      stream: options.stream,
      type: options.command.eventType ?? options.doctype.events?.update ?? `${options.doctype.name}Updated`,
      doctype: options.doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      payload,
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
          snapshot: {
            ...options.existing,
            version: saved.sequence,
            data,
            updatedAt: saved.occurredAt
          },
          auxiliarySnapshots: uniqueReservationWrites.map((write) =>
            this.projectUniqueReservationWrite(write, requireSavedEvent(savedEvents, write.event.id))
          )
        };
      }
    );
    const saved = commit.events.find((item) => item.id === event.id);
    if (saved) {
      await this.releaseUniqueValues(options.command.actor, releasedReservations, saved.occurredAt, {
        suppressErrors: true
      });
      return await this.runAfterCommit(options.doctype, saved, commit.snapshot) ?? commit.snapshot;
    }
    return commit.snapshot;
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
    const data = copyDocumentData(
      doctype,
      {
        ...copyDocumentData(doctype, existing.data, relatedDocType, { skipNoCopy: true }),
        ...compactData(command.data ?? {})
      },
      relatedDocType
    );
    return this.create({
      actor: command.actor,
      doctype: doctype.name,
      data,
      ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
      ...(command.newName === undefined ? {} : { name: command.newName }),
      ...(command.eventType === undefined ? {} : { eventType: command.eventType }),
      metadata: {
        ...(command.metadata ?? {}),
        duplicatedFrom: existing.name,
        duplicatedFromVersion: existing.version
      }
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
    const data = copyDocumentData(
      doctype,
      {
        ...existing.data,
        ...compactData(command.data ?? {})
      },
      relatedDocType
    );
    return this.create({
      actor: command.actor,
      doctype: doctype.name,
      data,
      ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
      ...(command.newName === undefined ? {} : { name: command.newName }),
      ...(command.eventType === undefined ? {} : { eventType: command.eventType }),
      metadata: {
        ...(command.metadata ?? {}),
        amendedFrom: existing.name,
        amendedFromVersion: existing.version
      }
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

    const currentState = currentWorkflowState(workflow, existing);
    const transition = allowedWorkflowTransitions({
      actor: command.actor,
      workflow,
      document: existing
    }).find((item) => item.action === command.action);
    if (!transition) {
      throw new FrameworkError(
        "WORKFLOW_TRANSITION_DENIED",
        `Transition '${command.action}' is not allowed from '${currentState}'`,
        { status: 409 }
      );
    }

    const patch: DocumentData = { [workflow.stateField ?? "workflow_state"]: transition.to };
    const payload = workflowTransitionedPayload({
      action: command.action,
      from: currentState,
      to: transition.to,
      patch
    });
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type:
        transition.eventType ??
        `${doctype.name}${command.action[0]?.toUpperCase() ?? ""}${command.action.slice(1)}`,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload,
      metadata: command.metadata ?? {}
    });
    const commit = await this.store.commit(stream, existing.version, [event], ([saved]) => {
      if (!saved) {
        throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
      }
      return {
        ...existing,
        version: saved.sequence,
        data: { ...existing.data, ...patch },
        updatedAt: saved.occurredAt
      };
    });
    const [saved] = commit.events;
    if (saved) {
      return await this.runAfterCommit(doctype, saved, commit.snapshot) ?? commit.snapshot;
    }
    return commit.snapshot;
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
    const permissionAction = commandDefinition.permissionAction ?? "update";
    if (!(await this.canActOnDocument(command.actor, doctype, permissionAction, existing))) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot execute ${command.command} on ${doctype.name}/${command.name}`);
    }
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    const roleAllowed =
      commandDefinition.roles === undefined ||
      commandDefinition.roles.some((role) => command.actor.roles.includes(role));
    if (!roleAllowed) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot execute ${command.command}`);
    }
    ensureExpectedVersion(existing, command.expectedVersion);
    ensureDocumentStatus(existing, ["draft"], `execute ${command.command}`);

    const input = compactData(command.input);
    const sanitizedInput = stripInternalTableFields(doctype, input, relatedDocType);
    const now = this.clock.now();
    const patch = commandDefinition.buildPatch
      ? commandDefinition.buildPatch({ actor: command.actor, document: existing, input, now })
      : pickCommandFields(commandDefinition.fields, input);
    const normalizedPatch = await this.runBeforeValidate(doctype, compactData(patch), existing);
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
    const readOnlyIssues = commandDefinition.allowReadOnlyFields
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
    const commit = await this.store.commit(stream, existing.version, [event], ([saved]) => {
      if (!saved) {
        throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
      }
      return {
        ...existing,
        version: saved.sequence,
        data: { ...existing.data, ...patchWithReadOnlyValues },
        updatedAt: saved.occurredAt
      };
    });
    const [saved] = commit.events;
    if (saved) {
      return await this.runAfterCommit(doctype, saved, commit.snapshot) ?? commit.snapshot;
    }
    return commit.snapshot;
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
    const payload = documentCommentAddedPayload(normalizeCommentText(command.text));
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: doctype.events?.comment ?? `${doctype.name}CommentAdded`,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload,
      metadata: command.metadata ?? {}
    });
    const commit = await this.store.commit(stream, existing.version, [event], ([saved]) => {
      if (!saved) {
        throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
      }
      return {
        ...existing,
        version: saved.sequence,
        updatedAt: saved.occurredAt
      };
    });
    const [saved] = commit.events;
    if (saved) {
      return await this.runAfterCommit(doctype, saved, commit.snapshot) ?? commit.snapshot;
    }
    return commit.snapshot;
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
    const activity = normalizeActivity(command);
    const payload = documentActivityRecordedPayload(activity);
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: doctype.events?.activity ?? `${doctype.name}ActivityRecorded`,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload,
      metadata: command.metadata ?? {}
    });
    const commit = await this.store.commit(stream, existing.version, [event], ([saved]) => {
      if (!saved) {
        throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
      }
      return {
        ...existing,
        version: saved.sequence,
        updatedAt: saved.occurredAt
      };
    });
    const [saved] = commit.events;
    if (saved) {
      return await this.runAfterCommit(doctype, saved, commit.snapshot) ?? commit.snapshot;
    }
    return commit.snapshot;
  }

  async assign(command: AssignDocumentCommand): Promise<DocumentSnapshot> {
    return this.changeAssignment({
      command,
      eventKind: "DocumentAssigned",
      eventType: (doctype) => doctype.events?.assign ?? `${doctype.name}Assigned`,
      alreadyDone: (assignees, assigneeId) => assignees.includes(assigneeId)
    });
  }

  async unassign(command: UnassignDocumentCommand): Promise<DocumentSnapshot> {
    return this.changeAssignment({
      command,
      eventKind: "DocumentUnassigned",
      eventType: (doctype) => doctype.events?.unassign ?? `${doctype.name}Unassigned`,
      alreadyDone: (assignees, assigneeId) => !assignees.includes(assigneeId)
    });
  }

  async tag(command: TagDocumentCommand): Promise<DocumentSnapshot> {
    return this.changeTag({
      command,
      eventKind: "DocumentTagged",
      eventType: (doctype) => doctype.events?.tag ?? `${doctype.name}Tagged`,
      alreadyDone: (tags, tag) => tags.includes(tag)
    });
  }

  async untag(command: UntagDocumentCommand): Promise<DocumentSnapshot> {
    return this.changeTag({
      command,
      eventKind: "DocumentUntagged",
      eventType: (doctype) => doctype.events?.untag ?? `${doctype.name}Untagged`,
      alreadyDone: (tags, tag) => !tags.includes(tag)
    });
  }

  async follow(command: FollowDocumentCommand): Promise<DocumentSnapshot> {
    return this.changeFollower({
      command,
      eventKind: "DocumentFollowed",
      eventType: (doctype) => doctype.events?.follow ?? `${doctype.name}Followed`,
      alreadyDone: (followers, followerId) => followers.includes(followerId)
    });
  }

  async unfollow(command: UnfollowDocumentCommand): Promise<DocumentSnapshot> {
    return this.changeFollower({
      command,
      eventKind: "DocumentUnfollowed",
      eventType: (doctype) => doctype.events?.unfollow ?? `${doctype.name}Unfollowed`,
      alreadyDone: (followers, followerId) => !followers.includes(followerId)
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
    const grant = normalizeValidDocumentShareGrant(command);
    if (!staticShareAllowed) {
      ensureSharedGrantIsDelegable(command.actor, doctype, existing, sharedPermissions, grant);
    }
    const state = foldDocumentShares(tenantId, doctype.name, command.name, events);
    const current = state.grants.find((item) => item.userId === grant.userId);
    if (current && documentShareGrantKey(current) === documentShareGrantKey(grant)) {
      return existing;
    }
    const payload = documentSharedPayload({
      userId: grant.userId,
      permissions: grant.permissions
    });
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: doctype.events?.share ?? `${doctype.name}Shared`,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload,
      metadata: command.metadata ?? {}
    });
    return this.commitActivityEvent(doctype, existing, stream, event);
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
    const userId = normalizeValidDocumentShareUserId(command.userId);
    const state = foldDocumentShares(tenantId, doctype.name, command.name, events);
    if (state.grants.every((grant) => grant.userId !== userId)) {
      return existing;
    }
    const payload = documentShareRevokedPayload(userId);
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: doctype.events?.unshare ?? `${doctype.name}ShareRevoked`,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload,
      metadata: command.metadata ?? {}
    });
    return this.commitActivityEvent(doctype, existing, stream, event);
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
    ensureDocumentStatus(existing, ["draft", "cancelled"], "delete");

    const now = this.clock.now();
    const uniqueReservations = uniqueValueReservations(tenantId, doctype, existing.data, existing.name);
    const event = this.newEvent({
      tenantId,
      stream,
      type: doctype.events?.delete ?? `${doctype.name}Deleted`,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload: documentDeletedPayload(),
      metadata: command.metadata ?? {}
    });
    const commit = await this.store.commit(stream, existing.version, [event], ([saved]) => {
      if (!saved) {
        throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
      }
      return {
        ...existing,
        version: saved.sequence,
        docstatus: "deleted" as const,
        updatedAt: saved.occurredAt
      };
    });
    const [saved] = commit.events;
    if (saved) {
      await this.releaseUniqueValues(command.actor, uniqueReservations, saved.occurredAt, { suppressErrors: true });
      return await this.runAfterCommit(doctype, saved, commit.snapshot) ?? commit.snapshot;
    }
    return commit.snapshot;
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
    ensureDocumentStatus(existing, ["draft"], "submit");
    return this.changeDocStatus({
      command,
      doctype,
      tenantId,
      stream,
      existing,
      nextStatus: "submitted",
      eventType: doctype.events?.submit ?? `${doctype.name}Submitted`,
      payloadKind: "DocumentSubmitted"
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
    ensureDocumentStatus(existing, ["submitted"], "cancel");
    return this.changeDocStatus({
      command,
      doctype,
      tenantId,
      stream,
      existing,
      nextStatus: "cancelled",
      eventType: doctype.events?.cancel ?? `${doctype.name}Cancelled`,
      payloadKind: "DocumentCancelled"
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
    const existing = foldDocument(events);
    if (!existing) {
      throw notFound(`${doctype.name}/${name} was not found`);
    }
    if (existing.docstatus === "deleted") {
      throw new FrameworkError("DOCUMENT_DELETED", `${doctype.name}/${name} was deleted`, { status: 410 });
    }
    return { snapshot: existing, events };
  }

  private async changeAssignment(options: {
    readonly command: AssignDocumentCommand | UnassignDocumentCommand;
    readonly eventKind: DocumentAssignmentEventKind;
    readonly eventType: (doctype: DocTypeDefinition) => string;
    readonly alreadyDone: (assignees: readonly string[], assigneeId: string) => boolean;
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
    const assigneeId = normalizeAssigneeId(options.command.assignee);
    if (options.alreadyDone(foldDocumentAssignments(events), assigneeId)) {
      return existing;
    }
    const payload = documentAssignmentPayload(options.eventKind, assigneeId);
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: options.eventType(doctype),
      doctype: doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      payload,
      metadata: options.command.metadata ?? {}
    });
    const commit = await this.store.commit(stream, existing.version, [event], ([saved]) => {
      if (!saved) {
        throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
      }
      return {
        ...existing,
        version: saved.sequence,
        updatedAt: saved.occurredAt
      };
    });
    const [saved] = commit.events;
    if (saved) {
      return await this.runAfterCommit(doctype, saved, commit.snapshot) ?? commit.snapshot;
    }
    return commit.snapshot;
  }

  private async changeTag(options: {
    readonly command: TagDocumentCommand | UntagDocumentCommand;
    readonly eventKind: DocumentTagEventKind;
    readonly eventType: (doctype: DocTypeDefinition) => string;
    readonly alreadyDone: (tags: readonly string[], tag: string) => boolean;
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
    const tag = normalizeTag(options.command.tag);
    if (options.alreadyDone(foldDocumentTags(events), tag)) {
      return existing;
    }
    const payload = documentTagPayload(options.eventKind, tag);
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: options.eventType(doctype),
      doctype: doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      payload,
      metadata: options.command.metadata ?? {}
    });
    const commit = await this.store.commit(stream, existing.version, [event], ([saved]) => {
      if (!saved) {
        throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
      }
      return {
        ...existing,
        version: saved.sequence,
        updatedAt: saved.occurredAt
      };
    });
    const [saved] = commit.events;
    if (saved) {
      return await this.runAfterCommit(doctype, saved, commit.snapshot) ?? commit.snapshot;
    }
    return commit.snapshot;
  }

  private async changeFollower(options: {
    readonly command: FollowDocumentCommand | UnfollowDocumentCommand;
    readonly eventKind: DocumentFollowerEventKind;
    readonly eventType: (doctype: DocTypeDefinition) => string;
    readonly alreadyDone: (followers: readonly string[], followerId: string) => boolean;
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
    const followerId = normalizeFollowerId(options.command.follower ?? options.command.actor.id);
    if (options.alreadyDone(foldDocumentFollowers(events), followerId)) {
      return existing;
    }
    const payload = documentFollowerPayload(options.eventKind, followerId);
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: options.eventType(doctype),
      doctype: doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      payload,
      metadata: options.command.metadata ?? {}
    });
    const commit = await this.store.commit(stream, existing.version, [event], ([saved]) => {
      if (!saved) {
        throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
      }
      return {
        ...existing,
        version: saved.sequence,
        updatedAt: saved.occurredAt
      };
    });
    const [saved] = commit.events;
    if (saved) {
      return await this.runAfterCommit(doctype, saved, commit.snapshot) ?? commit.snapshot;
    }
    return commit.snapshot;
  }

  private async commitActivityEvent(
    doctype: DocTypeDefinition,
    existing: DocumentSnapshot,
    stream: string,
    event: NewDomainEvent
  ): Promise<DocumentSnapshot> {
    const commit = await this.store.commit(stream, existing.version, [event], ([saved]) => {
      if (!saved) {
        throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
      }
      return {
        ...existing,
        version: saved.sequence,
        updatedAt: saved.occurredAt
      };
    });
    const [saved] = commit.events;
    if (saved) {
      return await this.runAfterCommit(doctype, saved, commit.snapshot) ?? commit.snapshot;
    }
    return commit.snapshot;
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
    const commit = await this.store.commit(options.stream, options.existing.version, [event], ([saved]) => {
      if (!saved) {
        throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
      }
      return {
        ...options.existing,
        version: saved.sequence,
        docstatus: options.nextStatus,
        updatedAt: saved.occurredAt
      };
    });
    const [saved] = commit.events;
    if (saved) {
      return await this.runAfterCommit(options.doctype, saved, commit.snapshot) ?? commit.snapshot;
    }
    return commit.snapshot;
  }

  private async runBeforeValidate(
    doctype: DocTypeDefinition,
    data: DocumentData,
    existing?: DocumentSnapshot
  ): Promise<DocumentData> {
    let current: MutableDocumentData = { ...data };
    for (const hook of this.registry.hooksFor(doctype.name)) {
      const context = existing
        ? { doctype, data: compactData(current), existing }
        : { doctype, data: compactData(current) };
      const patch = await hook.beforeValidate?.(context);
      if (patch) {
        current = { ...current, ...patch };
      }
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
    const hookData = hookDataOverride ?? (existing ? { ...existing.data, ...compactData(data) } : compactData(data));
    for (const hook of this.registry.hooksFor(doctype.name)) {
      const context = existing
        ? { doctype, data: hookData, existing }
        : { doctype, data: hookData };
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
    const enriched: MutableDocumentData = { ...data };
    const explicitFields = new Set(Object.keys(data));
    const hasExisting = options.existing !== undefined;
    for (const field of doctype.fields) {
      if (field.fetchFrom === undefined || explicitFields.has(field.name)) {
        continue;
      }
      const fetchPath = parseFetchFrom(field.fetchFrom);
      if (!fetchPath) {
        continue;
      }
      const linkField = doctype.fields.find((candidate) => candidate.name === fetchPath.linkField);
      if (!linkField || linkField.type !== "link") {
        continue;
      }
      if (hasExisting && !Object.prototype.hasOwnProperty.call(data, linkField.name)) {
        continue;
      }
      const existingValue = options.existing?.data[field.name];
      if (field.fetchIfEmpty === true && !isEmptyFetchedTarget(enriched[field.name] ?? existingValue)) {
        continue;
      }
      const linkValue = enriched[linkField.name] ?? options.existing?.data[linkField.name];
      if (typeof linkValue !== "string" || linkValue.length === 0) {
        continue;
      }
      const targetDoctype = relatedDocType(linkField.linkTo ?? "");
      if (!targetDoctype) {
        continue;
      }
      const target = await this.readDocumentFromEvents(tenantId, targetDoctype, linkValue);
      if (!target || !(await this.canReadLinkedDocument(actor, doctype, linkField, targetDoctype, target))) {
        continue;
      }
      const fetchedValue = target.data[fetchPath.sourceField];
      if (fetchedValue !== undefined) {
        enriched[field.name] = fetchedValue;
      }
    }
    return compactData(enriched);
  }

  private async validateLinks(
    actor: Actor,
    tenantId: string,
    doctype: DocTypeDefinition,
    data: MutableDocumentData,
    relatedDocType: RelatedDocTypeResolver
  ): Promise<readonly ValidationIssue[]> {
    return this.validateLinksInData(actor, tenantId, doctype, data, relatedDocType);
  }

  private async validateLinksInData(
    actor: Actor,
    tenantId: string,
    doctype: DocTypeDefinition,
    data: MutableDocumentData,
    relatedDocType: RelatedDocTypeResolver,
    pathPrefix = ""
  ): Promise<readonly ValidationIssue[]> {
    const linkableFields = doctype.fields.filter(
      (field) =>
        (field.type === "link" || field.type === "table") &&
        Object.prototype.hasOwnProperty.call(data, field.name)
    );
    if (linkableFields.length === 0) {
      return [];
    }
    const issues = await Promise.all(
      linkableFields.map(async (field): Promise<readonly ValidationIssue[]> => {
        const value = data[field.name];
        const fieldPath = `${pathPrefix}${field.name}`;
        if (field.type === "table") {
          if (!Array.isArray(value) || !field.tableOf) {
            return [];
          }
          const child = relatedDocType(field.tableOf);
          if (!child) {
            return [];
          }
          const rowIssues = await Promise.all(
            value.map((row, index) =>
              isMutableData(row)
                ? this.validateLinksInData(actor, tenantId, child, row, relatedDocType, `${fieldPath}[${index}].`)
                : Promise.resolve([])
            )
          );
          return rowIssues.flat();
        }
        if (typeof value !== "string" || value.length === 0) {
          return [];
        }
        const targetDoctype = relatedDocType(field.linkTo ?? "");
        if (!targetDoctype) {
          return [];
        }
        const target = await this.readDocumentFromEvents(tenantId, targetDoctype, value);
        if (target && await this.canReadLinkedDocument(actor, doctype, field, targetDoctype, target)) {
          return [];
        }
        return [
          {
            field: fieldPath,
            code: "link_not_found",
            message: `Field '${field.name}' references missing ${targetDoctype.name}/${value}`
          }
        ];
      })
    );
    return issues.flat();
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
    return documentMatchesUserPermissions(doctype, document, grants ?? []);
  }

  private async matchesLinkUserPermissions(
    actor: Actor,
    sourceDoctype: DocTypeDefinition,
    field: FieldDefinition,
    target: DocumentSnapshot
  ): Promise<boolean> {
    const grants = await this.userPermissions?.permissionsFor(actor, target.tenantId);
    return linkTargetMatchesUserPermissions(sourceDoctype, field, target, grants ?? []);
  }

  private async canReadLinkedDocument(
    actor: Actor,
    sourceDoctype: DocTypeDefinition,
    field: FieldDefinition,
    targetDoctype: DocTypeDefinition,
    target: DocumentSnapshot
  ): Promise<boolean> {
    return (
      target.docstatus !== "deleted" &&
      (await this.canActOnDocument(actor, targetDoctype, "read", target)) &&
      (await this.matchesLinkUserPermissions(actor, sourceDoctype, field, target))
    );
  }

  private async canActOnDocument(
    actor: Actor,
    doctype: DocTypeDefinition,
    action: Parameters<typeof can>[2],
    document: DocumentSnapshot
  ): Promise<boolean> {
    if (can(actor, doctype, action, document)) {
      return true;
    }
    const permissions = await this.documentShares?.sharedPermissionsFor(actor, document);
    return documentShareAllows(permissions ?? [], action);
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
      const owner = activeUniqueValueOwner(existing);
      if (owner === reservation.documentName) {
        continue;
      }
      if (owner !== undefined && (await this.uniqueReservationOwnerStillOwnsValue(reservation, owner))) {
        throw conflict(
          `Unique field '${reservation.field}' on ${reservation.doctype} already uses value '${reservation.valueLabel}'`
        );
      }
      planned.push({ reservation, existing });
    }
    return planned.map(({ reservation, existing }) => ({
      reservation,
      existing,
      event: this.newEvent({
        tenantId: reservation.tenantId,
        stream: reservation.stream,
        type: existing ? "UniqueValueReserved" : "UniqueValueStarted",
        doctype: UNIQUE_VALUE_DOCTYPE,
        documentName: `${reservation.doctype}:${reservation.field}:${reservation.valueKey}`,
        actorId: actor.id,
        occurredAt,
        payload: existing
          ? documentUpdatedPayload({
              active: true,
              documentName: reservation.documentName
            })
          : documentCreatedPayload({
              doctype: reservation.doctype,
              field: reservation.field,
              value: reservation.valueLabel,
              valueKey: reservation.valueKey,
              documentName: reservation.documentName,
              active: true
            }, "draft"),
        metadata: { target_doctype: reservation.doctype, target_field: reservation.field }
      })
    }));
  }

  private projectUniqueReservationWrite(
    write: UniqueValueReservationWrite,
    saved: DomainEvent
  ): DocumentSnapshot {
    if (!write.existing) {
      return snapshotFromDocumentCreatedEvent(saved);
    }
    return {
      ...write.existing,
      version: saved.sequence,
      data: { ...write.existing.data, documentName: write.reservation.documentName, active: true },
      updatedAt: saved.occurredAt
    };
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
        if (!existing || activeUniqueValueOwner(existing) !== reservation.documentName) {
          continue;
        }
        const event = this.newEvent({
          tenantId: existing.tenantId,
          stream: reservation.stream,
          type: "UniqueValueReleased",
          doctype: UNIQUE_VALUE_DOCTYPE,
          documentName: `${reservation.doctype}:${reservation.field}:${reservation.valueKey}`,
          actorId: actor.id,
          occurredAt,
          payload: documentUpdatedPayload({ active: false }),
          metadata: { target_doctype: reservation.doctype, target_field: reservation.field }
        });
        await this.store.commit(reservation.stream, existing.version, [event], ([saved]) => {
          if (!saved) {
            throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
          }
          return {
            ...existing,
            version: saved.sequence,
            data: { ...existing.data, active: false },
            updatedAt: saved.occurredAt
          };
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
    const context = { doctype, data: snapshot?.data ?? {}, event, snapshot };
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
      const event = this.newEvent({
        tenantId: context.tenantId,
        stream,
        type: existing ? "NamingSeriesAdvanced" : "NamingSeriesStarted",
        doctype: NAMING_SERIES_DOCTYPE,
        documentName: `${doctype.name}:${pattern}`,
        actorId: context.actor.id,
        occurredAt: context.now,
        payload: existing
          ? documentUpdatedPayload({ current: next })
          : documentCreatedPayload({ doctype: doctype.name, pattern, current: next }, "draft"),
        metadata: { target_doctype: doctype.name }
      });
      try {
        await this.store.commit(stream, existing?.version ?? 0, [event], ([saved]) => {
          if (!saved) {
            throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
          }
          if (!existing) {
            return snapshotFromDocumentCreatedEvent(saved);
          }
          return {
            ...existing,
            version: saved.sequence,
            data: { ...existing.data, current: next },
            updatedAt: saved.occurredAt
          };
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

function requireSavedEvent(events: readonly DomainEvent[], id: string): DomainEvent {
  const event = events.find((item) => item.id === id);
  if (!event) {
    throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
  }
  return event;
}
