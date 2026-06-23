import { FrameworkError } from "./errors.js";
import { defineDocType } from "./schema.js";
import type {
  DocTypeDefinition,
  DomainEvent,
  FieldDefinition,
  FormViewDefinition,
  ListViewDefinition,
  PersistedFieldDefinition,
  TenantId
} from "./types.js";

export interface CustomFieldEntry {
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly field: PersistedFieldDefinition;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CustomFieldState {
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly version: number;
  readonly fields: readonly CustomFieldEntry[];
}

export function foldCustomFields(
  tenantId: TenantId,
  doctype: string,
  events: readonly DomainEvent[]
): CustomFieldState {
  const fields = new Map<string, CustomFieldEntry>();
  let version = 0;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.payload.kind !== "CustomFieldSaved" && event.payload.kind !== "CustomFieldDisabled") {
      continue;
    }
    version = Math.max(version, event.sequence);
    if (event.payload.doctypeName !== doctype) {
      continue;
    }
    if (event.payload.kind === "CustomFieldSaved") {
      const existing = fields.get(event.payload.field.name);
      fields.set(event.payload.field.name, {
        tenantId,
        doctype,
        field: Object.freeze({ ...event.payload.field }),
        enabled: true,
        createdAt: existing?.createdAt ?? event.occurredAt,
        updatedAt: event.occurredAt
      });
      continue;
    }
    const existing = fields.get(event.payload.fieldName);
    if (existing) {
      fields.set(event.payload.fieldName, {
        ...existing,
        enabled: false,
        updatedAt: event.occurredAt
      });
    }
  }
  return Object.freeze({
    tenantId,
    doctype,
    version,
    fields: Object.freeze([...fields.values()].sort((left, right) => left.field.name.localeCompare(right.field.name)))
  });
}

export function applyCustomFieldsToDocType(
  base: DocTypeDefinition,
  state: CustomFieldState
): DocTypeDefinition {
  if (state.doctype !== base.name) {
    throw new FrameworkError(
      "CUSTOM_FIELD_INVALID",
      `Custom field state for '${state.doctype}' cannot extend DocType '${base.name}'`,
      { status: 400 }
    );
  }
  const customFields = state.fields.filter((entry) => entry.enabled).map((entry) => entry.field);
  assertNoBaseFieldCollisions(base, customFields);
  return defineDocType({
    ...base,
    fields: Object.freeze([...base.fields, ...customFields]),
    ...formViewWithCustomFields(base, customFields),
    ...listViewWithCustomFields(base, customFields)
  });
}

export function assertCustomFieldCanExtend(base: DocTypeDefinition, field: FieldDefinition): void {
  assertCustomFieldName(field.name);
  if (base.fields.some((existing) => existing.name === field.name)) {
    throw new FrameworkError(
      "CUSTOM_FIELD_INVALID",
      `Custom field '${field.name}' already exists on base DocType '${base.name}'`,
      { status: 400 }
    );
  }
  try {
    defineDocType({
      ...base,
      fields: Object.freeze([...base.fields, field])
    });
  } catch (error) {
    throw new FrameworkError(
      "CUSTOM_FIELD_INVALID",
      error instanceof Error ? error.message : `Custom field '${field.name}' is invalid`,
      { status: 400 }
    );
  }
}

function assertNoBaseFieldCollisions(base: DocTypeDefinition, fields: readonly FieldDefinition[]): void {
  for (const field of fields) {
    if (base.fields.some((existing) => existing.name === field.name)) {
      throw new FrameworkError(
        "CUSTOM_FIELD_INVALID",
        `Custom field '${field.name}' already exists on base DocType '${base.name}'`,
        { status: 400 }
      );
    }
  }
}

function formViewWithCustomFields(
  base: DocTypeDefinition,
  customFields: readonly FieldDefinition[]
): { readonly formView?: FormViewDefinition } {
  const sectionFields = customFields.filter((field) => field.inFormView).map((field) => field.name);
  const sections = base.formView?.sections;
  if (sectionFields.length === 0 || sections === undefined || sections.length === 0) {
    return {};
  }
  return {
    formView: {
      ...base.formView,
      sections: sections.map((section, index) =>
        index === sections.length - 1
          ? { ...section, fields: appendUnique(section.fields, sectionFields) }
          : section
      )
    }
  };
}

function listViewWithCustomFields(
  base: DocTypeDefinition,
  customFields: readonly FieldDefinition[]
): { readonly listView?: ListViewDefinition } {
  const listView = base.listView;
  if (!listView) {
    return {};
  }
  const columns = listView.columns === undefined
    ? undefined
    : appendUnique(listView.columns, customFields.filter((field) => field.inListView).map((field) => field.name));
  const filterFields = listView.filterFields === undefined
    ? undefined
    : appendUnique(listView.filterFields, customFields.filter((field) => field.inListFilter).map((field) => field.name));
  if (columns === undefined && filterFields === undefined) {
    return {};
  }
  return {
    listView: {
      ...listView,
      ...(columns === undefined ? {} : { columns }),
      ...(filterFields === undefined ? {} : { filterFields })
    }
  };
}

function appendUnique(base: readonly string[], additions: readonly string[]): readonly string[] {
  const seen = new Set(base);
  return Object.freeze([
    ...base,
    ...additions.filter((name) => {
      if (seen.has(name)) {
        return false;
      }
      seen.add(name);
      return true;
    })
  ]);
}

function assertCustomFieldName(name: string): void {
  if (name.trim().length === 0) {
    throw new FrameworkError("CUSTOM_FIELD_INVALID", "Custom field name is required", { status: 400 });
  }
}
