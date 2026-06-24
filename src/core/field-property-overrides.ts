import { FrameworkError } from "./errors.js";
import { defineDocType, validateDocumentData } from "./schema.js";
import type {
  DocTypeDefinition,
  DomainEvent,
  FieldDefinition,
  FieldPropertyOverrides,
  TenantId
} from "./types.js";

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
    if (event.payload.kind !== "FieldPropertyOverrideSaved" && event.payload.kind !== "FieldPropertyOverrideCleared") {
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
