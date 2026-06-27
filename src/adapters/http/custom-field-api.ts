import { Hono } from "hono";
import type { CustomFieldService } from "../../application/custom-field-service.js";
import { badRequest } from "../../core/errors.js";
import { FIELD_TYPES, type FieldDefinition, type FieldType, type JsonValue, type ListFilterExpression } from "../../core/types.js";
import type { ActorResolver } from "./actor.js";
import { readJsonObject, requestMetadata } from "./request.js";

export interface CustomFieldApiOptions {
  readonly customFields: CustomFieldService;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createCustomFieldApi(options: CustomFieldApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.get("/api/custom-fields/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.customFields.list(actor, c.req.param("doctype"), c.req.query("tenant"));
    return c.json({ data });
  });

  app.post("/api/custom-fields/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.customFields.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.customFields.saveField({
      actor,
      doctype: c.req.param("doctype"),
      field: fieldValue(body.field),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data }, 201);
  });

  app.delete("/api/custom-fields/:doctype/:field", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.customFields.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const data = await options.customFields.disableField({
      actor,
      doctype: c.req.param("doctype"),
      fieldName: c.req.param("field"),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  return app;
}

function fieldValue(value: JsonValue | undefined): FieldDefinition {
  if (!isRecord(value)) {
    throw badRequest("field must be an object");
  }
  const type = fieldTypeValue(value.type);
  return {
    name: requiredString(value.name, "field.name"),
    type,
    ...optionalString(value.label, "field.label", "label"),
    ...optionalString(value.description, "field.description", "description"),
    ...optionalBoolean(value.required, "field.required", "required"),
    ...optionalListFilterExpression(value.mandatoryDependsOn, "field.mandatoryDependsOn", "mandatoryDependsOn"),
    ...optionalBoolean(value.readOnly, "field.readOnly", "readOnly"),
    ...optionalListFilterExpression(value.readOnlyDependsOn, "field.readOnlyDependsOn", "readOnlyDependsOn"),
    ...optionalBoolean(value.hidden, "field.hidden", "hidden"),
    ...optionalListFilterExpression(value.hiddenDependsOn, "field.hiddenDependsOn", "hiddenDependsOn"),
    ...optionalBoolean(value.printHide, "field.printHide", "printHide"),
    ...optionalBoolean(value.printHideIfNoValue, "field.printHideIfNoValue", "printHideIfNoValue"),
    ...optionalBoolean(value.unique, "field.unique", "unique"),
    ...optionalBoolean(value.noCopy, "field.noCopy", "noCopy"),
    ...optionalBoolean(value.allowOnSubmit, "field.allowOnSubmit", "allowOnSubmit"),
    ...optionalString(value.fetchFrom, "field.fetchFrom", "fetchFrom"),
    ...optionalBoolean(value.fetchIfEmpty, "field.fetchIfEmpty", "fetchIfEmpty"),
    ...optionalBoolean(value.inFormView, "field.inFormView", "inFormView"),
    ...optionalBoolean(value.inListView, "field.inListView", "inListView"),
    ...optionalBoolean(value.inListFilter, "field.inListFilter", "inListFilter"),
    ...optionalStringArray(value.options, "field.options", "options"),
    ...optionalString(value.linkTo, "field.linkTo", "linkTo"),
    ...optionalString(value.tableOf, "field.tableOf", "tableOf"),
    ...optionalNumber(value.min, "field.min", "min"),
    ...optionalNumber(value.max, "field.max", "max"),
    ...(value.defaultValue === undefined ? {} : { defaultValue: value.defaultValue })
  };
}

function fieldTypeValue(value: JsonValue | undefined): FieldType {
  if (typeof value !== "string" || !(FIELD_TYPES as readonly string[]).includes(value)) {
    throw badRequest("field.type is invalid");
  }
  return value as FieldType;
}

function optionalListFilterExpression<TKey extends string>(
  value: JsonValue | undefined,
  field: string,
  key: TKey
): { readonly [K in TKey]?: ListFilterExpression } {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw badRequest(`${field} must be an object`);
  }
  return { [key]: value } as unknown as { readonly [K in TKey]: ListFilterExpression };
}

function requiredString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${field} is required`);
  }
  return value;
}

function optionalString<TKey extends string>(
  value: JsonValue | undefined,
  field: string,
  key: TKey
): { readonly [K in TKey]?: string } {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "string") {
    throw badRequest(`${field} must be a string`);
  }
  return value.trim().length === 0 ? {} : { [key]: value } as { readonly [K in TKey]: string };
}

function optionalBoolean<TKey extends string>(
  value: JsonValue | undefined,
  field: string,
  key: TKey
): { readonly [K in TKey]?: boolean } {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "boolean") {
    throw badRequest(`${field} must be a boolean`);
  }
  return { [key]: value } as { readonly [K in TKey]: boolean };
}

function optionalStringArray<TKey extends string>(
  value: JsonValue | undefined,
  field: string,
  key: TKey
): { readonly [K in TKey]?: readonly string[] } {
  if (value === undefined) {
    return {};
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw badRequest(`${field} must be an array of strings`);
  }
  return { [key]: value } as unknown as { readonly [K in TKey]: readonly string[] };
}

function optionalNumber<TKey extends string>(
  value: JsonValue | undefined,
  field: string,
  key: TKey
): { readonly [K in TKey]?: number } {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badRequest(`${field} must be a number`);
  }
  return { [key]: value } as { readonly [K in TKey]: number };
}

function integerValue(value: JsonValue, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest(`${field} must be an integer`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, JsonValue | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
