import { domainEventPayloadKind } from "../core/domain-events.js";
import {
  foldDocumentShares,
  type DocumentSharePermission,
  type DocumentShareState
} from "../core/document-shares.js";
import type {
  DocTypeName,
  DocumentName,
  DomainEvent,
  TenantId
} from "../core/types.js";

export type DocumentShareEventPayload =
  | {
      readonly kind: "DocumentShared";
      readonly userId: string;
      readonly permissions: readonly DocumentSharePermission[];
    }
  | {
      readonly kind: "DocumentShareRevoked";
      readonly userId: string;
    };

export type DocumentSharePayloadKind = DocumentShareEventPayload["kind"];

export const DOCUMENT_SHARE_PAYLOAD_KINDS = Object.freeze([
  "DocumentShared",
  "DocumentShareRevoked"
] as const satisfies readonly DocumentSharePayloadKind[]);

const DOCUMENT_SHARE_PAYLOAD_KIND_SET = new Set<string>(DOCUMENT_SHARE_PAYLOAD_KINDS);

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
  return DOCUMENT_SHARE_PAYLOAD_KIND_SET.has(kind);
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
