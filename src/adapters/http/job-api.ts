import { Hono } from "hono";
import type { JobHistoryService } from "../../application/job-history-service";
import type { JobRetryPort } from "../../application/job-retry-service";
import type { ActorResolver } from "./actor";
import { parseOptionalInteger } from "./request";

export interface JobApiOptions {
  readonly jobs: JobHistoryService;
  readonly retry?: JobRetryPort;
  readonly actor: ActorResolver;
}

export function createJobApi(options: JobApiOptions): Hono {
  const app = new Hono();

  app.get("/api/jobs", async (c) => {
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
    const actor = await options.actor(c.req.raw);
    const data = await options.jobs.get(actor, c.req.param("idempotencyKey"));
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
