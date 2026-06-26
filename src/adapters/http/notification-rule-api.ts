import { Hono } from "hono";
import type { NotificationRuleService } from "../../application/notification-rule-service.js";
import { badRequest } from "../../core/errors.js";
import type {
  JsonValue,
  NotificationRuleChannel,
  NotificationRuleDefinition,
  NotificationRuleEventKind,
  NotificationRuleRecipientDefinition
} from "../../core/types.js";
import type { ActorResolver } from "./actor.js";
import { readJsonObject, requestMetadata } from "./request.js";

export interface NotificationRuleApiOptions {
  readonly notificationRules: NotificationRuleService;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createNotificationRuleApi(options: NotificationRuleApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.get("/api/notification-rules/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.notificationRules.list(actor, c.req.param("doctype"), c.req.query("tenant"));
    return c.json({ data });
  });

  app.put("/api/notification-rules/:doctype/:rule", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.notificationRules.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.notificationRules.save({
      actor,
      doctype: c.req.param("doctype"),
      rule: ruleValue(c.req.param("rule"), body.rule),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.delete("/api/notification-rules/:doctype/:rule", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.notificationRules.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const data = await options.notificationRules.clear({
      actor,
      doctype: c.req.param("doctype"),
      ruleName: c.req.param("rule"),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  return app;
}

function ruleValue(name: string, value: JsonValue | undefined): NotificationRuleDefinition {
  if (!isRecord(value)) {
    throw badRequest("rule must be an object");
  }
  return {
    name,
    ...optionalBoolean(value.enabled, "rule.enabled", "enabled"),
    events: eventKinds(value.events),
    recipients: recipients(value.recipients),
    ...optionalChannels(value.channels),
    ...optionalString(value.subject, "rule.subject", "subject"),
    ...optionalBoolean(value.excludeActor, "rule.excludeActor", "excludeActor")
  };
}

function eventKinds(value: JsonValue | undefined): readonly NotificationRuleEventKind[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw badRequest("rule.events must be an array of strings");
  }
  return value as readonly NotificationRuleEventKind[];
}

function optionalChannels(value: JsonValue | undefined): { readonly channels?: readonly NotificationRuleChannel[] } {
  if (value === undefined) {
    return {};
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw badRequest("rule.channels must be an array of strings");
  }
  return { channels: value as readonly NotificationRuleChannel[] };
}

function recipients(value: JsonValue | undefined): readonly NotificationRuleRecipientDefinition[] {
  if (!Array.isArray(value)) {
    throw badRequest("rule.recipients must be an array");
  }
  return value.map((item, index) => recipient(item, `rule.recipients[${index}]`));
}

function recipient(value: JsonValue | undefined, field: string): NotificationRuleRecipientDefinition {
  if (!isRecord(value)) {
    throw badRequest(`${field} must be an object`);
  }
  if (value.kind === "user") {
    return { kind: "user", userId: requiredString(value.userId, `${field}.userId`) };
  }
  if (value.kind === "field") {
    return { kind: "field", field: requiredString(value.field, `${field}.field`) };
  }
  if (value.kind === "documentOwner") {
    return { kind: "documentOwner" };
  }
  throw badRequest(`${field}.kind must be user, field, or documentOwner`);
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

function integerValue(value: JsonValue, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest(`${field} must be an integer`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, JsonValue | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
