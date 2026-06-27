import { Hono } from "hono";
import type { AssignmentRuleService } from "../../application/assignment-rule-service.js";
import { FrameworkError, badRequest } from "../../core/errors.js";
import type { AssignmentRuleEntry, AssignmentRuleState } from "../../core/assignment-rules.js";
import type {
  AssignmentRuleAssigneeDefinition,
  AssignmentRuleDefinition,
  AssignmentRuleEventKind,
  JsonValue
} from "../../core/types.js";
import type { ActorResolver } from "./actor.js";
import { listFilterExpressionFromValue, readJsonObject, requestMetadata } from "./request.js";

export interface AssignmentRuleApiOptions {
  readonly assignmentRules: AssignmentRuleService;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createAssignmentRuleApi(options: AssignmentRuleApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.get("/api/assignment-rules/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.assignmentRules.list(actor, c.req.param("doctype"), c.req.query("tenant"));
    return c.json({ data });
  });

  app.get("/api/assignment-rules/:doctype/:rule", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.assignmentRules.list(actor, c.req.param("doctype"), c.req.query("tenant"));
    return c.json({ data: singleRuleState(data, c.req.param("rule")) });
  });

  app.put("/api/assignment-rules/:doctype/:rule", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.assignmentRules.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.assignmentRules.save({
      actor,
      doctype: c.req.param("doctype"),
      rule: ruleValue(c.req.param("rule"), body.rule),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.delete("/api/assignment-rules/:doctype/:rule", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.assignmentRules.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const data = await options.assignmentRules.clear({
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

function singleRuleState(state: AssignmentRuleState, ruleName: string): AssignmentRuleState {
  return {
    ...state,
    rules: [singleRuleEntry(state, ruleName)]
  };
}

function singleRuleEntry(state: AssignmentRuleState, ruleName: string): AssignmentRuleEntry {
  const entry = state.rules.find((item) => item.rule.name === ruleName);
  if (entry === undefined) {
    throw new FrameworkError("ASSIGNMENT_RULE_NOT_FOUND", `Assignment rule '${ruleName}' was not found`, { status: 404 });
  }
  return entry;
}

function ruleValue(name: string, value: JsonValue | undefined): AssignmentRuleDefinition {
  if (!isRecord(value)) {
    throw badRequest("rule must be an object");
  }
  return {
    name,
    ...optionalBoolean(value.enabled, "rule.enabled", "enabled"),
    events: eventKinds(value.events),
    assignees: assignees(value.assignees),
    ...(value.condition === undefined ? {} : { condition: listFilterExpressionFromValue(value.condition, "Assignment rule condition") }),
    ...optionalBoolean(value.excludeActor, "rule.excludeActor", "excludeActor")
  };
}

function eventKinds(value: JsonValue | undefined): readonly AssignmentRuleEventKind[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw badRequest("rule.events must be an array of strings");
  }
  return value as readonly AssignmentRuleEventKind[];
}

function assignees(value: JsonValue | undefined): readonly AssignmentRuleAssigneeDefinition[] {
  if (!Array.isArray(value)) {
    throw badRequest("rule.assignees must be an array");
  }
  return value.map((item, index) => assignee(item, `rule.assignees[${index}]`));
}

function assignee(value: JsonValue | undefined, field: string): AssignmentRuleAssigneeDefinition {
  if (!isRecord(value)) {
    throw badRequest(`${field} must be an object`);
  }
  if (value.kind === "user") {
    return { kind: "user", userId: requiredString(value.userId, `${field}.userId`) };
  }
  if (value.kind === "field") {
    return { kind: "field", field: requiredString(value.field, `${field}.field`) };
  }
  throw badRequest(`${field}.kind must be user or field`);
}

function requiredString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${field} is required`);
  }
  return value;
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
