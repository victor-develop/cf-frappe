import { Hono } from "hono";
import type { JobHistoryService } from "../../application/job-history-service.js";
import type { JobRetryPort } from "../../application/job-retry-service.js";
import type { JobScheduleService } from "../../application/job-schedule-service.js";
import type { ActorResolver } from "./actor.js";
import { parseOptionalInteger, requestMetadata } from "./request.js";

export interface JobApiOptions {
  readonly jobs?: JobHistoryService;
  readonly retry?: JobRetryPort;
  readonly schedules?: JobScheduleService;
  readonly actor: ActorResolver;
}

export function createJobApi(options: JobApiOptions): Hono {
  const app = new Hono();

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
