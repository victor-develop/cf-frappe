import type { WebFormResolvedField } from "../../application/web-form-service.js";
import { badRequest } from "../../core/errors.js";
import type { JsonValue } from "../../core/types.js";

export function webFormDataFromBody(
  body: Record<string, JsonValue | undefined>
): Record<string, JsonValue | undefined> {
  const data = body.data;
  if (data === undefined) {
    return body;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw badRequest("Web form data must be an object");
  }
  return data as Record<string, JsonValue | undefined>;
}

export function dataFromWebFormData(
  formData: FormData,
  fields: readonly WebFormResolvedField[]
): Record<string, JsonValue | undefined> {
  const allowedFields = new Set(fields.map((field) => field.field));
  const submittedFields = new Set<string>();
  formData.forEach((_value, field) => submittedFields.add(field));
  for (const field of submittedFields) {
    if (!allowedFields.has(field)) {
      throw badRequest(`Web form field '${field}' is not configured`);
    }
    if (formData.getAll(field).length !== 1) {
      throw badRequest(`Web form field '${field}' must be supplied once`);
    }
  }
  const data: Record<string, JsonValue | undefined> = {};
  for (const field of fields) {
    if (field.serverSupplied === true) {
      if (formData.has(field.field)) {
        throw badRequest(`Web form field '${field.field}' is server-supplied`);
      }
      continue;
    }
    data[field.field] = valueFromWebFormData(formData.get(field.field), field);
  }
  return data;
}

export function valueFromWebFormData(
  value: FormDataEntryValue | null,
  field: WebFormResolvedField
): JsonValue | undefined {
  if (field.type === "boolean") {
    return value !== null;
  }
  if (value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw badRequest(`Web form field '${field.field}' must be text`);
  }
  if (field.type === "integer") {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      throw badRequest(`Web form field '${field.field}' must be an integer`);
    }
    return parsed;
  }
  if (field.type === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw badRequest(`Web form field '${field.field}' must be a number`);
    }
    return parsed;
  }
  if (field.type === "json") {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      throw badRequest(`Web form field '${field.field}' must contain valid JSON`);
    }
  }
  return value;
}
