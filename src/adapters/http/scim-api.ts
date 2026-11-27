import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { FrameworkError } from "../../core/errors.js";
import type { JsonValue } from "../../core/types.js";
import type { ActorResolver } from "./actor.js";
import { toErrorResponse } from "./errors.js";
import { readJsonObject, requestMetadata } from "./request.js";
import type { ScimService } from "../../application/scim-service.js";
import {
  SCIM_GROUP_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_PATCH_SCHEMA,
  SCIM_USER_SCHEMA,
  parseScimListOptions,
  scimListResponse
} from "../../application/scim-policy.js";
import type { ScimTokenService } from "../../application/scim-token-service.js";

export interface ScimApiOptions {
  readonly scim: ScimService;
  readonly actor: ActorResolver;
  readonly tokens?: ScimTokenService;
  readonly tokenActor?: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createScimApi(options: ScimApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.onError((error, c) => scimErrorResponse(error, c));

  app.get("/scim/v2/ServiceProviderConfig", async (c) => {
    await options.actor(c.req.raw);
    return c.json(serviceProviderConfig());
  });

  app.get("/scim/v2/ResourceTypes", async (c) => {
    await options.actor(c.req.raw);
    return c.json(scimListResponse(resourceTypes(), 1, resourceTypes().length));
  });

  app.get("/scim/v2/ResourceTypes/:name", async (c) => {
    await options.actor(c.req.raw);
    const name = c.req.param("name");
    const resourceType = resourceTypes().find((item) => item.id === name);
    if (resourceType === undefined) {
      throw new FrameworkError("DOCUMENT_NOT_FOUND", `SCIM resource type '${name}' was not found`, { status: 404 });
    }
    return c.json(resourceType);
  });

  app.get("/scim/v2/Schemas", async (c) => {
    await options.actor(c.req.raw);
    return c.json(scimListResponse(schemas(), 1, schemas().length));
  });

  app.get("/scim/v2/Schemas/:schemaId", async (c) => {
    await options.actor(c.req.raw);
    const schemaId = c.req.param("schemaId");
    const schema = schemas().find((item) => item.id === schemaId);
    if (schema === undefined) {
      throw new FrameworkError("DOCUMENT_NOT_FOUND", `SCIM schema '${schemaId}' was not found`, { status: 404 });
    }
    return c.json(schema);
  });

  app.post("/scim/v2/Users", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.scim.createUser({
      actor,
      resource: body,
      ...tenantArgument(c),
      location: scimLocation(c.req.url, "Users", String((body as Record<string, unknown>).userName ?? "")),
      metadata: scimMetadata(c.req.raw)
    });
    return c.json(data, 201);
  });

  app.get("/scim/v2/Users", async (c) => {
    const actor = await options.actor(c.req.raw);
    const page = parseScimListOptions(c.req.raw.url ? new URL(c.req.raw.url).searchParams : new URLSearchParams());
    const list = await options.scim.listUsers({
      actor,
      ...tenantArgument(c),
      ...filterArgument(c),
      page,
      location: (userId) => scimLocation(c.req.url, "Users", userId)
    });
    return c.json(scimListResponse(list.users, page.startIndex, list.users.length + page.startIndex - 1));
  });

  app.get("/scim/v2/Users/:userId", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.scim.getUser({
      actor,
      userId: c.req.param("userId"),
      ...tenantArgument(c),
      location: scimLocation(c.req.url, "Users", c.req.param("userId"))
    });
    return c.json(data);
  });

  app.put("/scim/v2/Users/:userId", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.scim.replaceUser({
      actor,
      userId: c.req.param("userId"),
      resource: body,
      ...tenantArgument(c),
      location: scimLocation(c.req.url, "Users", c.req.param("userId")),
      metadata: scimMetadata(c.req.raw)
    });
    return c.json(data);
  });

  app.patch("/scim/v2/Users/:userId", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.scim.patchUser({
      actor,
      userId: c.req.param("userId"),
      patch: body,
      ...tenantArgument(c),
      location: scimLocation(c.req.url, "Users", c.req.param("userId")),
      metadata: scimMetadata(c.req.raw)
    });
    return c.json(data);
  });

  app.delete("/scim/v2/Users/:userId", async (c) => {
    const actor = await options.actor(c.req.raw);
    await options.scim.deleteUser({
      actor,
      userId: c.req.param("userId"),
      ...tenantArgument(c),
      metadata: scimMetadata(c.req.raw)
    });
    return c.body(null, 204);
  });

  app.post("/scim/v2/Groups", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.scim.createGroup({
      actor,
      resource: body,
      ...tenantArgument(c),
      location: scimLocation(c.req.url, "Groups", String((body as Record<string, unknown>).displayName ?? "")),
      metadata: scimMetadata(c.req.raw)
    });
    return c.json(data, 201);
  });

  app.get("/scim/v2/Groups", async (c) => {
    const actor = await options.actor(c.req.raw);
    const page = parseScimListOptions(c.req.raw.url ? new URL(c.req.raw.url).searchParams : new URLSearchParams());
    const groups = await options.scim.listGroups({
      actor,
      ...tenantArgument(c),
      page,
      location: (groupId) => scimLocation(c.req.url, "Groups", groupId)
    });
    return c.json(scimListResponse(groups, page.startIndex, groups.length + page.startIndex - 1));
  });

  app.get("/scim/v2/Groups/:groupId", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.scim.getGroup({
      actor,
      groupId: c.req.param("groupId"),
      ...tenantArgument(c),
      location: scimLocation(c.req.url, "Groups", c.req.param("groupId"))
    });
    return c.json(data);
  });

  app.put("/scim/v2/Groups/:groupId", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.scim.replaceGroup({
      actor,
      groupId: c.req.param("groupId"),
      resource: body,
      ...tenantArgument(c),
      location: scimLocation(c.req.url, "Groups", c.req.param("groupId")),
      metadata: scimMetadata(c.req.raw)
    });
    return c.json(data);
  });

  app.patch("/scim/v2/Groups/:groupId", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.scim.patchGroup({
      actor,
      groupId: c.req.param("groupId"),
      patch: body,
      ...tenantArgument(c),
      location: scimLocation(c.req.url, "Groups", c.req.param("groupId")),
      metadata: scimMetadata(c.req.raw)
    });
    return c.json(data);
  });

  app.delete("/scim/v2/Groups/:groupId", async (c) => {
    const actor = await options.actor(c.req.raw);
    await options.scim.deleteGroup({
      actor,
      groupId: c.req.param("groupId"),
      ...tenantArgument(c),
      metadata: scimMetadata(c.req.raw)
    });
    return c.body(null, 204);
  });

  if (options.tokens !== undefined) {
    const tokenActor = options.tokenActor ?? options.actor;
    app.get("/api/scim/tokens", async (c) => {
      const actor = await tokenActor(c.req.raw);
      const data = await options.tokens!.list(actor, c.req.query("tenant"));
      return c.json({ data });
    });

    app.post("/api/scim/tokens", async (c) => {
      const actor = await tokenActor(c.req.raw);
      const body = await readJsonObject(c.req.raw, { maxJsonBytes });
      const result = await options.tokens!.issue({
        actor,
        name: requiredString(body.name, "name"),
        ...(body.tenantId === undefined ? {} : { tenantId: requiredString(body.tenantId, "tenantId") }),
        ...(body.expiresInSeconds === undefined ? {} : { expiresInSeconds: integerValue(body.expiresInSeconds, "expiresInSeconds") })
      });
      return c.json({ data: result }, 201);
    });

    app.post("/api/scim/tokens/:tokenId/revoke", async (c) => {
      const actor = await tokenActor(c.req.raw);
      const data = await options.tokens!.revoke(
        actor,
        c.req.param("tokenId"),
        c.req.query("tenant")
      );
      return c.json({ data });
    });
  }

  return app;
}

function scimLocation(url: string, resourceType: "Users" | "Groups", id: string): string {
  const base = new URL(url);
  base.search = "";
  base.hash = "";
  const path = base.pathname.replace(/\/scim\/v2(\/(Users|Groups)(\/.*)?)?$/, "");
  return `${base.origin}${path}/scim/v2/${resourceType}/${encodeURIComponent(id)}`;
}

function tenantArgument(c: Context): { readonly tenantId: string } | {} {
  const tenantId = c.req.query("tenant");
  return tenantId === undefined ? {} : { tenantId };
}

function filterArgument(c: Context): { readonly filter: string } | {} {
  const filter = c.req.query("filter");
  return filter === undefined ? {} : { filter };
}

function scimMetadata(request: Request) {
  const requestId = request.headers.get("x-cf-frappe-request-id") ?? request.headers.get("request-id");
  return {
    ...requestMetadata(request),
    ...(requestId === null ? {} : { requestId })
  };
}

function serviceProviderConfig() {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 1_000 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "httpbearertoken",
        name: "Bearer Token",
        description: "Per-tenant SCIM bearer token",
        primary: true
      }
    ]
  };
}

function resourceTypes() {
  return [
    { id: "User", endpoint: "/Users", schema: SCIM_USER_SCHEMA },
    { id: "Group", endpoint: "/Groups", schema: SCIM_GROUP_SCHEMA }
  ];
}

function schemas() {
  return [
    {
      id: SCIM_USER_SCHEMA,
      name: "User",
      description: "cf-frappe user account",
      attributes: [
        scimAttribute("userName", "string", true, "uniqueness" in {} ? "server" : "server"),
        scimAttribute("externalId", "string", false, "uniqueness" in {} ? "none" : "none"),
        scimAttribute("email", "string", false, "none"),
        { name: "roles", type: "complex", multiValued: true, required: false, mutability: "readWrite", returned: "default", subAttributes: [scimSubAttribute("value", "string")] },
        scimAttribute("active", "boolean", false, "none")
      ]
    },
    {
      id: SCIM_GROUP_SCHEMA,
      name: "Group",
      description: "cf-frappe role catalog entry",
      attributes: [
        scimAttribute("displayName", "string", true, "none"),
        scimAttribute("description", "string", false, "none"),
        scimAttribute("active", "boolean", false, "none"),
        { name: "members", type: "complex", multiValued: true, required: false, mutability: "readWrite", returned: "default", subAttributes: [scimSubAttribute("value", "string"), scimSubAttribute("display", "string")] }
      ]
    },
    {
      id: SCIM_PATCH_SCHEMA,
      name: "PatchOp",
      description: "SCIM patch operations",
      attributes: [
        { name: "Operations", type: "complex", multiValued: true, required: true, mutability: "readOnly", returned: "default", subAttributes: [scimSubAttribute("op", "string"), scimSubAttribute("path", "string"), scimSubAttribute("value", "string")] }
      ]
    },
    {
      id: SCIM_LIST_RESPONSE_SCHEMA,
      name: "ListResponse",
      description: "SCIM list response",
      attributes: [
        scimAttribute("totalResults", "integer", true, "none"),
        scimAttribute("startIndex", "integer", true, "none"),
        scimAttribute("itemsPerPage", "integer", true, "none")
      ]
    }
  ];
}

function scimErrorResponse(error: unknown, c: Context): Response {
  const status = error instanceof FrameworkError ? error.status : 500;
  const message = error instanceof FrameworkError ? error.message : "Internal server error";
  return c.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: String(status),
      detail: message
    },
    status as ContentfulStatusCode
  );
}

function scimAttribute(name: string, type: string, required: boolean, uniqueness: string) {
  return {
    name,
    type,
    multiValued: false,
    required,
    mutability: "readWrite",
    returned: "default",
    uniqueness
  };
}

function scimSubAttribute(name: string, type: string) {
  return {
    name,
    type,
    multiValued: false,
    required: false,
    mutability: "readWrite",
    returned: "default"
  };
}

function requiredString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FrameworkError("BAD_REQUEST", `${field} is required`, { status: 400 });
  }
  return value;
}

function integerValue(value: JsonValue | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new FrameworkError("BAD_REQUEST", `${field} must be an integer`, { status: 400 });
  }
  return value;
}
