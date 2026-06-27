import type {
  CoreDocumentEventPayload,
  DocStatus,
  DocumentData,
  DocumentSnapshot,
  DomainEvent
} from "../core/types.js";

export type DocumentLifecycleEventPayload = CoreDocumentEventPayload;

export function documentCreatedPayload(
  data: DocumentData,
  docstatus: DocStatus
): Extract<DocumentLifecycleEventPayload, { readonly kind: "DocumentCreated" }> {
  return { kind: "DocumentCreated", data, docstatus };
}

export function documentUpdatedPayload(
  patch: DocumentData,
  unset: readonly string[] = []
): Extract<DocumentLifecycleEventPayload, { readonly kind: "DocumentUpdated" }> {
  return {
    kind: "DocumentUpdated",
    patch,
    ...(unset.length === 0 ? {} : { unset })
  };
}

export function documentDeletedPayload(): Extract<
  DocumentLifecycleEventPayload,
  { readonly kind: "DocumentDeleted" }
> {
  return { kind: "DocumentDeleted" };
}

export function documentStatusChangedPayload(
  kind: "DocumentSubmitted" | "DocumentCancelled"
): Extract<DocumentLifecycleEventPayload, { readonly kind: typeof kind }> {
  return { kind };
}

export function snapshotFromDocumentCreatedEvent(event: DomainEvent): DocumentSnapshot {
  if (event.payload.kind !== "DocumentCreated") {
    throw new Error("Expected DocumentCreated event");
  }
  return {
    tenantId: event.tenantId,
    doctype: event.doctype,
    name: event.documentName,
    version: event.sequence,
    docstatus: event.payload.docstatus,
    data: event.payload.data,
    createdAt: event.occurredAt,
    updatedAt: event.occurredAt
  };
}
