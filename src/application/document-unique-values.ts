import { uniqueValueStream } from "../core/streams.js";
import type {
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  DomainEvent,
  JsonValue,
  NewDomainEvent
} from "../core/types.js";
import { validationFailed } from "../core/errors.js";
import {
  documentCreatedPayload,
  documentUpdatedPayload,
  snapshotFromCommittedDocumentEvent,
  snapshotFromDocumentCreatedEvent,
  type DocumentLifecycleEventPayload
} from "./document-lifecycle-events.js";

export const UNIQUE_VALUE_DOCTYPE = "__UniqueValues";
const MAX_UNIQUE_VALUE_KEY_LENGTH = 512;

export interface UniqueValueReservation {
  readonly tenantId: string;
  readonly stream: string;
  readonly doctype: string;
  readonly field: string;
  readonly valueKey: string;
  readonly valueLabel: string;
  readonly documentName: string;
}

export interface UniqueValueEventPlan {
  readonly eventType: "UniqueValueStarted" | "UniqueValueReserved" | "UniqueValueReleased";
  readonly documentName: string;
  readonly payload: Extract<DocumentLifecycleEventPayload, { readonly kind: "DocumentCreated" | "DocumentUpdated" }>;
  readonly metadata: DocumentData;
}

export type UniqueValueReservationWriteDecision =
  | { readonly status: "skip" }
  | { readonly status: "conflict"; readonly message: string }
  | {
      readonly status: "reserve";
      readonly reservation: UniqueValueReservation;
      readonly existing: DocumentSnapshot | null;
    };

export type UniqueValueReleaseWriteDecision =
  | { readonly status: "skip" }
  | {
      readonly status: "release";
      readonly reservation: UniqueValueReservation;
      readonly existing: DocumentSnapshot;
    };

export type UniqueValueReservationOwnerLookup =
  | { readonly status: "skip"; readonly ownerStillOwnsValue: false }
  | { readonly status: "read-owner"; readonly documentName: string };

export interface UniqueValueReservationWriteProjection {
  readonly reservation: UniqueValueReservation;
  readonly existing: DocumentSnapshot | null;
  readonly saved: DomainEvent;
}

export interface UniqueValueReleaseWriteProjection {
  readonly existing: DocumentSnapshot;
  readonly saved: DomainEvent;
}

export function uniqueValueReservations(
  tenantId: string,
  doctype: DocTypeDefinition,
  data: DocumentData,
  documentName: string
): readonly UniqueValueReservation[] {
  return doctype.fields.flatMap((field) => {
    if (!field.unique) {
      return [];
    }
    const value = canonicalUniqueValue(data[field.name], field.name);
    if (value === undefined) {
      return [];
    }
    return [
      {
        tenantId,
        stream: uniqueValueStream(tenantId, doctype.name, field.name, value.key),
        doctype: doctype.name,
        field: field.name,
        valueKey: value.key,
        valueLabel: value.label,
        documentName
      }
    ];
  });
}

export function canonicalUniqueValue(
  value: JsonValue | undefined,
  fieldName: string
): { readonly key: string; readonly label: string } | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    if (value.length === 0) {
      return undefined;
    }
    return boundedUniqueValue(`s:${value}`, value, fieldName);
  }
  if (typeof value === "number") {
    return boundedUniqueValue(`n:${String(value)}`, String(value), fieldName);
  }
  if (typeof value === "boolean") {
    return boundedUniqueValue(`b:${String(value)}`, String(value), fieldName);
  }
  throw validationFailed([
    {
      field: fieldName,
      code: "unique",
      message: `Field '${fieldName}' must be scalar to enforce uniqueness`
    }
  ]);
}

export function activeUniqueValueOwner(snapshot: DocumentSnapshot | null): string | undefined {
  if (!snapshot || snapshot.docstatus === "deleted" || snapshot.data.active === false) {
    return undefined;
  }
  const owner = snapshot.data.documentName;
  return typeof owner === "string" && owner.length > 0 ? owner : undefined;
}

export function uniqueReservationOwnerStillOwnsValue(
  reservation: UniqueValueReservation,
  owner: DocumentSnapshot | null
): boolean {
  if (!owner || owner.docstatus === "deleted") {
    return false;
  }
  const value = canonicalUniqueValue(owner.data[reservation.field], reservation.field);
  return value?.key === reservation.valueKey;
}

export function releasedUniqueValueReservations(
  existing: readonly UniqueValueReservation[],
  next: readonly UniqueValueReservation[]
): readonly UniqueValueReservation[] {
  const nextKeys = new Set(next.map(uniqueValueReservationKey));
  return existing.filter((reservation) => !nextKeys.has(uniqueValueReservationKey(reservation)));
}

export function uniqueValueReservationKey(reservation: UniqueValueReservation): string {
  return `${reservation.stream}\u0000${reservation.documentName}`;
}

export function planUniqueValueReservationEvent(
  reservation: UniqueValueReservation,
  existing: DocumentSnapshot | null
): UniqueValueEventPlan {
  const documentName = uniqueValueDocumentName(reservation);
  if (existing) {
    return {
      eventType: "UniqueValueReserved",
      documentName,
      payload: documentUpdatedPayload({
        active: true,
        documentName: reservation.documentName
      }),
      metadata: uniqueValueEventMetadata(reservation)
    };
  }
  return {
    eventType: "UniqueValueStarted",
    documentName,
    payload: documentCreatedPayload({
      doctype: reservation.doctype,
      field: reservation.field,
      value: reservation.valueLabel,
      valueKey: reservation.valueKey,
      documentName: reservation.documentName,
      active: true
    }, "draft"),
    metadata: uniqueValueEventMetadata(reservation)
  };
}

export function planUniqueValueReleaseEvent(reservation: UniqueValueReservation): UniqueValueEventPlan {
  return {
    eventType: "UniqueValueReleased",
    documentName: uniqueValueDocumentName(reservation),
    payload: documentUpdatedPayload({ active: false }),
    metadata: uniqueValueEventMetadata(reservation)
  };
}

export function uniqueValueEventCommand(input: {
  readonly reservation: UniqueValueReservation;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly plan: UniqueValueEventPlan;
}): Omit<NewDomainEvent<UniqueValueEventPlan["payload"]>, "id" | "sequence"> {
  return {
    tenantId: input.reservation.tenantId,
    stream: input.reservation.stream,
    type: input.plan.eventType,
    doctype: UNIQUE_VALUE_DOCTYPE,
    documentName: input.plan.documentName,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    payload: input.plan.payload,
    metadata: input.plan.metadata
  };
}

export function planUniqueValueReservationOwnerLookup(input: {
  readonly reservation: UniqueValueReservation;
  readonly existing: DocumentSnapshot | null;
}): UniqueValueReservationOwnerLookup {
  const owner = activeUniqueValueOwner(input.existing);
  if (owner === undefined || owner === input.reservation.documentName) {
    return { status: "skip", ownerStillOwnsValue: false };
  }
  return { status: "read-owner", documentName: owner };
}

export function planUniqueValueReservationWriteDecision(input: {
  readonly reservation: UniqueValueReservation;
  readonly existing: DocumentSnapshot | null;
  readonly ownerStillOwnsValue: boolean;
}): UniqueValueReservationWriteDecision {
  const owner = activeUniqueValueOwner(input.existing);
  if (owner === input.reservation.documentName) {
    return { status: "skip" };
  }
  if (owner !== undefined && input.ownerStillOwnsValue) {
    return {
      status: "conflict",
      message: `Unique field '${input.reservation.field}' on ${input.reservation.doctype} already uses value '${input.reservation.valueLabel}'`
    };
  }
  return {
    status: "reserve",
    reservation: input.reservation,
    existing: input.existing
  };
}

export function planUniqueValueReleaseWriteDecision(input: {
  readonly reservation: UniqueValueReservation;
  readonly existing: DocumentSnapshot | null;
}): UniqueValueReleaseWriteDecision {
  const existing = input.existing;
  if (!existing || activeUniqueValueOwner(existing) !== input.reservation.documentName) {
    return { status: "skip" };
  }
  return {
    status: "release",
    reservation: input.reservation,
    existing
  };
}

export function projectUniqueValueReservationWrite(
  input: UniqueValueReservationWriteProjection
): DocumentSnapshot {
  if (!input.existing) {
    return snapshotFromDocumentCreatedEvent(input.saved);
  }
  return snapshotFromCommittedDocumentEvent(input.existing, input.saved, {
    data: { ...input.existing.data, documentName: input.reservation.documentName, active: true }
  });
}

export function projectUniqueValueReleaseWrite(
  input: UniqueValueReleaseWriteProjection
): DocumentSnapshot {
  return snapshotFromCommittedDocumentEvent(input.existing, input.saved, {
    data: { ...input.existing.data, active: false }
  });
}

function boundedUniqueValue(
  key: string,
  label: string,
  fieldName: string
): { readonly key: string; readonly label: string } {
  if (key.length > MAX_UNIQUE_VALUE_KEY_LENGTH) {
    throw validationFailed([
      {
        field: fieldName,
        code: "unique",
        message: `Field '${fieldName}' unique value exceeds ${String(MAX_UNIQUE_VALUE_KEY_LENGTH)} characters`
      }
    ]);
  }
  return { key, label };
}

function uniqueValueDocumentName(reservation: UniqueValueReservation): string {
  return `${reservation.doctype}:${reservation.field}:${reservation.valueKey}`;
}

function uniqueValueEventMetadata(reservation: UniqueValueReservation): DocumentData {
  return { target_doctype: reservation.doctype, target_field: reservation.field };
}
