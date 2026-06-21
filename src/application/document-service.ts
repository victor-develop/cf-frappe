import { foldDocument } from "../core/events";
import { can } from "../core/permissions";
import { applyDefaults, compactData, validateDocumentData } from "../core/schema";
import { documentStream } from "../core/streams";
import type { ModelRegistry } from "../core/registry";
import type { AfterCommitContext } from "../core/registry";
import type { Clock } from "../ports/clock";
import { systemClock } from "../ports/clock";
import type { DocumentStore } from "../ports/document-store";
import type { IdGenerator } from "../ports/id-generator";
import { cryptoIdGenerator } from "../ports/id-generator";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type DocStatus,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentSnapshot,
  type DomainEvent,
  type MutableDocumentData,
  type NewDomainEvent,
  type ValidationIssue
} from "../core/types";
import { conflict, FrameworkError, notFound, permissionDenied, validationFailed } from "../core/errors";

export interface DocumentServiceOptions {
  readonly registry: ModelRegistry;
  readonly store: DocumentStore;
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

export interface DocumentCommandExecutor {
  create(command: CreateDocumentCommand): Promise<DocumentSnapshot>;
  update(command: UpdateDocumentCommand): Promise<DocumentSnapshot>;
  delete(command: DeleteDocumentCommand): Promise<DocumentSnapshot>;
  transition(command: TransitionDocumentCommand): Promise<DocumentSnapshot>;
  execute(command: ExecuteDomainCommand): Promise<DocumentSnapshot>;
}

export class DocumentService implements DocumentCommandExecutor {
  private readonly registry: ModelRegistry;
  private readonly store: DocumentStore;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly onHookError: ((error: unknown, event: DomainEvent) => void | Promise<void>) | undefined;
  private readonly afterCommit: ((context: AfterCommitContext) => void | Promise<void>) | undefined;

  constructor(options: DocumentServiceOptions) {
    this.registry = options.registry;
    this.store = options.store;
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.onHookError = options.onHookError;
    this.afterCommit = options.afterCommit;
  }

  async create(command: CreateDocumentCommand): Promise<DocumentSnapshot> {
    const doctype = this.registry.get(command.doctype);
    const tenantId = resolveTenant(command.actor, command.tenantId);
    if (!can(command.actor, doctype, "create")) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot create ${doctype.name}`);
    }

    const now = this.clock.now();
    const withDefaults = applyDefaults(doctype, command.data, { actor: command.actor, now });
    const data = await this.runBeforeValidate(doctype, withDefaults);
    const issues = await this.validate(doctype, data);
    if (issues.length > 0) {
      throw validationFailed(issues);
    }

    const name = command.name ?? resolveName(doctype, data, this.ids);
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
    ensureExpectedVersion(existing, command.expectedVersion);

    const patch = await this.runBeforeValidate(doctype, compactData(command.patch), existing);
    const readOnlyIssues = readonlyIssues(doctype, patch);
    const validationIssues = await this.validate(doctype, patch, existing);
    const issues = [...readOnlyIssues, ...validationIssues];
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
      payload: { kind: "DocumentUpdated", patch },
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
    ensureExpectedVersion(existing, command.expectedVersion);

    const stateField = workflow.stateField ?? "workflow_state";
    const currentState = String(existing.data[stateField] ?? workflow.initialState);
    const transition = workflow.transitions.find(
      (item) => item.action === command.action && item.from === currentState
    );
    const roleAllowed =
      transition?.roles === undefined || transition.roles.some((role) => command.actor.roles.includes(role));
    if (!transition || !roleAllowed) {
      throw new FrameworkError(
        "WORKFLOW_TRANSITION_DENIED",
        `Transition '${command.action}' is not allowed from '${currentState}'`,
        { status: 409 }
      );
    }

    const patch: DocumentData = { [stateField]: transition.to };
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
    const roleAllowed =
      commandDefinition.roles === undefined ||
      commandDefinition.roles.some((role) => command.actor.roles.includes(role));
    if (!roleAllowed) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot execute ${command.command}`);
    }
    ensureExpectedVersion(existing, command.expectedVersion);

    const input = compactData(command.input);
    const now = this.clock.now();
    const patch = commandDefinition.buildPatch
      ? commandDefinition.buildPatch({ actor: command.actor, document: existing, input, now })
      : pickCommandFields(commandDefinition.fields, input);
    const normalizedPatch = await this.runBeforeValidate(doctype, compactData(patch), existing);
    const readOnlyIssues = readonlyIssues(doctype, normalizedPatch);
    const validationIssues = await this.validate(doctype, normalizedPatch, existing);
    const issues = [...readOnlyIssues, ...validationIssues];
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
        input,
        patch: normalizedPatch
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

  async delete(command: DeleteDocumentCommand): Promise<DocumentSnapshot> {
    const doctype = this.registry.get(command.doctype);
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const stream = documentStream(tenantId, doctype.name, command.name);
    const existing = await this.requireExistingFromEvents(stream, doctype, command.name);
    if (!can(command.actor, doctype, "delete", existing)) {
      throw permissionDenied(`Actor '${command.actor.id}' cannot delete ${doctype.name}/${command.name}`);
    }
    ensureExpectedVersion(existing, command.expectedVersion);

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

  private async requireExistingFromEvents(
    stream: string,
    doctype: DocTypeDefinition,
    name: string
  ): Promise<DocumentSnapshot> {
    const existing = foldDocument(await this.store.readStream(stream));
    if (!existing) {
      throw notFound(`${doctype.name}/${name} was not found`);
    }
    if (existing.docstatus === "deleted") {
      throw new FrameworkError("DOCUMENT_DELETED", `${doctype.name}/${name} was deleted`, { status: 410 });
    }
    return existing;
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
    const issues = [...validateDocumentData(doctype, data, { partial: existing !== undefined })];
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
  const field = naming.field ?? "name";
  const value = data[field];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return ids.next("doc_");
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

function readonlyIssues(doctype: DocTypeDefinition, patch: DocumentData): readonly ValidationIssue[] {
  const readonlyFields = new Set(doctype.fields.filter((field) => field.readOnly).map((field) => field.name));
  return Object.keys(patch)
    .filter((field) => readonlyFields.has(field))
    .map((field) => ({
      field,
      code: "readonly",
      message: `Field '${field}' is read only`
    }));
}

function pickCommandFields(fields: readonly string[] | undefined, input: DocumentData): DocumentData {
  if (!fields) {
    return input;
  }
  return Object.fromEntries(fields.map((field) => [field, input[field]]).filter(([, value]) => value !== undefined)) as DocumentData;
}
