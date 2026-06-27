import { uniqueValueStream } from "../core/streams.js";
import type {
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  JsonValue
} from "../core/types.js";
import { validationFailed } from "../core/errors.js";

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
