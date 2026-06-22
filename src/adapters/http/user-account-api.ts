import { Hono } from "hono";
import type { UserAccountService } from "../../application/user-account-service.js";
import { badRequest } from "../../core/errors.js";
import type { JsonValue } from "../../core/types.js";
import type { ActorResolver } from "./actor.js";
import { readJsonObject, requestMetadata } from "./request.js";

export interface UserAccountApiOptions {
  readonly userAccounts: UserAccountService;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createUserAccountApi(options: UserAccountApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.get("/api/users/:userId", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.userAccounts.get(actor, c.req.param("userId"), c.req.query("tenant"));
    return c.json({ data });
  });

  app.post("/api/users/:userId", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.userAccounts.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.userAccounts.create({
      actor,
      userId: c.req.param("userId"),
      password: requiredString(body.password, "password"),
      roles: stringArray(body.roles, "roles"),
      ...(body.email === undefined ? {} : { email: requiredString(body.email, "email") }),
      ...(body.enabled === undefined ? {} : { enabled: booleanValue(body.enabled, "enabled") }),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data }, 201);
  });

  app.put("/api/users/:userId/password", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.userAccounts.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.userAccounts.changePassword({
      actor,
      userId: c.req.param("userId"),
      password: requiredString(body.password, "password"),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.put("/api/users/:userId/roles", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.userAccounts.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.userAccounts.changeRoles({
      actor,
      userId: c.req.param("userId"),
      roles: stringArray(body.roles, "roles"),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.post("/api/users/:userId/enable", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.userAccounts.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const data = await options.userAccounts.enable({
      actor,
      userId: c.req.param("userId"),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.post("/api/users/:userId/disable", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.userAccounts.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const data = await options.userAccounts.disable({
      actor,
      userId: c.req.param("userId"),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  return app;
}

function requiredString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${field} is required`);
  }
  return value;
}

function stringArray(value: JsonValue | undefined, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw badRequest(`${field} must be an array of strings`);
  }
  return value as readonly string[];
}

function integerValue(value: JsonValue, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest(`${field} must be an integer`);
  }
  return value;
}

function booleanValue(value: JsonValue, field: string): boolean {
  if (typeof value !== "boolean") {
    throw badRequest(`${field} must be a boolean`);
  }
  return value;
}
