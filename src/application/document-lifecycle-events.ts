import type {
  DocTypeName,
  DocStatus,
  DocumentData,
  DocumentSnapshot,
  DomainEvent
} from "../core/types.js";
import { FrameworkError, notFound } from "../core/errors.js";

export type DocumentLifecycleEventPayload =
  | {
      readonly kind: "DocumentCreated";
      readonly data: DocumentData;
      readonly docstatus: DocStatus;
    }
  | {
      readonly kind: "DocumentUpdated";
      readonly patch: DocumentData;
      readonly unset?: readonly string[];
    }
  | {
      readonly kind: "DocumentDeleted";
    }
  | {
      readonly kind: "DocumentSubmitted";
    }
  | {
      readonly kind: "DocumentCancelled";
    };

export const DOCUMENT_LIFECYCLE_PAYLOAD_KINDS = Object.freeze([
  "DocumentCreated",
  "DocumentUpdated",
  "DocumentDeleted",
  "DocumentSubmitted",
  "DocumentCancelled"
] as const);

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

export interface DocumentLifecycleEventTypeOptions {
  readonly doctypeName: DocTypeName;
  readonly kind: DocumentLifecycleEventPayload["kind"];
  readonly commandEventType?: string | undefined;
  readonly createEventType?: string | undefined;
  readonly updateEventType?: string | undefined;
  readonly submitEventType?: string | undefined;
  readonly cancelEventType?: string | undefined;
  readonly deleteEventType?: string | undefined;
}

export function documentLifecycleEventType(options: DocumentLifecycleEventTypeOptions): string {
  switch (options.kind) {
    case "DocumentCreated":
      return options.commandEventType ?? options.createEventType ?? `${options.doctypeName}Created`;
    case "DocumentUpdated":
      return options.commandEventType ?? options.updateEventType ?? `${options.doctypeName}Updated`;
    case "DocumentSubmitted":
      return options.submitEventType ?? `${options.doctypeName}Submitted`;
    case "DocumentCancelled":
      return options.cancelEventType ?? `${options.doctypeName}Cancelled`;
    case "DocumentDeleted":
      return options.deleteEventType ?? `${options.doctypeName}Deleted`;
  }
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

export interface CommittedDocumentSnapshotProjection {
  readonly data?: DocumentData | undefined;
  readonly docstatus?: DocStatus | undefined;
}

export function snapshotFromCommittedDocumentEvent(
  existing: DocumentSnapshot,
  event: DomainEvent,
  projection: CommittedDocumentSnapshotProjection = {}
): DocumentSnapshot {
  return {
    ...existing,
    version: event.sequence,
    ...(projection.docstatus !== undefined ? { docstatus: projection.docstatus } : {}),
    ...(projection.data !== undefined ? { data: projection.data } : {}),
    updatedAt: event.occurredAt
  };
}

export function requireLiveDocumentSnapshot(input: {
  readonly snapshot: DocumentSnapshot | null;
  readonly doctypeName: string;
  readonly documentName: string;
}): DocumentSnapshot {
  if (!input.snapshot) {
    throw notFound(`${input.doctypeName}/${input.documentName} was not found`);
  }
  if (input.snapshot.docstatus === "deleted") {
    throw new FrameworkError("DOCUMENT_DELETED", `${input.doctypeName}/${input.documentName} was deleted`, {
      status: 410
    });
  }
  return input.snapshot;
}

export function requireSavedEvent(events: readonly DomainEvent[], id: string): DomainEvent {
  const event = events.find((item) => item.id === id);
  if (!event) {
    throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
  }
  return event;
}

export function requireFirstSavedEvent(events: readonly DomainEvent[]): DomainEvent {
  const [event] = events;
  if (!event) {
    throw new FrameworkError("BAD_REQUEST", "Event store did not return saved event", { status: 500 });
  }
  return event;
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly DocumentCreated: Extract<
      DocumentLifecycleEventPayload,
      { readonly kind: "DocumentCreated" }
    >;
    readonly DocumentUpdated: Extract<
      DocumentLifecycleEventPayload,
      { readonly kind: "DocumentUpdated" }
    >;
    readonly DocumentDeleted: Extract<
      DocumentLifecycleEventPayload,
      { readonly kind: "DocumentDeleted" }
    >;
    readonly DocumentSubmitted: Extract<
      DocumentLifecycleEventPayload,
      { readonly kind: "DocumentSubmitted" }
    >;
    readonly DocumentCancelled: Extract<
      DocumentLifecycleEventPayload,
      { readonly kind: "DocumentCancelled" }
    >;
  }
}
