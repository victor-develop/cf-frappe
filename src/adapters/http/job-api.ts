import { Hono } from "hono";
import type { JobHistoryService } from "../../application/job-history-service.js";
import type { JobRetryPort } from "../../application/job-retry-service.js";
import type { JobScheduleService, SaveJobScheduleDefinitionCommand } from "../../application/job-schedule-service.js";
import { badRequest } from "../../core/errors.js";
import type { DocumentData, MutableDocumentData } from "../../core/types.js";
import type { ActorResolver } from "./actor.js";
import { parseOptionalInteger, readJsonObject, requestMetadata } from "./request.js";

export interface JobApiOptions {
  readonly jobs?: JobHistoryService;
  readonly retry?: JobRetryPort;
  readonly schedules?: JobScheduleService;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createJobApi(options: JobApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.get("/api/jobs", async (c) => {
    if (!options.jobs) {
      return c.json({ error: { code: "JOB_NOT_FOUND", message: "Job history is not enabled" } }, 404);
    }
    const actor = await options.actor(c.req.raw);
    const limit = parseOptionalInteger(c.req.query("limit"));
    const jobName = c.req.query("job");
    const runId = c.req.query("run_id");
    const status = c.req.query("status");
    const data = await options.jobs.dashboard(actor, {
      ...(jobName === undefined ? {} : { jobName }),
      ...(runId === undefined ? {} : { runId }),
      ...(status === undefined ? {} : { status }),
      ...(limit === undefined ? {} : { limit })
    });
    return c.json({ data });
  });

  app.get("/api/jobs/executions/:idempotencyKey", async (c) => {
    if (!options.jobs) {
      return c.json({ error: { code: "JOB_NOT_FOUND", message: "Job history is not enabled" } }, 404);
    }
    const actor = await options.actor(c.req.raw);
    const data = await options.jobs.get(actor, c.req.param("idempotencyKey"));
    return c.json({ data });
  });

  app.get("/api/jobs/schedules", async (c) => {
    if (!options.schedules) {
      return c.json({ error: { code: "JOB_SCHEDULE_NOT_FOUND", message: "Job schedules are not enabled" } }, 404);
    }
    const actor = await options.actor(c.req.raw);
    const cron = c.req.query("cron");
    const jobName = c.req.query("job");
    const data = await options.schedules.dashboard(actor, {
      ...(cron === undefined ? {} : { cron }),
      ...(jobName === undefined ? {} : { jobName })
    });
    return c.json({ data });
  });

  app.post("/api/jobs/schedules", async (c) => {
    if (!options.schedules) {
      return c.json({ error: { code: "JOB_SCHEDULE_NOT_FOUND", message: "Job schedules are not enabled" } }, 404);
    }
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.schedules.save(actor, {
      ...scheduleDefinitionFromBody(body),
      eventMetadata: requestMetadata(c.req.raw)
    });
    return c.json({ data }, 201);
  });

  app.put("/api/jobs/schedules/:scheduleId", async (c) => {
    if (!options.schedules) {
      return c.json({ error: { code: "JOB_SCHEDULE_NOT_FOUND", message: "Job schedules are not enabled" } }, 404);
    }
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.schedules.save(actor, {
      ...scheduleDefinitionFromBody(body, c.req.param("scheduleId")),
      eventMetadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.delete("/api/jobs/schedules/:scheduleId", async (c) => {
    if (!options.schedules) {
      return c.json({ error: { code: "JOB_SCHEDULE_NOT_FOUND", message: "Job schedules are not enabled" } }, 404);
    }
    const actor = await options.actor(c.req.raw);
    const data = await options.schedules.delete(actor, c.req.param("scheduleId"), {
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.post("/api/jobs/schedules/:scheduleId/run", async (c) => {
    if (!options.schedules) {
      return c.json({ error: { code: "JOB_SCHEDULE_NOT_FOUND", message: "Job schedules are not enabled" } }, 404);
    }
    const actor = await options.actor(c.req.raw);
    const data = await options.schedules.dispatch(actor, c.req.param("scheduleId"));
    return c.json({ data }, 201);
  });

  app.post("/api/jobs/schedules/:scheduleId/enable", async (c) => {
    if (!options.schedules) {
      return c.json({ error: { code: "JOB_SCHEDULE_NOT_FOUND", message: "Job schedules are not enabled" } }, 404);
    }
    const actor = await options.actor(c.req.raw);
    const data = await options.schedules.enable(actor, c.req.param("scheduleId"), {
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.post("/api/jobs/schedules/:scheduleId/disable", async (c) => {
    if (!options.schedules) {
      return c.json({ error: { code: "JOB_SCHEDULE_NOT_FOUND", message: "Job schedules are not enabled" } }, 404);
    }
    const actor = await options.actor(c.req.raw);
    const data = await options.schedules.disable(actor, c.req.param("scheduleId"), {
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.post("/api/jobs/schedules/:scheduleId/reset", async (c) => {
    if (!options.schedules) {
      return c.json({ error: { code: "JOB_SCHEDULE_NOT_FOUND", message: "Job schedules are not enabled" } }, 404);
    }
    const actor = await options.actor(c.req.raw);
    const data = await options.schedules.clearOverride(actor, c.req.param("scheduleId"), {
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.post("/api/jobs/executions/:idempotencyKey/retry", async (c) => {
    if (!options.retry) {
      return c.json({ error: { code: "JOB_NOT_FOUND", message: "Job retry is not enabled" } }, 404);
    }
    const actor = await options.actor(c.req.raw);
    const data = await options.retry.retry(actor, c.req.param("idempotencyKey"));
    return c.json({ data }, 201);
  });

  return app;
}

function scheduleDefinitionFromBody(
  body: MutableDocumentData,
  id?: string
): Omit<SaveJobScheduleDefinitionCommand, "eventMetadata"> {
  const bodyId = optionalString(body, "id");
  const scheduleId = id ?? bodyId;
  const command = {
    cron: requiredString(body, "cron"),
    jobName: requiredString(body, "jobName"),
    ...(body.enabled === undefined ? {} : { enabled: booleanField(body, "enabled") }),
    ...(body.payload === undefined ? {} : { payload: objectField(body, "payload") }),
    ...(body.metadata === undefined ? {} : { metadata: objectField(body, "metadata") }),
    ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: requiredString(body, "idempotencyKey") }),
    ...(body.delaySeconds === undefined ? {} : { delaySeconds: numberField(body, "delaySeconds") })
  };
  return scheduleId === undefined ? command : { ...command, id: scheduleId };
}

function optionalString(body: MutableDocumentData, field: string): string | undefined {
  const value = body[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw badRequest(`${field} must be a string`);
  }
  return value;
}

function requiredString(body: MutableDocumentData, field: string): string {
  const value = optionalString(body, field);
  if (value === undefined) {
    throw badRequest(`${field} is required`);
  }
  return value;
}

function booleanField(body: MutableDocumentData, field: string): boolean {
  const value = body[field];
  if (typeof value !== "boolean") {
    throw badRequest(`${field} must be a boolean`);
  }
  return value;
}

function numberField(body: MutableDocumentData, field: string): number {
  const value = body[field];
  if (typeof value !== "number") {
    throw badRequest(`${field} must be a number`);
  }
  return value;
}

function objectField(body: MutableDocumentData, field: string): DocumentData {
  const value = body[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest(`${field} must be an object`);
  }
  return value as DocumentData;
}
