import { Hono } from "hono";
import type { RoleService } from "../../application/role-service";
import { badRequest } from "../../core/errors";
import type { JsonValue } from "../../core/types";
import type { ActorResolver } from "./actor";
import { readJsonObject, requestMetadata } from "./request";

export interface RoleApiOptions {
  readonly roles: RoleService;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createRoleApi(options: RoleApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.get("/api/roles", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.roles.list(actor, c.req.query("tenant"));
    return c.json({ data });
  });

  app.get("/api/roles/:role", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.roles.get(actor, c.req.param("role"), c.req.query("tenant"));
    return c.json({ data });
  });

  app.post("/api/roles/:role", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.roles.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const data = await options.roles.create({
      actor,
      role: c.req.param("role"),
      ...(body.description === undefined ? {} : { description: stringValue(body.description, "description") }),
      ...(body.enabled === undefined ? {} : { enabled: booleanValue(body.enabled, "enabled") }),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data }, 201);
  });

  app.put("/api/roles/:role/description", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.roles.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.roles.changeDescription({
      actor,
      role: c.req.param("role"),
      ...(body.description === undefined ? {} : { description: stringValue(body.description, "description") }),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.post("/api/roles/:role/enable", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.roles.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const data = await options.roles.enable({
      actor,
      role: c.req.param("role"),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.post("/api/roles/:role/disable", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.roles.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const data = await options.roles.disable({
      actor,
      role: c.req.param("role"),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  return app;
}

function stringValue(value: JsonValue, field: string): string {
  if (typeof value !== "string") {
    throw badRequest(`${field} must be a string`);
  }
  return value;
}

function booleanValue(value: JsonValue, field: string): boolean {
  if (typeof value !== "boolean") {
    throw badRequest(`${field} must be a boolean`);
  }
  return value;
}

function integerValue(value: JsonValue, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest(`${field} must be an integer`);
  }
  return value;
}
