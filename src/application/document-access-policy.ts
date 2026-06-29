import {
  documentShareAllows,
  type DocumentSharePermission
} from "../core/document-shares.js";
import { can } from "../core/permissions.js";
import {
  documentMatchesUserPermissions,
  linkTargetMatchesUserPermissions,
  type UserPermissionGrant
} from "../core/user-permissions.js";
import type {
  Actor,
  DocTypeDefinition,
  DocumentSnapshot,
  FieldDefinition,
  PermissionAction
} from "../core/types.js";

export interface DocumentActionAccessOptions {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
  readonly action: PermissionAction;
  readonly document: DocumentSnapshot;
  readonly sharedPermissions?: readonly DocumentSharePermission[];
}

export interface DocTypeActionAccessOptions {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
  readonly action: PermissionAction;
}

export type DocTypeActionAccessDecision =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly message: string };

export type DocumentActionAccessDecision =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly message: string };

export type DocumentUserPermissionAccessDecision =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly message: string };

export type DocumentSharedPermissionLookup =
  | { readonly status: "skip"; readonly sharedPermissions: readonly [] }
  | { readonly status: "read-shares" };

export function canUseDocTypeAction(options: DocTypeActionAccessOptions): boolean {
  return can(options.actor, options.doctype, options.action);
}

export function planDocTypeActionAccess(
  options: DocTypeActionAccessOptions
): DocTypeActionAccessDecision {
  if (canUseDocTypeAction(options)) {
    return { status: "allow" };
  }
  return {
    status: "deny",
    message: `Actor '${options.actor.id}' cannot ${options.action} ${options.doctype.name}`
  };
}

export function canUseDocumentAction(options: DocumentActionAccessOptions): boolean {
  return can(options.actor, options.doctype, options.action, options.document) ||
    documentShareAllows(options.sharedPermissions ?? [], options.action);
}

export function planDocumentActionAccess(
  options: DocumentActionAccessOptions & {
    readonly deniedAction?: string;
    readonly documentLabel?: string;
  }
): DocumentActionAccessDecision {
  if (canUseDocumentAction(options)) {
    return { status: "allow" };
  }
  const deniedAction = options.deniedAction ?? options.action;
  const documentLabel = options.documentLabel ?? `${options.doctype.name}/${options.document.name}`;
  return {
    status: "deny",
    message: `Actor '${options.actor.id}' cannot ${deniedAction} ${documentLabel}`
  };
}

export function planDocumentSharedPermissionLookup(
  options: DocumentActionAccessOptions
): DocumentSharedPermissionLookup {
  if (canUseDocumentAction(options)) {
    return { status: "skip", sharedPermissions: [] };
  }
  return { status: "read-shares" };
}

export interface DocumentVisibleAccessOptions extends DocumentActionAccessOptions {
  readonly userPermissionGrants?: readonly UserPermissionGrant[];
}

export function documentSatisfiesUserPermissions(options: {
  readonly doctype: DocTypeDefinition;
  readonly document: DocumentSnapshot;
  readonly userPermissionGrants?: readonly UserPermissionGrant[];
}): boolean {
  return documentMatchesUserPermissions(options.doctype, options.document, options.userPermissionGrants ?? []);
}

export function planDocumentUserPermissionAccess(options: {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
  readonly document: DocumentSnapshot;
  readonly userPermissionGrants?: readonly UserPermissionGrant[];
}): DocumentUserPermissionAccessDecision {
  if (documentSatisfiesUserPermissions(options)) {
    return { status: "allow" };
  }
  return {
    status: "deny",
    message: `Actor '${options.actor.id}' cannot access ${options.doctype.name}/${options.document.name}`
  };
}

export function canUseVisibleDocument(options: DocumentVisibleAccessOptions): boolean {
  return options.document.docstatus !== "deleted" &&
    canUseDocumentAction(options) &&
    documentSatisfiesUserPermissions(options);
}

export interface LinkedDocumentReadAccessOptions {
  readonly actor: Actor;
  readonly sourceDoctype: DocTypeDefinition;
  readonly field: FieldDefinition;
  readonly targetDoctype: DocTypeDefinition;
  readonly target: DocumentSnapshot;
  readonly sharedPermissions?: readonly DocumentSharePermission[];
  readonly userPermissionGrants?: readonly UserPermissionGrant[];
}

export function canReadLinkedDocumentTarget(options: LinkedDocumentReadAccessOptions): boolean {
  return options.target.docstatus !== "deleted" &&
    canUseDocumentAction({
      actor: options.actor,
      doctype: options.targetDoctype,
      action: "read",
      document: options.target,
      ...(options.sharedPermissions === undefined ? {} : { sharedPermissions: options.sharedPermissions })
    }) &&
    linkTargetMatchesUserPermissions(
      options.sourceDoctype,
      options.field,
      options.target,
      options.userPermissionGrants ?? []
    );
}
