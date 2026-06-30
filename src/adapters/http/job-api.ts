import { Hono } from "hono";
import { ensureJobHistoryApiAvailable } from "../../application/job-history-policy.js";
import type { JobHistoryService } from "../../application/job-history-service.js";
import { ensureJobRetryAvailable } from "../../application/job-retry-policy.js";
import type { JobRetryPort } from "../../application/job-retry-service.js";
import { ensureJobScheduleServiceAvailable } from "../../application/job-schedule-policy.js";
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
    const jobs = requireJobHistory(options);
    const actor = await options.actor(c.req.raw);
    const limit = parseOptionalInteger(c.req.query("limit"));
    const jobName = c.req.query("job");
    const runId = c.req.query("run_id");
    const status = c.req.query("status");
    const data = await jobs.dashboard(actor, {
      ...(jobName === undefined ? {} : { jobName }),
      ...(runId === undefined ? {} : { runId }),
      ...(status === undefined ? {} : { status }),
      ...(limit === undefined ? {} : { limit })
    });
    return c.json({ data });
  });

  app.get("/api/jobs/executions/:idempotencyKey", async (c) => {
    const jobs = requireJobHistory(options);
    const actor = await options.actor(c.req.raw);
    const data = await jobs.get(actor, c.req.param("idempotencyKey"));
    return c.json({ data });
  });

  app.get("/api/jobs/schedules", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    const cron = c.req.query("cron");
    const jobName = c.req.query("job");
    const data = await schedules.dashboard(actor, {
      ...(cron === undefined ? {} : { cron }),
      ...(jobName === undefined ? {} : { jobName })
    });
    return c.json({ data });
  });

  app.post("/api/jobs/schedules", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await schedules.save(actor, {
      ...scheduleDefinitionFromBody(body),
      eventMetadata: requestMetadata(c.req.raw)
    });
    return c.json({ data }, 201);
  });

  app.put("/api/jobs/schedules/:scheduleId", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await schedules.save(actor, {
      ...scheduleDefinitionFromBody(body, c.req.param("scheduleId")),
      eventMetadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.delete("/api/jobs/schedules/:scheduleId", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    const data = await schedules.delete(actor, c.req.param("scheduleId"), {
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.post("/api/jobs/schedules/:scheduleId/run", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    const data = await schedules.dispatch(actor, c.req.param("scheduleId"));
    return c.json({ data }, 201);
  });

  app.post("/api/jobs/schedules/:scheduleId/enable", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    const data = await schedules.enable(actor, c.req.param("scheduleId"), {
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.post("/api/jobs/schedules/:scheduleId/disable", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    const data = await schedules.disable(actor, c.req.param("scheduleId"), {
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.post("/api/jobs/schedules/:scheduleId/pause", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await schedules.pause(actor, c.req.param("scheduleId"), {
      pausedUntil: requiredString(body, "pauseUntil"),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.post("/api/jobs/schedules/:scheduleId/reset", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    const data = await schedules.clearOverride(actor, c.req.param("scheduleId"), {
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.post("/api/jobs/executions/:idempotencyKey/retry", async (c) => {
    const retry = requireJobRetry(options);
    const actor = await options.actor(c.req.raw);
    const data = await retry.retry(actor, c.req.param("idempotencyKey"));
    return c.json({ data }, 201);
  });

  return app;
}

function requireJobHistory(options: JobApiOptions): JobHistoryService {
  ensureJobHistoryApiAvailable(options.jobs);
  return options.jobs;
}

function requireJobSchedules(options: JobApiOptions): JobScheduleService {
  ensureJobScheduleServiceAvailable(options.schedules);
  return options.schedules;
}

function requireJobRetry(options: JobApiOptions): JobRetryPort {
  ensureJobRetryAvailable(options.retry);
  return options.retry;
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
