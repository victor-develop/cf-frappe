import { FrameworkError } from "./errors.js";
import { domainEventPayloadKind } from "./domain-events.js";
import { defineDocType, validateDocumentData } from "./schema.js";
import type {
  DocTypeName,
  DocTypeDefinition,
  DomainEvent,
  FieldDefinition,
  FieldPropertyOverrides,
  TenantId
} from "./types.js";

export type FieldPropertyOverrideStatePayloadKind =
  | "FieldPropertyOverrideSaved"
  | "FieldPropertyOverrideCleared";

export type FieldPropertyOverrideStateEventPayload =
  | {
      readonly kind: "FieldPropertyOverrideSaved";
      readonly doctypeName: DocTypeName;
      readonly fieldName: string;
      readonly overrides: FieldPropertyOverrides;
    }
  | {
      readonly kind: "FieldPropertyOverrideCleared";
      readonly doctypeName: DocTypeName;
      readonly fieldName: string;
    };

export const FIELD_PROPERTY_OVERRIDE_STATE_PAYLOAD_KINDS = Object.freeze([
  "FieldPropertyOverrideSaved",
  "FieldPropertyOverrideCleared"
] as const satisfies readonly FieldPropertyOverrideStatePayloadKind[]);

const FIELD_PROPERTY_OVERRIDE_STATE_PAYLOAD_KIND_SET = new Set<string>(FIELD_PROPERTY_OVERRIDE_STATE_PAYLOAD_KINDS);

export interface FieldPropertyOverrideEntry {
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly fieldName: string;
  readonly overrides: FieldPropertyOverrides;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FieldPropertyOverrideState {
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly version: number;
  readonly fields: readonly FieldPropertyOverrideEntry[];
}

export function foldFieldPropertyOverrides(
  tenantId: TenantId,
  doctype: string,
  events: readonly DomainEvent[]
): FieldPropertyOverrideState {
  const fields = new Map<string, FieldPropertyOverrideEntry>();
  let version = 0;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (!isFieldPropertyOverrideStateEvent(event)) {
      continue;
    }
    version = Math.max(version, event.sequence);
    if (event.payload.doctypeName !== doctype) {
      continue;
    }
    if (event.payload.kind === "FieldPropertyOverrideSaved") {
      const existing = fields.get(event.payload.fieldName);
      fields.set(event.payload.fieldName, {
        tenantId,
        doctype,
        fieldName: event.payload.fieldName,
        overrides: Object.freeze({ ...event.payload.overrides }),
        createdAt: existing?.createdAt ?? event.occurredAt,
        updatedAt: event.occurredAt
      });
      continue;
    }
    fields.delete(event.payload.fieldName);
  }
  return Object.freeze({
    tenantId,
    doctype,
    version,
    fields: Object.freeze([...fields.values()].sort((left, right) => left.fieldName.localeCompare(right.fieldName)))
  });
}

export function fieldPropertyOverrideStateEventType(
  payload: FieldPropertyOverrideStateEventPayload
): FieldPropertyOverrideStatePayloadKind {
  return payload.kind;
}

export function isFieldPropertyOverrideStatePayloadKind(
  kind: string
): kind is FieldPropertyOverrideStatePayloadKind {
  return FIELD_PROPERTY_OVERRIDE_STATE_PAYLOAD_KIND_SET.has(kind);
}

function isFieldPropertyOverrideStateEvent(
  event: DomainEvent
): event is DomainEvent & { readonly payload: FieldPropertyOverrideStateEventPayload } {
  return isFieldPropertyOverrideStatePayloadKind(domainEventPayloadKind(event));
}

export function applyFieldPropertyOverridesToDocType(
  base: DocTypeDefinition,
  state: FieldPropertyOverrideState
): DocTypeDefinition {
  if (state.doctype !== base.name) {
    throw new FrameworkError(
      "FIELD_PROPERTY_INVALID",
      `Field property state for '${state.doctype}' cannot extend DocType '${base.name}'`,
      { status: 400 }
    );
  }
  if (state.fields.length === 0) {
    return base;
  }
  const overrides = new Map(state.fields.map((entry) => [entry.fieldName, entry.overrides]));
  for (const fieldName of overrides.keys()) {
    if (!base.fields.some((field) => field.name === fieldName)) {
      throw new FrameworkError(
        "FIELD_PROPERTY_INVALID",
        `Field property override references unknown field '${fieldName}' on ${base.name}`,
        { status: 400 }
      );
    }
  }
  const fields = base.fields.map((field) => applyOverridesToField(field, overrides.get(field.name)));
  const effective = defineDocType({ ...base, fields: Object.freeze(fields) });
  assertDefaultValuesValid(effective);
  return effective;
}

function applyOverridesToField(
  field: FieldDefinition,
  overrides: FieldPropertyOverrides | undefined
): FieldDefinition {
  if (overrides === undefined) {
    return field;
  }
  return Object.freeze({
    ...field,
    ...overrides,
    ...(overrides.options === undefined ? {} : { options: Object.freeze([...overrides.options]) })
  });
}

function assertDefaultValuesValid(doctype: DocTypeDefinition): void {
  for (const field of doctype.fields) {
    if (field.defaultValue === undefined || typeof field.defaultValue === "function") {
      continue;
    }
    const issues = validateDocumentData(doctype, { [field.name]: field.defaultValue }, { partial: true });
    if (issues.length > 0) {
      throw new FrameworkError("FIELD_PROPERTY_INVALID", issues[0]?.message ?? "Field default value is invalid", {
        status: 400,
        issues
      });
    }
  }
}
