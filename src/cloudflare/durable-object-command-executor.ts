import type {
  AssignDocumentCommand,
  CancelDocumentCommand,
  AddDocumentCommentCommand,
  CreateDocumentCommand,
  DeleteDocumentCommand,
  DocumentCommandExecutor,
  ExecuteDomainCommand,
  RecordDocumentActivityCommand,
  SubmitDocumentCommand,
  TransitionDocumentCommand,
  UnassignDocumentCommand,
  UpdateDocumentCommand
} from "../application/document-service";
import type { ModelRegistry } from "../core/registry";
import type { DocumentSnapshot } from "../core/types";
import { DEFAULT_TENANT_ID, type DocTypeDefinition } from "../core/types";
import type { AggregateCoordinatorCommand } from "./aggregate-coordinator";

export interface AggregateCoordinatorRpc {
  transact(command: AggregateCoordinatorCommand): Promise<DocumentSnapshot>;
}

export interface RpcDurableObjectNamespace<T> {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): T;
}

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

  update(command: UpdateDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "update" });
  }

  submit(command: SubmitDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "submit" });
  }

  cancel(command: CancelDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "cancel" });
  }

  delete(command: DeleteDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "delete" });
  }

  transition(command: TransitionDocumentCommand): Promise<DocumentSnapshot> {
    return this.stubForNamed(command).transact({ ...command, kind: "transition" });
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

  private stubForCreate(command: CreateDocumentCommand): AggregateCoordinatorRpc {
    const doctype = this.registry.get(command.doctype);
    const name = previewSeriesAggregateName(doctype) ?? command.name ?? previewName(doctype, command.data) ?? "_new";
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
