import type {
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  DomainEvent,
  MutableDocumentData,
  ValidationIssue
} from "./types.js";
import { compactData } from "./schema.js";

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

export function documentHookContext(input: {
  readonly doctype: DocTypeDefinition;
  readonly data: MutableDocumentData;
  readonly existing?: DocumentSnapshot | undefined;
}): HookContext {
  const data = compactData(input.data);
  return input.existing === undefined
    ? { doctype: input.doctype, data }
    : { doctype: input.doctype, data, existing: input.existing };
}

export function mergeDocumentHookPatch(
  current: MutableDocumentData,
  patch: MutableDocumentData | void
): MutableDocumentData {
  return patch ? { ...current, ...patch } : current;
}

export function documentValidationHookData(input: {
  readonly data: MutableDocumentData;
  readonly existing?: DocumentSnapshot | undefined;
  readonly override?: DocumentData | undefined;
}): DocumentData {
  if (input.override !== undefined) {
    return input.override;
  }
  const data = compactData(input.data);
  return input.existing === undefined ? data : { ...input.existing.data, ...data };
}
