import { domainEventPayloadKind } from "../core/domain-events.js";
import {
  DOCUMENT_SHARE_STATE_PAYLOAD_KINDS,
  foldDocumentShares,
  isDocumentShareStatePayloadKind,
  type DocumentSharePermission,
  type DocumentShareStateEventPayload,
  type DocumentShareStatePayloadKind,
  type DocumentShareState
} from "../core/document-shares.js";
import type {
  DocTypeName,
  DocumentName,
  DomainEvent,
  TenantId
} from "../core/types.js";

export type DocumentShareEventPayload = DocumentShareStateEventPayload;

export type DocumentSharePayloadKind = DocumentShareStatePayloadKind;

export const DOCUMENT_SHARE_PAYLOAD_KINDS = DOCUMENT_SHARE_STATE_PAYLOAD_KINDS;

export interface DocumentSharePayloadInput {
  readonly userId: string;
  readonly permissions: readonly DocumentSharePermission[];
}

export function documentSharedPayload(
  input: DocumentSharePayloadInput
): Extract<DocumentShareEventPayload, { readonly kind: "DocumentShared" }> {
  return {
    kind: "DocumentShared",
    userId: input.userId,
    permissions: input.permissions
  };
}

export function documentShareRevokedPayload(
  userId: string
): Extract<DocumentShareEventPayload, { readonly kind: "DocumentShareRevoked" }> {
  return { kind: "DocumentShareRevoked", userId };
}

export interface DocumentShareEventTypeOptions {
  readonly doctypeName: DocTypeName;
  readonly kind: DocumentShareEventPayload["kind"];
  readonly shareEventType?: string | undefined;
  readonly unshareEventType?: string | undefined;
}

export function documentShareEventType(options: DocumentShareEventTypeOptions): string {
  if (options.kind === "DocumentShared") {
    return options.shareEventType ?? `${options.doctypeName}Shared`;
  }
  return options.unshareEventType ?? `${options.doctypeName}ShareRevoked`;
}

export function isDocumentSharePayloadKind(kind: string): kind is DocumentSharePayloadKind {
  return isDocumentShareStatePayloadKind(kind);
}

export function isDocumentShareEvent(event: DomainEvent): event is DomainEvent<DocumentShareEventPayload> {
  return isDocumentSharePayloadKind(domainEventPayloadKind(event));
}

export interface DocumentShareStateFromEventsOptions {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
  readonly events: readonly DomainEvent[];
}

export function documentShareStateFromEvents(
  options: DocumentShareStateFromEventsOptions
): DocumentShareState {
  return foldDocumentShares(options.tenantId, options.doctype, options.name, options.events);
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly DocumentShared: Extract<
      DocumentShareEventPayload,
      { readonly kind: "DocumentShared" }
    >;
    readonly DocumentShareRevoked: Extract<
      DocumentShareEventPayload,
      { readonly kind: "DocumentShareRevoked" }
    >;
  }
}
