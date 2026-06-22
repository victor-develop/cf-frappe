import { foldDocument, foldDocumentAssignments, foldDocumentFollowers, foldDocumentTags } from "../core/events";
import { can } from "../core/permissions";
import { applyDefaults, compactData, validateDocumentData } from "../core/schema";
import { documentStream, namingSeriesStream } from "../core/streams";
import {
  documentMatchesUserPermissions,
  linkTargetMatchesUserPermissions,
  type UserPermissionProvider
} from "../core/user-permissions";
import { allowedWorkflowTransitions, currentWorkflowState } from "../core/workflow";
import type { ModelRegistry } from "../core/registry";
import type { AfterCommitContext } from "../core/registry";
import type { Clock } from "../ports/clock";
import { systemClock } from "../ports/clock";
import type { DocumentStore } from "../ports/document-store";
import type { IdGenerator } from "../ports/id-generator";
import { cryptoIdGenerator } from "../ports/id-generator";
import {
  DEFAULT_TENANT_ID,
  CHILD_TABLE_ROW_INDEX_FIELD,
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
} from "../core/types";
import { badRequest, conflict, FrameworkError, notFound, permissionDenied, validationFailed } from "../core/errors";

export interface DocumentServiceOptions {
  readonly registry: ModelRegistry;
  readonly store: DocumentStore;
  readonly userPermissions?: UserPermissionProvider;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly onHookError?: (error: unknown, event: DomainEvent) => void | Promise<void>;
  readonly afterCommit?: (context: AfterCommitContext) => void | Promise<void>;
}

export interface CreateDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly data: MutableDocumentData;
  readonly tenantId?: string;
  readonly name?: string;
  readonly metadata?: DocumentData;
}

export interface UpdateDocumentCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly patch: MutableDocumentData;
  readonly tenantId?: string;
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

export interface DocumentCommandExecutor {
  create(command: CreateDocumentCommand): Promise<DocumentSnapshot>;
  update(command: UpdateDocumentCommand): Promise<DocumentSnapshot>;
  submit(command: SubmitDocumentCommand): Promise<DocumentSnapshot>;
  cancel(command: CancelDocumentCommand): Promise<DocumentSnapshot>;
  delete(command: DeleteDocumentCommand): Promise<DocumentSnapshot>;
  transition(command: TransitionDocumentCommand): Promise<DocumentSnapshot>;
  execute(command: ExecuteDomainCommand): Promise<DocumentSnapshot>;
  comment(command: AddDocumentCommentCommand): Promise<DocumentSnapshot>;
  recordActivity(command: RecordDocumentActivityCommand): Promise<DocumentSnapshot>;
  assign(command: AssignDocumentCommand): Promise<DocumentSnapshot>;
  unassign(command: UnassignDocumentCommand): Promise<DocumentSnapshot>;
  tag(command: TagDocumentCommand): Promise<DocumentSnapshot>;
  untag(command: UntagDocumentCommand): Promise<DocumentSnapshot>;
  follow(command: FollowDocumentCommand): Promise<DocumentSnapshot>;
  unfollow(command: UnfollowDocumentCommand): Promise<DocumentSnapshot>;
}

const NAMING_SERIES_DOCTYPE = "__NamingSeries";
const NAMING_SERIES_MAX_ATTEMPTS = 10;
const MAX_COMMENT_TEXT_LENGTH = 5000;
const MAX_ACTIVITY_TYPE_LENGTH = 64;
const MAX_ACTIVITY_SUBJECT_LENGTH = 240;
const MAX_ACTIVITY_DETAIL_LENGTH = 10000;
const MAX_ACTIVITY_CHANNEL_LENGTH = 120;
const MAX_ACTIVITY_EXTERNAL_ID_LENGTH = 256;
const MAX_ASSIGNEE_ID_LENGTH = 320;
const MAX_TAG_LENGTH = 80;
const MAX_FOLLOWER_ID_LENGTH = 320;

export class DocumentService implements DocumentCommandExecutor {
  private readonly registry: ModelRegistry;
  private readonly store: DocumentStore;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly userPermissions: UserPermissionProvider | undefined;
  private readonly onHookError: ((error: unknown, event: DomainEvent) => void | Promise<void>) | undefined;
  private readonly afterCommit: ((context: AfterCommitContext) => void | Promise<void>) | undefined;

  constructor(options: DocumentServiceOptions) {
    this.registry = options.registry;
    this.store = options.store;
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.userPermissions = options.userPermissions;
    this.onHookError = options.onHookError;
    this.afterCommit = options.afterCommit;
  }

  async create(command: CreateDocumentCommand): Promise<DocumentSnapshot> {
    const doctype = this.registry.get(command.doctype);
    const tenantId = resolveTenant(command.actor, command.tenantId);
    if (!can(command.actor, doctype, "create")) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot create ${doctype.name}`);
    }
    ensureCreateNameAllowed(doctype, command.name);

    const now = this.clock.now();
    const withDefaults = applyDefaults(doctype, command.data, { actor: command.actor, now });
    const data = stripInternalTableFields(
      doctype,
      await this.runBeforeValidate(doctype, withDefaults),
      (name) => this.relatedDocType(name)
    );
    const issues = [
      ...(await this.validate(doctype, data)),
      ...(await this.validateLinks(command.actor, tenantId, doctype, data))
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
    const event = this.newEvent({
      tenantId,
      stream,
      type: doctype.events?.create ?? `${doctype.name}Created`,
      doctype: doctype.name,
      documentName: name,
      actorId: command.actor.id,
      occurredAt: now,
      payload: {
        kind: "DocumentCreated",
        data,
        docstatus: "draft"
      },
      metadata: command.metadata ?? {}
    });
    const commit = await this.store.commit(stream, 0, [event], ([saved]) => {
      if (!saved) {
        throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
      }
      return snapshotFromCreate(saved);
    });
    const [saved] = commit.events;
    if (saved) {
      await this.runAfterCommit(doctype, saved, commit.snapshot);
    }
    return commit.snapshot;
  }

  async update(command: UpdateDocumentCommand): Promise<DocumentSnapshot> {
    const doctype = this.registry.get(command.doctype);
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    if (!can(command.actor, doctype, "update", existing)) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot update ${doctype.name}/${command.name}`);
    }
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    ensureDocumentStatus(existing, ["draft"], "update");

    const patch = await this.runBeforeValidate(doctype, compactData(command.patch), existing);
    const patchWithoutInternalFields = stripInternalTableFields(doctype, patch, (name) => this.relatedDocType(name));
    const originIssues = childTableOriginIssues(doctype, patch, existing.data, (name) => this.relatedDocType(name));
    const readOnlyIssues = readonlyIssues(doctype, patchWithoutInternalFields, (name) => this.relatedDocType(name));
    const normalizedPatch = preserveReadOnlyTableValues(doctype, patch, existing, (name) => this.relatedDocType(name));
    const validationIssues = await this.validate(doctype, normalizedPatch, existing);
    const linkIssues = await this.validateLinks(command.actor, tenantId, doctype, normalizedPatch);
    const issues = [...originIssues, ...readOnlyIssues, ...validationIssues, ...linkIssues];
    if (issues.length > 0) {
      throw validationFailed(issues);
    }

    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: command.eventType ?? doctype.events?.update ?? `${doctype.name}Updated`,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload: { kind: "DocumentUpdated", patch: normalizedPatch },
      metadata: command.metadata ?? {}
    });
    const commit = await this.store.commit(stream, existing.version, [event], ([saved]) => {
      if (!saved) {
        throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
      }
      return {
        ...existing,
        version: saved.sequence,
        data: { ...existing.data, ...normalizedPatch },
        updatedAt: saved.occurredAt
      };
    });
    const [saved] = commit.events;
    if (saved) {
      await this.runAfterCommit(doctype, saved, commit.snapshot);
    }
    return commit.snapshot;
  }

  async transition(command: TransitionDocumentCommand): Promise<DocumentSnapshot> {
    const doctype = this.registry.get(command.doctype);
    const workflow = doctype.workflow;
    if (!workflow) {
      throw new FrameworkError("BAD_REQUEST", `${doctype.name} has no workflow`, { status: 400 });
    }
    const tenantId = resolveTenant(command.actor, command.tenantId);
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
      payload: {
        kind: "WorkflowTransitioned",
        action: command.action,
        from: currentState,
        to: transition.to,
        patch
      },
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
      await this.runAfterCommit(doctype, saved, commit.snapshot);
    }
    return commit.snapshot;
  }

  async execute(command: ExecuteDomainCommand): Promise<DocumentSnapshot> {
    const doctype = this.registry.get(command.doctype);
    const commandDefinition = doctype.commands?.find((item) => item.name === command.command);
    if (!commandDefinition) {
      throw new FrameworkError("BAD_REQUEST", `${doctype.name} has no command '${command.command}'`, {
        status: 400
      });
    }
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    const permissionAction = commandDefinition.permissionAction ?? "update";
    if (!can(command.actor, doctype, permissionAction, existing)) {
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
    const sanitizedInput = stripInternalTableFields(doctype, input, (name) => this.relatedDocType(name));
    const now = this.clock.now();
    const patch = commandDefinition.buildPatch
      ? commandDefinition.buildPatch({ actor: command.actor, document: existing, input, now })
      : pickCommandFields(commandDefinition.fields, input);
    const normalizedPatch = await this.runBeforeValidate(doctype, compactData(patch), existing);
    const patchWithoutInternalFields = stripInternalTableFields(doctype, normalizedPatch, (name) => this.relatedDocType(name));
    const originIssues = childTableOriginIssues(doctype, normalizedPatch, existing.data, (name) => this.relatedDocType(name));
    const readOnlyIssues = readonlyIssues(doctype, patchWithoutInternalFields, (name) => this.relatedDocType(name));
    const patchWithReadOnlyValues = preserveReadOnlyTableValues(
      doctype,
      normalizedPatch,
      existing,
      (name) => this.relatedDocType(name)
    );
    const validationIssues = await this.validate(doctype, patchWithReadOnlyValues, existing);
    const linkIssues = await this.validateLinks(command.actor, tenantId, doctype, patchWithReadOnlyValues);
    const issues = [...originIssues, ...readOnlyIssues, ...validationIssues, ...linkIssues];
    if (issues.length > 0) {
      throw validationFailed(issues);
    }

    const event = this.newEvent({
      tenantId,
      stream,
      type: commandDefinition.eventType,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload: {
        kind: "DomainCommandApplied",
        command: command.command,
        input: sanitizedInput,
        patch: patchWithReadOnlyValues
      },
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
      await this.runAfterCommit(doctype, saved, commit.snapshot);
    }
    return commit.snapshot;
  }

  async comment(command: AddDocumentCommentCommand): Promise<DocumentSnapshot> {
    const doctype = this.registry.get(command.doctype);
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    if (!can(command.actor, doctype, "comment", existing)) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot comment on ${doctype.name}/${command.name}`);
    }
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    const text = normalizeCommentText(command.text);
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: doctype.events?.comment ?? `${doctype.name}CommentAdded`,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload: { kind: "DocumentCommentAdded", text },
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
      await this.runAfterCommit(doctype, saved, commit.snapshot);
    }
    return commit.snapshot;
  }

  async recordActivity(command: RecordDocumentActivityCommand): Promise<DocumentSnapshot> {
    const doctype = this.registry.get(command.doctype);
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    if (!can(command.actor, doctype, "activity", existing)) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot record activity on ${doctype.name}/${command.name}`);
    }
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    const activity = normalizeActivity(command);
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: doctype.events?.activity ?? `${doctype.name}ActivityRecorded`,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload: {
        kind: "DocumentActivityRecorded",
        activityType: activity.activityType,
        subject: activity.subject,
        ...(activity.detail !== undefined ? { detail: activity.detail } : {}),
        ...(activity.channel !== undefined ? { channel: activity.channel } : {}),
        ...(activity.externalId !== undefined ? { externalId: activity.externalId } : {})
      },
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
      await this.runAfterCommit(doctype, saved, commit.snapshot);
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

  async delete(command: DeleteDocumentCommand): Promise<DocumentSnapshot> {
    const doctype = this.registry.get(command.doctype);
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    if (!can(command.actor, doctype, "delete", existing)) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot delete ${doctype.name}/${command.name}`);
    }
    await this.ensureUserPermissionAccess(command.actor, doctype, existing);
    ensureExpectedVersion(existing, command.expectedVersion);
    ensureDocumentStatus(existing, ["draft", "cancelled"], "delete");

    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: doctype.events?.delete ?? `${doctype.name}Deleted`,
      doctype: doctype.name,
      documentName: command.name,
      actorId: command.actor.id,
      occurredAt: now,
      payload: { kind: "DocumentDeleted" },
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
      await this.runAfterCommit(doctype, saved, commit.snapshot);
    }
    return commit.snapshot;
  }

  async submit(command: SubmitDocumentCommand): Promise<DocumentSnapshot> {
    const doctype = this.registry.get(command.doctype);
    const tenantId = resolveTenant(command.actor, command.tenantId);
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
    const doctype = this.registry.get(command.doctype);
    const tenantId = resolveTenant(command.actor, command.tenantId);
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
    readonly eventKind: "DocumentAssigned" | "DocumentUnassigned";
    readonly eventType: (doctype: DocTypeDefinition) => string;
    readonly alreadyDone: (assignees: readonly string[], assigneeId: string) => boolean;
  }): Promise<DocumentSnapshot> {
    const doctype = this.registry.get(options.command.doctype);
    const tenantId = resolveTenant(options.command.actor, options.command.tenantId);
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
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: options.eventType(doctype),
      doctype: doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      payload: { kind: options.eventKind, assigneeId },
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
      await this.runAfterCommit(doctype, saved, commit.snapshot);
    }
    return commit.snapshot;
  }

  private async changeTag(options: {
    readonly command: TagDocumentCommand | UntagDocumentCommand;
    readonly eventKind: "DocumentTagged" | "DocumentUntagged";
    readonly eventType: (doctype: DocTypeDefinition) => string;
    readonly alreadyDone: (tags: readonly string[], tag: string) => boolean;
  }): Promise<DocumentSnapshot> {
    const doctype = this.registry.get(options.command.doctype);
    const tenantId = resolveTenant(options.command.actor, options.command.tenantId);
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
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: options.eventType(doctype),
      doctype: doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      payload: { kind: options.eventKind, tag },
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
      await this.runAfterCommit(doctype, saved, commit.snapshot);
    }
    return commit.snapshot;
  }

  private async changeFollower(options: {
    readonly command: FollowDocumentCommand | UnfollowDocumentCommand;
    readonly eventKind: "DocumentFollowed" | "DocumentUnfollowed";
    readonly eventType: (doctype: DocTypeDefinition) => string;
    readonly alreadyDone: (followers: readonly string[], followerId: string) => boolean;
  }): Promise<DocumentSnapshot> {
    const doctype = this.registry.get(options.command.doctype);
    const tenantId = resolveTenant(options.command.actor, options.command.tenantId);
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
    const now = this.clock.now();
    const event = this.newEvent({
      tenantId,
      stream,
      type: options.eventType(doctype),
      doctype: doctype.name,
      documentName: options.command.name,
      actorId: options.command.actor.id,
      occurredAt: now,
      payload: { kind: options.eventKind, followerId },
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
      await this.runAfterCommit(doctype, saved, commit.snapshot);
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
      payload: { kind: options.payloadKind },
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
      await this.runAfterCommit(options.doctype, saved, commit.snapshot);
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
    existing?: DocumentSnapshot
  ): Promise<readonly ValidationIssue[]> {
    const issues = [
      ...validateDocumentData(doctype, data, {
        partial: existing !== undefined,
        relatedDocType: (name) => this.relatedDocType(name)
      })
    ];
    const hookData = existing ? { ...existing.data, ...compactData(data) } : compactData(data);
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

  private async validateLinks(
    actor: Actor,
    tenantId: string,
    doctype: DocTypeDefinition,
    data: MutableDocumentData
  ): Promise<readonly ValidationIssue[]> {
    return this.validateLinksInData(actor, tenantId, doctype, data);
  }

  private async validateLinksInData(
    actor: Actor,
    tenantId: string,
    doctype: DocTypeDefinition,
    data: MutableDocumentData,
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
          const child = this.relatedDocType(field.tableOf);
          if (!child) {
            return [];
          }
          const rowIssues = await Promise.all(
            value.map((row, index) =>
              isMutableData(row)
                ? this.validateLinksInData(actor, tenantId, child, row, `${fieldPath}[${index}].`)
                : Promise.resolve([])
            )
          );
          return rowIssues.flat();
        }
        if (typeof value !== "string" || value.length === 0) {
          return [];
        }
        const targetDoctype = this.relatedDocType(field.linkTo ?? "");
        if (!targetDoctype) {
          return [];
        }
        const target = await this.readDocumentFromEvents(tenantId, targetDoctype, value);
        if (
          target &&
          target.docstatus !== "deleted" &&
          can(actor, targetDoctype, "read", target) &&
          (await this.matchesLinkUserPermissions(actor, doctype, field, target))
        ) {
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

  private relatedDocType(name: string): DocTypeDefinition | undefined {
    return this.registry.has(name) ? this.registry.get(name) : undefined;
  }

  private async readDocumentFromEvents(
    tenantId: string,
    doctype: DocTypeDefinition,
    name: string
  ): Promise<DocumentSnapshot | null> {
    return foldDocument(await this.store.readStream(documentStream(tenantId, doctype.name, name)));
  }

  private async runAfterCommit(
    doctype: DocTypeDefinition,
    event: DomainEvent,
    snapshot: DocumentSnapshot | null
  ): Promise<void> {
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
      return resolveName(doctype, data, this.ids);
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
      const current = numberField(existing?.data.current) ?? 0;
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
          ? {
              kind: "DocumentUpdated",
              patch: { current: next }
            }
          : {
              kind: "DocumentCreated",
              data: { doctype: doctype.name, pattern, current: next },
              docstatus: "draft"
            },
        metadata: { target_doctype: doctype.name }
      });
      try {
        await this.store.commit(stream, existing?.version ?? 0, [event], ([saved]) => {
          if (!saved) {
            throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
          }
          if (!existing) {
            return snapshotFromCreate(saved);
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

function resolveTenant(actor: Actor, explicitTenantId?: string): string {
  return explicitTenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID;
}

function resolveName(doctype: DocTypeDefinition, data: DocumentData, ids: IdGenerator): string {
  const naming = doctype.naming ?? { kind: "uuid" };
  if (naming.kind === "uuid") {
    return ids.next("doc_");
  }
  if (naming.kind === "field") {
    const value = data[naming.field];
    if (typeof value !== "string" || value.length === 0) {
      throw validationFailed([
        {
          field: naming.field,
          code: "name",
          message: `Field '${naming.field}' must be a non-empty string to name ${doctype.name}`
        }
      ]);
    }
    return value;
  }
  if (naming.kind === "series") {
    throw new FrameworkError("DOCTYPE_NAMING_INVALID", `Naming series for ${doctype.name} needs a document store`, {
      status: 500
    });
  }
  const field = naming.field ?? "name";
  const value = data[field];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return ids.next("doc_");
}

function ensureCreateNameAllowed(doctype: DocTypeDefinition, name: string | undefined): void {
  if (name === undefined || doctype.naming?.kind !== "series") {
    return;
  }
  throw validationFailed([
    {
      field: "name",
      code: "name",
      message: `${doctype.name} uses a naming series and cannot be created with an explicit name`
    }
  ]);
}

function renderNamingSeries(pattern: string, value: number): string {
  return pattern.replace(/#+/, (placeholder) => String(value).padStart(placeholder.length, "0"));
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isDocumentConflict(error: unknown): boolean {
  return error instanceof FrameworkError && error.code === "DOCUMENT_CONFLICT";
}

function snapshotFromCreate(event: DomainEvent): DocumentSnapshot {
  if (event.payload.kind !== "DocumentCreated") {
    throw new Error("Expected DocumentCreated event");
  }
  return {
    tenantId: event.tenantId,
    doctype: event.doctype,
    name: event.documentName,
    version: event.sequence,
    docstatus: event.payload.docstatus as DocStatus,
    data: event.payload.data,
    createdAt: event.occurredAt,
    updatedAt: event.occurredAt
  };
}

function ensureExpectedVersion(existing: DocumentSnapshot, expectedVersion?: number): void {
  if (expectedVersion !== undefined && existing.version !== expectedVersion) {
    throw conflict(`Expected version ${expectedVersion}, found ${existing.version}`);
  }
}

function ensureDocumentStatus(
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

function normalizeCommentText(text: string): string {
  const normalized = text.trim();
  if (normalized.length === 0) {
    throw badRequest("Comment text is required");
  }
  if (normalized.length > MAX_COMMENT_TEXT_LENGTH) {
    throw badRequest(`Comment text exceeds ${MAX_COMMENT_TEXT_LENGTH} characters`);
  }
  return normalized;
}

function normalizeActivity(command: RecordDocumentActivityCommand): {
  readonly activityType: string;
  readonly subject: string;
  readonly detail?: string;
  readonly channel?: string;
  readonly externalId?: string;
} {
  const activityType = normalizeOptionalText(command.activityType, {
    defaultValue: "activity",
    field: "Activity type",
    maxLength: MAX_ACTIVITY_TYPE_LENGTH
  }) ?? "activity";
  const subject = normalizeRequiredText(command.subject, "Activity subject", MAX_ACTIVITY_SUBJECT_LENGTH);
  const detail = normalizeOptionalText(command.detail, {
    field: "Activity detail",
    maxLength: MAX_ACTIVITY_DETAIL_LENGTH
  });
  const channel = normalizeOptionalText(command.channel, {
    field: "Activity channel",
    maxLength: MAX_ACTIVITY_CHANNEL_LENGTH
  });
  const externalId = normalizeOptionalText(command.externalId, {
    field: "Activity external id",
    maxLength: MAX_ACTIVITY_EXTERNAL_ID_LENGTH
  });
  return {
    activityType,
    subject,
    ...(detail !== undefined ? { detail } : {}),
    ...(channel !== undefined ? { channel } : {}),
    ...(externalId !== undefined ? { externalId } : {})
  };
}

function normalizeRequiredText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw badRequest(`${field} is required`);
  }
  if (normalized.length > maxLength) {
    throw badRequest(`${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function normalizeOptionalText(
  value: string | undefined,
  options: { readonly field: string; readonly maxLength: number; readonly defaultValue?: string }
): string | undefined {
  if (value === undefined) {
    return options.defaultValue;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return options.defaultValue;
  }
  if (normalized.length > options.maxLength) {
    throw badRequest(`${options.field} exceeds ${options.maxLength} characters`);
  }
  return normalized;
}

function normalizeAssigneeId(assignee: string): string {
  const normalized = assignee.trim();
  if (normalized.length === 0) {
    throw badRequest("Assignee is required");
  }
  if (normalized.length > MAX_ASSIGNEE_ID_LENGTH) {
    throw badRequest(`Assignee exceeds ${MAX_ASSIGNEE_ID_LENGTH} characters`);
  }
  return normalized;
}

function normalizeTag(tag: string): string {
  const normalized = tag.replaceAll(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    throw badRequest("Tag is required");
  }
  if (normalized.length > MAX_TAG_LENGTH) {
    throw badRequest(`Tag exceeds ${MAX_TAG_LENGTH} characters`);
  }
  return normalized;
}

function normalizeFollowerId(follower: string): string {
  const normalized = follower.trim();
  if (normalized.length === 0) {
    throw badRequest("Follower is required");
  }
  if (normalized.length > MAX_FOLLOWER_ID_LENGTH) {
    throw badRequest(`Follower exceeds ${MAX_FOLLOWER_ID_LENGTH} characters`);
  }
  return normalized;
}

function readonlyIssues(
  doctype: DocTypeDefinition,
  patch: MutableDocumentData,
  relatedDocType: (doctype: string) => DocTypeDefinition | undefined
): readonly ValidationIssue[] {
  const readonlyFields = new Set(doctype.fields.filter((field) => field.readOnly).map((field) => field.name));
  const topLevelIssues = Object.keys(patch)
    .filter((field) => readonlyFields.has(field))
    .map((field) => ({
      field,
      code: "readonly",
      message: `Field '${field}' is read only`
    }));
  const childIssues = doctype.fields
    .filter((field) => field.type === "table" && Object.prototype.hasOwnProperty.call(patch, field.name))
    .flatMap((field) => {
      const value = patch[field.name];
      if (!Array.isArray(value) || !field.tableOf) {
        return [];
      }
      const child = relatedDocType(field.tableOf);
      if (!child) {
        return [];
      }
      return value.flatMap((row, index) =>
        isMutableData(row)
          ? readonlyIssues(child, row, relatedDocType).map((issue) => ({
              ...issue,
              field: `${field.name}[${index}]${issue.field ? `.${issue.field}` : ""}`
            }))
          : []
      );
    });
  return [...topLevelIssues, ...childIssues];
}

function childTableOriginIssues(
  doctype: DocTypeDefinition,
  patch: MutableDocumentData,
  existingData: MutableDocumentData | undefined,
  relatedDocType: (doctype: string) => DocTypeDefinition | undefined,
  pathPrefix = ""
): readonly ValidationIssue[] {
  return doctype.fields
    .filter((field) => field.type === "table" && Object.prototype.hasOwnProperty.call(patch, field.name))
    .flatMap((field) => {
      const value = patch[field.name];
      if (!Array.isArray(value) || !field.tableOf) {
        return [];
      }
      const child = relatedDocType(field.tableOf);
      if (!child) {
        return [];
      }
      const existingValue = existingData?.[field.name];
      const existingRows = Array.isArray(existingValue) ? existingValue : [];
      const seenOrigins = new Set<number>();
      return value.flatMap((row, rowIndex) => {
        if (!isMutableData(row) || !Object.prototype.hasOwnProperty.call(row, CHILD_TABLE_ROW_INDEX_FIELD)) {
          return [];
        }
        const fieldPath = `${pathPrefix}${field.name}[${rowIndex}].${CHILD_TABLE_ROW_INDEX_FIELD}`;
        const originIndex = childRowOriginIndex(row[CHILD_TABLE_ROW_INDEX_FIELD]);
        const issues: ValidationIssue[] = [];
        if (originIndex === undefined) {
          issues.push({
            field: fieldPath,
            code: "child_row_origin",
            message: `Field '${field.name}' has an invalid child row origin`
          });
          return issues;
        }
        if (originIndex >= existingRows.length) {
          issues.push({
            field: fieldPath,
            code: "child_row_origin",
            message: `Field '${field.name}' references a child row origin outside the current table`
          });
          return issues;
        }
        if (seenOrigins.has(originIndex)) {
          issues.push({
            field: fieldPath,
            code: "child_row_origin",
            message: `Field '${field.name}' cannot reuse the same child row origin more than once`
          });
          return issues;
        }
        seenOrigins.add(originIndex);
        return [
          ...issues,
          ...childTableOriginIssues(
            child,
            row,
            isMutableData(existingRows[originIndex]) ? existingRows[originIndex] : undefined,
            relatedDocType,
            `${pathPrefix}${field.name}[${rowIndex}].`
          )
        ];
      });
    });
}

function preserveReadOnlyTableValues(
  doctype: DocTypeDefinition,
  patch: DocumentData,
  existing: DocumentSnapshot,
  relatedDocType: (doctype: string) => DocTypeDefinition | undefined
): DocumentData {
  return normalizeTableFields(doctype, patch, existing.data, relatedDocType);
}

function stripInternalTableFields(
  doctype: DocTypeDefinition,
  data: DocumentData,
  relatedDocType: (doctype: string) => DocTypeDefinition | undefined
): DocumentData {
  return normalizeTableFields(doctype, data, undefined, relatedDocType);
}

function normalizeTableFields(
  doctype: DocTypeDefinition,
  data: DocumentData,
  existingData: MutableDocumentData | undefined,
  relatedDocType: (doctype: string) => DocTypeDefinition | undefined
): DocumentData {
  const entries = Object.entries(data).map(([fieldName, value]) => {
    const field = doctype.fields.find((item) => item.name === fieldName);
    if (field?.type !== "table" || !field.tableOf || !Array.isArray(value)) {
      return [fieldName, value] as const;
    }
    const child = relatedDocType(field.tableOf);
    if (!child) {
      return [fieldName, value.map((row) => stripChildRowInternalFields(row))] as const;
    }
    const existingValue = existingData?.[fieldName];
    const existingRows = Array.isArray(existingValue) ? existingValue : undefined;
    const readOnlyChildFields = child.fields.filter((childField) => childField.readOnly);
    const rows = value.map((row) => {
      if (!isMutableData(row)) {
        return row;
      }
      const originIndex = childRowOriginIndex(row[CHILD_TABLE_ROW_INDEX_FIELD]);
      const existingRow =
        originIndex === undefined || existingRows === undefined ? undefined : existingRows[originIndex];
      const normalized = normalizeTableFields(
        child,
        stripChildRowInternalFields(row),
        isMutableData(existingRow) ? existingRow : undefined,
        relatedDocType
      ) as MutableDocumentData;
      if (!isMutableData(existingRow) || readOnlyChildFields.length === 0) {
        return normalized;
      }
      const preserved = { ...normalized };
      for (const childField of readOnlyChildFields) {
        if (
          !Object.prototype.hasOwnProperty.call(preserved, childField.name) &&
          Object.prototype.hasOwnProperty.call(existingRow, childField.name)
        ) {
          preserved[childField.name] = existingRow[childField.name];
        }
      }
      return preserved;
    });
    return [fieldName, rows] as const;
  });
  return Object.fromEntries(entries) as DocumentData;
}

function stripChildRowInternalFields(row: unknown): DocumentData {
  if (!isMutableData(row)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(row).filter(([fieldName]) => fieldName !== CHILD_TABLE_ROW_INDEX_FIELD)
  ) as DocumentData;
}

function childRowOriginIndex(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function pickCommandFields(fields: readonly string[] | undefined, input: DocumentData): DocumentData {
  if (!fields) {
    return input;
  }
  return Object.fromEntries(fields.map((field) => [field, input[field]]).filter(([, value]) => value !== undefined)) as DocumentData;
}

function isMutableData(value: unknown): value is MutableDocumentData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
