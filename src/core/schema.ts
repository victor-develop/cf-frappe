import type {
  Actor,
  DocTypeDefinition,
  DocumentData,
  FieldDefinition,
  JsonValue,
  MutableDocumentData,
  ValidationIssue
} from "./types";

export interface ValidationOptions {
  readonly partial?: boolean;
  readonly existing?: DocumentData;
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
    seen.add(field.name);
  }
  return Object.freeze({
    ...definition,
    fields: Object.freeze([...definition.fields])
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
    const isMissing = value === undefined || value === null || value === "";
    if (!options.partial && field.required && isMissing) {
      issues.push({
        field: field.name,
        code: "required",
        message: `Field '${field.name}' is required`
      });
      continue;
    }
    if (options.partial && value === undefined) {
      continue;
    }
    if (isMissing) {
      continue;
    }
    issues.push(...validateField(field, value));
  }

  return issues;
}

export function compactData(input: MutableDocumentData): DocumentData {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as DocumentData;
}

function validateField(field: FieldDefinition, value: JsonValue): readonly ValidationIssue[] {
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

function assertIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_ ]*$/.test(value)) {
    throw new Error(`Invalid ${label}: '${value}'`);
  }
}
