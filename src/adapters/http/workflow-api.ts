import { Hono } from "hono";
import type { WorkflowService } from "../../application/workflow-service.js";
import { badRequest } from "../../core/errors.js";
import type { JsonValue, WorkflowDefinition, WorkflowTransition } from "../../core/types.js";
import type { ActorResolver } from "./actor.js";
import { readJsonObject, requestMetadata } from "./request.js";

export interface WorkflowApiOptions {
  readonly workflows: WorkflowService;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createWorkflowApi(options: WorkflowApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.get("/api/workflows/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.workflows.list(actor, c.req.param("doctype"), c.req.query("tenant"));
    return c.json({ data });
  });

  app.put("/api/workflows/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.workflows.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.workflows.save({
      actor,
      doctype: c.req.param("doctype"),
      workflow: workflowValue(body.workflow),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.delete("/api/workflows/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.workflows.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const data = await options.workflows.clear({
      actor,
      doctype: c.req.param("doctype"),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  return app;
}

function workflowValue(value: JsonValue | undefined): WorkflowDefinition {
  if (!isRecord(value)) {
    throw badRequest("workflow must be an object");
  }
  return {
    ...optionalString(value.stateField, "workflow.stateField", "stateField"),
    initialState: requiredString(value.initialState, "workflow.initialState"),
    states: stringArray(value.states, "workflow.states"),
    transitions: transitionArray(value.transitions)
  };
}

function transitionArray(value: JsonValue | undefined): readonly WorkflowTransition[] {
  if (!Array.isArray(value)) {
    throw badRequest("workflow.transitions must be an array");
  }
  return value.map((item, index) => transitionValue(item, `workflow.transitions[${index}]`));
}

function transitionValue(value: JsonValue | undefined, field: string): WorkflowTransition {
  if (!isRecord(value)) {
    throw badRequest(`${field} must be an object`);
  }
  return {
    action: requiredString(value.action, `${field}.action`),
    from: requiredString(value.from, `${field}.from`),
    to: requiredString(value.to, `${field}.to`),
    ...optionalStringArray(value.roles, `${field}.roles`, "roles"),
    ...optionalString(value.eventType, `${field}.eventType`, "eventType")
  };
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

function stringArray(value: JsonValue | undefined, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw badRequest(`${field} must be an array of strings`);
  }
  return value;
}

function optionalStringArray<TKey extends string>(
  value: JsonValue | undefined,
  field: string,
  key: TKey
): { readonly [K in TKey]?: readonly string[] } {
  if (value === undefined) {
    return {};
  }
  return { [key]: stringArray(value, field) } as { readonly [K in TKey]: readonly string[] };
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
