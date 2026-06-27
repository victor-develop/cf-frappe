import { Hono } from "hono";
import type { FieldPropertyService } from "../../application/field-property-service.js";
import { badRequest } from "../../core/errors.js";
import type { FieldPropertyOverrides, JsonValue } from "../../core/types.js";
import type { ActorResolver } from "./actor.js";
import { readJsonObject, requestMetadata } from "./request.js";

export interface FieldPropertyApiOptions {
  readonly fieldProperties: FieldPropertyService;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createFieldPropertyApi(options: FieldPropertyApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.get("/api/field-properties/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.fieldProperties.list(actor, c.req.param("doctype"), c.req.query("tenant"));
    return c.json({ data });
  });

  app.put("/api/field-properties/:doctype/:field", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.fieldProperties.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.fieldProperties.save({
      actor,
      doctype: c.req.param("doctype"),
      fieldName: c.req.param("field"),
      overrides: overridesValue(body.overrides),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.delete("/api/field-properties/:doctype/:field", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.fieldProperties.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const data = await options.fieldProperties.clear({
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

function overridesValue(value: JsonValue | undefined): FieldPropertyOverrides {
  if (!isRecord(value)) {
    throw badRequest("overrides must be an object");
  }
  return {
    ...optionalString(value.label, "overrides.label", "label"),
    ...optionalString(value.description, "overrides.description", "description"),
    ...optionalBoolean(value.required, "overrides.required", "required"),
    ...optionalBoolean(value.readOnly, "overrides.readOnly", "readOnly"),
    ...optionalBoolean(value.hidden, "overrides.hidden", "hidden"),
    ...optionalBoolean(value.inFormView, "overrides.inFormView", "inFormView"),
    ...optionalBoolean(value.inGlobalSearch, "overrides.inGlobalSearch", "inGlobalSearch"),
    ...optionalBoolean(value.inListView, "overrides.inListView", "inListView"),
    ...optionalBoolean(value.inListFilter, "overrides.inListFilter", "inListFilter"),
    ...optionalStringArray(value.options, "overrides.options", "options"),
    ...optionalNumber(value.min, "overrides.min", "min"),
    ...optionalNumber(value.max, "overrides.max", "max"),
    ...(value.defaultValue === undefined ? {} : { defaultValue: value.defaultValue })
  };
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
  return { [key]: value } as { readonly [K in TKey]: string };
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
    throw badRequest(`${field} must be a finite number`);
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
