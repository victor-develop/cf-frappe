import { FrameworkError } from "./errors";
import type {
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  DomainEvent,
  MutableDocumentData,
  ValidationIssue
} from "./types";

export type MaybePromise<T> = T | Promise<T>;

export interface HookContext {
  readonly doctype: DocTypeDefinition;
  readonly data: DocumentData;
  readonly existing?: DocumentSnapshot;
}

export interface AfterCommitContext extends HookContext {
  readonly event: DomainEvent;
  readonly snapshot: DocumentSnapshot | null;
}

export interface DocumentHooks {
  readonly beforeValidate?: (context: HookContext) => MaybePromise<MutableDocumentData | void>;
  readonly validate?: (context: HookContext) => MaybePromise<readonly ValidationIssue[] | void>;
  readonly afterCommit?: (context: AfterCommitContext) => MaybePromise<void>;
}

export interface RegistryOptions {
  readonly doctypes?: readonly DocTypeDefinition[];
  readonly hooks?: Readonly<Record<string, readonly DocumentHooks[]>>;
}

export class ModelRegistry {
  private readonly doctypes = new Map<string, DocTypeDefinition>();
  private readonly hooks = new Map<string, DocumentHooks[]>();

  constructor(options: RegistryOptions = {}) {
    for (const doctype of options.doctypes ?? []) {
      this.registerDocType(doctype);
    }
    for (const [doctype, hooks] of Object.entries(options.hooks ?? {})) {
      for (const hook of hooks) {
        this.registerHooks(doctype, hook);
      }
    }
  }

  registerDocType(doctype: DocTypeDefinition): void {
    if (this.doctypes.has(doctype.name)) {
      throw new FrameworkError("DOCTYPE_DUPLICATE", `DocType '${doctype.name}' is already registered`, {
        status: 409
      });
    }
    this.doctypes.set(doctype.name, doctype);
  }

  registerHooks(doctype: string, hooks: DocumentHooks): void {
    this.hooks.set(doctype, [...(this.hooks.get(doctype) ?? []), hooks]);
  }

  get(doctype: string): DocTypeDefinition {
    const definition = this.doctypes.get(doctype);
    if (!definition) {
      throw new FrameworkError("DOCTYPE_NOT_FOUND", `DocType '${doctype}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  has(doctype: string): boolean {
    return this.doctypes.has(doctype);
  }

  list(): readonly DocTypeDefinition[] {
    return [...this.doctypes.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  hooksFor(doctype: string): readonly DocumentHooks[] {
    return this.hooks.get(doctype) ?? [];
  }
}

export function createRegistry(options: RegistryOptions = {}): ModelRegistry {
  return new ModelRegistry(options);
}
