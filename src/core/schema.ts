import type {
  Actor,
  DocTypeDefinition,
  DocumentData,
  FieldDefinition,
  JsonValue,
  MutableDocumentData,
  ValidationIssue
} from "./types.js";
import { FrameworkError } from "./errors.js";
import { assertFormViewDefinition } from "./form-view.js";
import { assertListViewDefinition } from "./list-view.js";

export interface ValidationOptions {
  readonly partial?: boolean;
  readonly existing?: DocumentData;
  readonly relatedDocType?: (doctype: string) => DocTypeDefinition | undefined;
}

export function defineDocType<TData extends DocumentData>(
  definition: DocTypeDefinition<TData>
): DocTypeDefinition<TData> {
  assertIdentifier(definition.name, "doctype name");
  const seen = new Set<string>();
  for (const field of definition.fields) {
    assertIdentifier(field.name, `field name on ${definition.name}`);
    if (seen.has(field.name)) {
      throw new Error(`Duplicate field '${field.name}' on doctype '${definition.name}'`);
    }
    assertLinkFieldDefinition(definition, field);
    assertTableFieldDefinition(definition, field);
    seen.add(field.name);
  }
  assertNamingStrategyDefinition(definition);
  assertFormViewDefinition(definition);
  assertListViewDefinition(definition);
  const formView = definition.formView ? freezeFormView(definition.formView) : undefined;
  const listView = definition.listView ? freezeListView(definition.listView) : undefined;
  return Object.freeze({
    ...definition,
    fields: Object.freeze([...definition.fields]),
    ...(formView ? { formView } : {}),
    ...(listView ? { listView } : {})
  });
}

export function applyDefaults(
  definition: DocTypeDefinition,
  input: MutableDocumentData,
  context: { readonly actor: Actor; readonly now: string }
): DocumentData {
  const data: MutableDocumentData = { ...input };
  for (const field of definition.fields) {
    if (data[field.name] !== undefined || field.defaultValue === undefined) {
      continue;
    }
    data[field.name] =
      typeof field.defaultValue === "function"
        ? field.defaultValue(context)
        : field.defaultValue;
  }
  if (definition.workflow) {
    const stateField = definition.workflow.stateField ?? "workflow_state";
    if (data[stateField] === undefined) {
      data[stateField] = definition.workflow.initialState;
    }
  }
  return compactData(data);
}

export function validateDocumentData(
  definition: DocTypeDefinition,
  input: MutableDocumentData,
  options: ValidationOptions = {}
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fields = new Map(definition.fields.map((field) => [field.name, field]));

  if (!definition.allowUnknownFields) {
    for (const key of Object.keys(input)) {
      if (!fields.has(key)) {
        issues.push({
          field: key,
          code: "unknown_field",
          message: `Field '${key}' is not defined on ${definition.name}`
        });
      }
    }
  }

  for (const field of definition.fields) {
    const value = input[field.name];
    const isOmitted = value === undefined;
    const isMissing =
      isOmitted ||
      value === null ||
      value === "" ||
      (field.type === "table" && Array.isArray(value) && value.length === 0);
    if (field.required && isMissing && (!options.partial || !isOmitted)) {
      issues.push({
        field: field.name,
        code: "required",
        message: `Field '${field.name}' is required`
      });
      continue;
    }
    if (options.partial && isOmitted) {
      continue;
    }
    if (isMissing) {
      continue;
    }
    issues.push(...validateField(field, value, options));
  }

  return issues;
}

export function compactData(input: MutableDocumentData): DocumentData {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as DocumentData;
}

function validateField(
  field: FieldDefinition,
  value: JsonValue,
  options: ValidationOptions
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fail = (code: string, message: string) => issues.push({ field: field.name, code, message });

  switch (field.type) {
    case "text":
    case "longText":
    case "date":
    case "datetime":
    case "link":
      if (typeof value !== "string") {
        fail("type", `Field '${field.name}' must be a string`);
      }
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        fail("type", `Field '${field.name}' must be an integer`);
      }
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        fail("type", `Field '${field.name}' must be a number`);
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        fail("type", `Field '${field.name}' must be a boolean`);
      }
      break;
    case "json":
      break;
    case "table":
      issues.push(...validateTableField(field, value, options));
      break;
    case "select":
      if (typeof value !== "string") {
        fail("type", `Field '${field.name}' must be a string`);
      } else if (field.options && !field.options.includes(value)) {
        fail("option", `Field '${field.name}' must be one of ${field.options.join(", ")}`);
      }
      break;
  }

  if (typeof value === "string") {
    if (field.min !== undefined && value.length < field.min) {
      fail("min", `Field '${field.name}' must be at least ${field.min} characters`);
    }
    if (field.max !== undefined && value.length > field.max) {
      fail("max", `Field '${field.name}' must be at most ${field.max} characters`);
    }
  }
  if (typeof value === "number") {
    if (field.min !== undefined && value < field.min) {
      fail("min", `Field '${field.name}' must be at least ${field.min}`);
    }
    if (field.max !== undefined && value > field.max) {
      fail("max", `Field '${field.name}' must be at most ${field.max}`);
    }
  }

  return issues;
}

function validateTableField(
  field: FieldDefinition,
  value: JsonValue,
  options: ValidationOptions
): readonly ValidationIssue[] {
  if (!Array.isArray(value)) {
    return [
      {
        field: field.name,
        code: "type",
        message: `Field '${field.name}' must be a table array`
      }
    ];
  }
  const child = field.tableOf ? options.relatedDocType?.(field.tableOf) : undefined;
  if (!child) {
    return [
      {
        field: field.name,
        code: "table_target",
        message: `Field '${field.name}' references unavailable child DocType '${field.tableOf ?? ""}'`
      }
    ];
  }
  return value.flatMap((row, index) => {
    if (!isJsonObject(row)) {
      return [
        {
          field: `${field.name}[${index}]`,
          code: "type",
          message: `Row ${index + 1} in '${field.name}' must be an object`
        }
      ];
    }
    return validateDocumentData(child, { ...row }, { ...options, partial: false }).map((issue) => ({
      ...issue,
      field: `${field.name}[${index}]${issue.field ? `.${issue.field}` : ""}`
    }));
  });
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_ ]*$/.test(value)) {
    throw new Error(`Invalid ${label}: '${value}'`);
  }
}

function assertNamingStrategyDefinition(doctype: DocTypeDefinition): void {
  const naming = doctype.naming;
  if (!naming || naming.kind !== "series") {
    return;
  }
  if (naming.pattern.trim().length === 0 || !/#+/.test(naming.pattern)) {
    throw new FrameworkError(
      "DOCTYPE_NAMING_INVALID",
      `Naming series on ${doctype.name} must include at least one # placeholder`,
      { status: 400 }
    );
  }
}

function assertLinkFieldDefinition(doctype: DocTypeDefinition, field: FieldDefinition): void {
  if (field.type === "link") {
    if (!field.linkTo) {
      throw new FrameworkError(
        "DOCTYPE_LINK_INVALID",
        `Link field '${field.name}' on ${doctype.name} must declare linkTo`,
        { status: 400 }
      );
    }
    assertIdentifier(field.linkTo, `link target on ${doctype.name}.${field.name}`);
    return;
  }
  if (field.linkTo !== undefined) {
    throw new FrameworkError(
      "DOCTYPE_LINK_INVALID",
      `Field '${field.name}' on ${doctype.name} declares linkTo but is not a link field`,
      { status: 400 }
    );
  }
}

function assertTableFieldDefinition(doctype: DocTypeDefinition, field: FieldDefinition): void {
  if (field.type === "table") {
    if (!field.tableOf) {
      throw new FrameworkError(
        "DOCTYPE_TABLE_INVALID",
        `Table field '${field.name}' on ${doctype.name} must declare tableOf`,
        { status: 400 }
      );
    }
    assertIdentifier(field.tableOf, `table target on ${doctype.name}.${field.name}`);
    return;
  }
  if (field.tableOf !== undefined) {
    throw new FrameworkError(
      "DOCTYPE_TABLE_INVALID",
      `Field '${field.name}' on ${doctype.name} declares tableOf but is not a table field`,
      { status: 400 }
    );
  }
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function freezeFormView(formView: NonNullable<DocTypeDefinition["formView"]>): NonNullable<DocTypeDefinition["formView"]> {
  return Object.freeze({
    ...formView,
    ...(formView.sections
      ? {
          sections: Object.freeze(
            formView.sections.map((section) =>
              Object.freeze({
                ...section,
                fields: Object.freeze([...section.fields])
              })
            )
          )
        }
      : {})
  });
}

function freezeListView(listView: NonNullable<DocTypeDefinition["listView"]>): NonNullable<DocTypeDefinition["listView"]> {
  return Object.freeze({
    ...listView,
    ...(listView.columns ? { columns: Object.freeze([...listView.columns]) } : {}),
    ...(listView.filterFields ? { filterFields: Object.freeze([...listView.filterFields]) } : {}),
    ...(listView.filters ? { filters: Object.freeze([...listView.filters]) } : {})
  });
}
