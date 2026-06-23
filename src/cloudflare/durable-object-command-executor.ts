import type {
  AssignDocumentCommand,
  CancelDocumentCommand,
  AddDocumentCommentCommand,
  BulkDocumentCommandEntry,
  BulkDocumentCommandFailure,
  BulkDocumentCommandResult,
  BulkDocumentsCommand,
  BulkCancelDocumentsCommand,
  BulkDeleteDocumentsCommand,
  BulkDeleteDocumentsResult,
  BulkSubmitDocumentsCommand,
  BulkTransitionDocumentsCommand,
  CreateDocumentCommand,
  DeleteDocumentCommand,
  DuplicateDocumentCommand,
  DocumentCommandExecutor,
  ExecuteDomainCommand,
  FollowDocumentCommand,
  RecordDocumentActivityCommand,
  RevokeDocumentShareCommand,
  ShareDocumentCommand,
  SubmitDocumentCommand,
  TagDocumentCommand,
  TransitionDocumentCommand,
  UnassignDocumentCommand,
  UntagDocumentCommand,
  UnfollowDocumentCommand,
  UpdateDocumentCommand
} from "../application/document-service.js";
import { normalizeBulkDocumentSelections } from "../application/document-service.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor, DocumentData, DocumentSnapshot } from "../core/types.js";
import { DEFAULT_TENANT_ID, type DocTypeDefinition } from "../core/types.js";
import type { AggregateCoordinatorCommand, AggregateCoordinatorTransactResult } from "./aggregate-coordinator.js";

export interface AggregateCoordinatorRpc {
  transact(command: AggregateCoordinatorCommand): Promise<DocumentSnapshot>;
  tryTransact(command: AggregateCoordinatorCommand): Promise<AggregateCoordinatorTransactResult>;
}

export interface RpcDurableObjectNamespace<T> {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): T;
}

type NamedAggregateCoordinatorCommand = Exclude<AggregateCoordinatorCommand, { readonly kind: "create" }>;

export interface DurableObjectCommandExecutorOptions {
  readonly registry: ModelRegistry;
  readonly namespace: RpcDurableObjectNamespace<AggregateCoordinatorRpc>;
}

export class DurableObjectCommandExecutor implements DocumentCommandExecutor {
  private readonly registry: ModelRegistry;
  private readonly namespace: RpcDurableObjectNamespace<AggregateCoordinatorRpc>;

  constructor(options: DurableObjectCommandExecutorOptions) {
    this.registry = options.registry;
    this.namespace = options.namespace;
  }

  create(command: CreateDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForCreate(command).transact({ ...command, kind: "create" });
  }

  duplicate(command: DuplicateDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForDuplicate(command).transact({ ...command, kind: "duplicate" });
  }

  update(command: UpdateDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "update" });
  }

  submit(command: SubmitDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "submit" });
  }

  bulkSubmit(command: BulkSubmitDocumentsCommand): Promise<BulkDocumentCommandResult> {
    return this.runBulkDocumentCommand(command, (selection) => ({
      ...bulkNamedCommand(command, selection),
      kind: "submit" as const
    }));
  }

  cancel(command: CancelDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "cancel" });
  }

  bulkCancel(command: BulkCancelDocumentsCommand): Promise<BulkDocumentCommandResult> {
    return this.runBulkDocumentCommand(command, (selection) => ({
      ...bulkNamedCommand(command, selection),
      kind: "cancel" as const
    }));
  }

  delete(command: DeleteDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "delete" });
  }

  async bulkDelete(command: BulkDeleteDocumentsCommand): Promise<BulkDeleteDocumentsResult> {
    const result = await this.runBulkDocumentCommand(command, (selection) => ({
      ...bulkNamedCommand(command, selection),
      kind: "delete" as const
    }));
    return { deleted: result.succeeded, failed: result.failed };
  }

  transition(command: TransitionDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "transition" });
  }

  bulkTransition(command: BulkTransitionDocumentsCommand): Promise<BulkDocumentCommandResult> {
    return this.runBulkDocumentCommand(command, (selection) => ({
      ...bulkNamedCommand(command, selection),
      action: command.action,
      kind: "transition" as const
    }));
  }

  private async runBulkDocumentCommand(
    command: BulkDocumentsCommand,
    buildCommand: (selection: { readonly name: string; readonly expectedVersion?: number }) => NamedAggregateCoordinatorCommand
  ): Promise<BulkDocumentCommandResult> {
    const selections = normalizeBulkDocumentSelections(command.documents);
    const succeeded: BulkDocumentCommandEntry[] = [];
    const failed: BulkDocumentCommandFailure[] = [];
    for (const selection of selections) {
      const aggregateCommand = buildCommand(selection);
      const result = await this.stubForNamed(aggregateCommand).tryTransact(aggregateCommand);
      if (result.ok) {
        succeeded.push({ name: selection.name, snapshot: result.snapshot });
      } else {
        failed.push(result.failure);
      }
    }
    return { succeeded, failed };
  }

  execute(command: ExecuteDomainCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "execute" });
  }

  comment(command: AddDocumentCommentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "comment" });
  }

  recordActivity(command: RecordDocumentActivityCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "recordActivity" });
  }

  assign(command: AssignDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "assign" });
  }

  unassign(command: UnassignDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "unassign" });
  }

  tag(command: TagDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "tag" });
  }

  untag(command: UntagDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "untag" });
  }

  follow(command: FollowDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "follow" });
  }

  unfollow(command: UnfollowDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "unfollow" });
  }

  share(command: ShareDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "share" });
  }

  revokeShare(command: RevokeDocumentShareCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "revokeShare" });
  }

  private stubForCreate(command: CreateDocumentCommand): AggregateCoordinatorRpc {
    const doctype = this.registry.get(command.doctype);
    const name = previewSeriesAggregateName(doctype) ?? command.name ?? previewName(doctype, command.data) ?? "_new";
    return this.stub(resolveTenant(command), doctype.name, name);
  }

  private stubForDuplicate(command: DuplicateDocumentCommand): AggregateCoordinatorRpc {
    const doctype = this.registry.get(command.doctype);
    const name =
      previewSeriesAggregateName(doctype) ??
      command.newName ??
      previewName(doctype, command.data ?? {}) ??
      "_new";
    return this.stub(resolveTenant(command), doctype.name, name);
  }

  private stubForNamed(command: { readonly actor: { readonly tenantId?: string }; readonly tenantId?: string; readonly doctype: string; readonly name: string }): AggregateCoordinatorRpc {
    const doctype = this.registry.get(command.doctype);
    return this.stub(resolveTenant(command), doctype.name, command.name);
  }

  private stub(tenantId: string, doctype: string, name: string): AggregateCoordinatorRpc {
    const id = this.namespace.idFromName(`${tenantId}:${doctype}:${name}`);
    return this.namespace.get(id);
  }
}

function resolveTenant(command: { readonly actor: { readonly tenantId?: string }; readonly tenantId?: string }): string {
  return command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID;
}

function bulkNamedCommand(
  command: BulkDocumentsCommand,
  selection: { readonly name: string; readonly expectedVersion?: number }
): {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata: DocumentData;
} {
  return {
    actor: command.actor,
    doctype: command.doctype,
    name: selection.name,
    ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
    ...(selection.expectedVersion === undefined ? {} : { expectedVersion: selection.expectedVersion }),
    metadata: command.metadata ?? {}
  };
}

function previewName(doctype: DocTypeDefinition, data: Record<string, unknown>): string | null {
  const naming = doctype.naming ?? { kind: "uuid" };
  if (naming.kind === "field") {
    const value = data[naming.field];
    return typeof value === "string" && value.length > 0 ? value : null;
  }
  if (naming.kind === "provided") {
    const value = data[naming.field ?? "name"];
    return typeof value === "string" && value.length > 0 ? value : null;
  }
  return null;
}

function previewSeriesAggregateName(doctype: DocTypeDefinition): string | null {
  return doctype.naming?.kind === "series" ? `_series:${doctype.naming.pattern}` : null;
}
