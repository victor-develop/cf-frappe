import { Hono } from "hono";
import type { UserProfileService } from "../../application/user-profile-service";
import { badRequest } from "../../core/errors";
import { isUserProfileField, USER_PROFILE_FIELDS, type UserProfileInput } from "../../core/user-profiles";
import type { JsonValue } from "../../core/types";
import type { ActorResolver } from "./actor";
import { readJsonObject, requestMetadata } from "./request";

export interface UserProfileApiOptions {
  readonly userProfiles: UserProfileService;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createUserProfileApi(options: UserProfileApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.get("/api/users/:userId/profile", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.userProfiles.get(actor, c.req.param("userId"), c.req.query("tenant"));
    return c.json({ data });
  });

  app.put("/api/users/:userId/profile", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.userProfiles.authorizeProfileAccess(actor, c.req.param("userId"), tenantId);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.userProfiles.change({
      actor,
      userId: c.req.param("userId"),
      profile: profileInput(body),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  return app;
}

function profileInput(body: Record<string, JsonValue | undefined>): UserProfileInput {
  const profile: Record<string, string | null> = {};
  for (const field of USER_PROFILE_FIELDS) {
    const value = body[field];
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      profile[field] = null;
      continue;
    }
    if (typeof value !== "string") {
      throw badRequest(`${field} must be a string`);
    }
    profile[field] = value;
  }
  const unknownFields = Object.keys(body).filter((field) => field !== "expectedVersion" && !isUserProfileField(field));
  if (unknownFields.length > 0) {
    throw badRequest(`Unknown user profile field '${unknownFields[0]}'`);
  }
  return profile;
}

function integerValue(value: JsonValue, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest(`${field} must be an integer`);
  }
  return value;
}
