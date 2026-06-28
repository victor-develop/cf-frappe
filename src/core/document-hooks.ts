import type {
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  DomainEvent,
  MutableDocumentData,
  ValidationIssue
} from "./types.js";

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

export function defineDocumentHooks(hooks: DocumentHooks): DocumentHooks {
  return Object.freeze({
    ...(hooks.beforeValidate === undefined ? {} : { beforeValidate: hooks.beforeValidate }),
    ...(hooks.validate === undefined ? {} : { validate: hooks.validate }),
    ...(hooks.afterCommit === undefined ? {} : { afterCommit: hooks.afterCommit })
  });
}
