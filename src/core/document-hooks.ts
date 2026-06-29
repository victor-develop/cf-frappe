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

export interface RunDocumentBeforeValidateHooksOptions {
  readonly doctype: DocTypeDefinition;
  readonly data: DocumentData;
  readonly hooks: Iterable<DocumentHooks>;
  readonly existing?: DocumentSnapshot | undefined;
}

export async function runDocumentBeforeValidateHooks(
  options: RunDocumentBeforeValidateHooksOptions
): Promise<DocumentData> {
  let current: MutableDocumentData = { ...options.data };
  for (const hook of options.hooks) {
    const context = documentHookContext({
      doctype: options.doctype,
      data: current,
      ...(options.existing === undefined ? {} : { existing: options.existing })
    });
    const patch = await hook.beforeValidate?.(context);
    current = mergeDocumentHookPatch(current, patch);
  }
  return compactData(current);
}

export interface RunDocumentValidationHooksOptions {
  readonly doctype: DocTypeDefinition;
  readonly data: MutableDocumentData;
  readonly hooks: Iterable<DocumentHooks>;
  readonly existing?: DocumentSnapshot | undefined;
  readonly hookDataOverride?: DocumentData | undefined;
}

export async function runDocumentValidationHooks(
  options: RunDocumentValidationHooksOptions
): Promise<readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const hookData = documentValidationHookData({
    data: options.data,
    ...(options.existing === undefined ? {} : { existing: options.existing }),
    ...(options.hookDataOverride === undefined ? {} : { override: options.hookDataOverride })
  });
  for (const hook of options.hooks) {
    const context = documentHookContext({
      doctype: options.doctype,
      data: hookData,
      ...(options.existing === undefined ? {} : { existing: options.existing })
    });
    const hookIssues = await hook.validate?.(context);
    if (hookIssues) {
      issues.push(...hookIssues);
    }
  }
  return issues;
}

export function documentAfterCommitContext(input: {
  readonly doctype: DocTypeDefinition;
  readonly event: DomainEvent;
  readonly snapshot: DocumentSnapshot | null;
}): AfterCommitContext {
  return {
    doctype: input.doctype,
    data: input.snapshot?.data ?? {},
    event: input.event,
    snapshot: input.snapshot
  };
}

export interface RunDocumentAfterCommitHooksOptions {
  readonly doctype: DocTypeDefinition;
  readonly event: DomainEvent;
  readonly snapshot: DocumentSnapshot | null;
  readonly hooks: Iterable<DocumentHooks>;
  readonly afterCommit?: (context: AfterCommitContext) => MaybePromise<void>;
  readonly onHookError?: (error: unknown, event: DomainEvent) => MaybePromise<void>;
}

export async function runDocumentAfterCommitHooks(
  options: RunDocumentAfterCommitHooksOptions
): Promise<void> {
  const context = documentAfterCommitContext({
    doctype: options.doctype,
    event: options.event,
    snapshot: options.snapshot
  });
  for (const hook of options.hooks) {
    try {
      await hook.afterCommit?.(context);
    } catch (error) {
      await options.onHookError?.(error, options.event);
    }
  }
  try {
    await options.afterCommit?.(context);
  } catch (error) {
    await options.onHookError?.(error, options.event);
  }
}
