import { Hono } from "hono";
import type { NamingService } from "../../application/naming-service.js";
import { badRequest } from "../../core/errors.js";
import type {
  DocumentData,
  JsonValue,
  NamingSeriesExclusion,
  NamingSeriesReset,
  NamingStrategy
} from "../../core/types.js";
import type { ActorResolver } from "./actor.js";
import { readJsonObject, requestMetadata } from "./request.js";

export interface NamingApiOptions {
  readonly naming: NamingService;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createNamingApi(options: NamingApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.get("/api/naming/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.naming.get(actor, c.req.param("doctype"), c.req.query("tenant"));
    return c.json({ data });
  });

  app.put("/api/naming/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.naming.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.naming.save({
      actor,
      doctype: c.req.param("doctype"),
      strategy: strategyValue(body.strategy),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.delete("/api/naming/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.naming.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const data = await options.naming.clear({
      actor,
      doctype: c.req.param("doctype"),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.post("/api/naming/:doctype/preview", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.naming.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const data = await options.naming.preview({
      actor,
      doctype: c.req.param("doctype"),
      ...(body.data === undefined ? {} : { data: documentDataValue(body.data, "data") }),
      ...(body.count === undefined ? {} : { count: integerValue(body.count, "count") }),
      ...(tenantId === undefined ? {} : { tenantId })
    });
    return c.json({ data });
  });

  app.post("/api/naming/:doctype/counter", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.naming.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.naming.adjust({
      actor,
      doctype: c.req.param("doctype"),
      current: integerValue(body.current, "current"),
      ...(body.data === undefined ? {} : { data: documentDataValue(body.data, "data") }),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  return app;
}

function strategyValue(value: JsonValue | undefined): NamingStrategy {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw badRequest("strategy must be an object with a kind");
  }
  if (value.kind === "uuid") {
    return { kind: "uuid" };
  }
  if (value.kind === "field") {
    return { kind: "field", field: requiredString(value.field, "strategy.field") };
  }
  if (value.kind === "provided") {
    return {
      kind: "provided",
      ...(value.field === undefined ? {} : { field: requiredString(value.field, "strategy.field") })
    };
  }
  if (value.kind !== "series") {
    throw badRequest(`strategy.kind '${value.kind}' is invalid`);
  }
  return {
    kind: "series",
    pattern: requiredString(value.pattern, "strategy.pattern"),
    ...optionalString(value.targetField, "strategy.targetField", "targetField"),
    ...optionalString(value.counter, "strategy.counter", "counter"),
    ...optionalInteger(value.padding, "strategy.padding", "padding"),
    ...optionalInteger(value.start, "strategy.start", "start"),
    ...optionalInteger(value.step, "strategy.step", "step"),
    ...(value.reset === undefined ? {} : { reset: resetValue(value.reset) }),
    ...(value.scopeFields === undefined ? {} : { scopeFields: stringArray(value.scopeFields, "strategy.scopeFields") }),
    ...(value.exclusions === undefined ? {} : { exclusions: exclusionArray(value.exclusions) }),
    ...optionalInteger(value.maxAttempts, "strategy.maxAttempts", "maxAttempts")
  };
}

function exclusionArray(value: JsonValue): readonly NamingSeriesExclusion[] {
  if (!Array.isArray(value)) {
    throw badRequest("strategy.exclusions must be an array");
  }
  return value.map((entry, index) => exclusionValue(entry, `strategy.exclusions[${String(index)}]`));
}

function exclusionValue(value: JsonValue, field: string): NamingSeriesExclusion {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw badRequest(`${field} must be an object with a type`);
  }
  if (value.type === "range") {
    return {
      type: "range",
      from: integerValue(value.from, `${field}.from`),
      to: integerValue(value.to, `${field}.to`)
    };
  }
  if (value.type === "regex") {
    const flags = value.flags;
    if (flags !== undefined && flags !== "i") {
      throw badRequest(`${field}.flags may only be 'i'`);
    }
    return {
      type: "regex",
      pattern: requiredString(value.pattern, `${field}.pattern`),
      ...(flags === undefined ? {} : { flags })
    };
  }
  if (value.type === "exact" || value.type === "prefix" || value.type === "suffix" || value.type === "contains") {
    return { type: value.type, value: requiredString(value.value, `${field}.value`) };
  }
  throw badRequest(`${field}.type '${value.type}' is invalid`);
}

function resetValue(value: JsonValue): NamingSeriesReset {
  if (value === "never" || value === "year" || value === "month" || value === "day") {
    return value;
  }
  throw badRequest("strategy.reset is invalid");
}

function documentDataValue(value: JsonValue, field: string): DocumentData {
  if (!isRecord(value)) {
    throw badRequest(`${field} must be an object`);
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined)
  ));
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
  return value === undefined ? {} : { [key]: requiredString(value, field) } as { readonly [K in TKey]: string };
}

function integerValue(value: JsonValue | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw badRequest(`${field} must be a safe integer`);
  }
  return value;
}

function optionalInteger<TKey extends string>(
  value: JsonValue | undefined,
  field: string,
  key: TKey
): { readonly [K in TKey]?: number } {
  return value === undefined ? {} : { [key]: integerValue(value, field) } as { readonly [K in TKey]: number };
}

function stringArray(value: JsonValue, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw badRequest(`${field} must be an array of strings`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, JsonValue | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
