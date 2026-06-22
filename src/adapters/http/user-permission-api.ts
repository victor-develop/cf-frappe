import { Hono } from "hono";
import type { UserPermissionService } from "../../application/user-permission-service";
import { badRequest } from "../../core/errors";
import type { DocTypeName, DocumentName, JsonValue } from "../../core/types";
import type { ActorResolver } from "./actor";
import { readJsonObject, requestMetadata } from "./request";

export interface UserPermissionApiOptions {
  readonly userPermissions: UserPermissionService;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createUserPermissionApi(options: UserPermissionApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.get("/api/user-permissions/:userId", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.userPermissions.getUserPermissions(
      actor,
      c.req.param("userId"),
      c.req.query("tenant")
    );
    return c.json({ data });
  });

  app.post("/api/user-permissions/:userId", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const tenantId = c.req.query("tenant");
    const data = await options.userPermissions.allow({
      actor,
      userId: c.req.param("userId"),
      targetDoctype: requiredString(body.targetDoctype, "targetDoctype"),
      targetName: requiredString(body.targetName, "targetName"),
      ...(body.applicableDoctypes === undefined ? {} : { applicableDoctypes: stringArray(body.applicableDoctypes, "applicableDoctypes") }),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data }, 201);
  });

  app.delete("/api/user-permissions/:userId", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const tenantId = c.req.query("tenant");
    const data = await options.userPermissions.revoke({
      actor,
      userId: c.req.param("userId"),
      targetDoctype: requiredString(body.targetDoctype, "targetDoctype"),
      targetName: requiredString(body.targetName, "targetName"),
      ...(body.applicableDoctypes === undefined ? {} : { applicableDoctypes: stringArray(body.applicableDoctypes, "applicableDoctypes") }),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  return app;
}

function requiredString(value: JsonValue | undefined, field: string): DocTypeName | DocumentName {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${field} is required`);
  }
  return value;
}

function stringArray(value: JsonValue, field: string): readonly string[] {
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
