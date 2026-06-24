import {
  createJobRegistry,
  createResourceApi,
  deterministicIds,
  fixedClock,
  InMemoryEventStore,
  InMemoryJobExecutionLog,
  InMemoryJobQueue,
  JobDispatcher,
  JobHistoryService,
  JobRetryService,
  JobScheduleService,
  jobScheduleDefinitionsStream,
  SYSTEM_MANAGER_ROLE,
  unsafeHeaderActorResolver
} from "../../src";
import { createServices, now } from "../helpers";

describe("job api", () => {
  it("returns admin job definitions and execution history", async () => {
    const services = createServices();
    const executionLog = new InMemoryJobExecutionLog();
    const queue = new InMemoryJobQueue();
    const registry = createJobRegistry({
      jobs: [{ name: "reports.daily", description: "Build reports", handler: () => undefined }]
    });
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      jobs: new JobHistoryService({ registry, executionLog }),
      jobRetry: new JobRetryService({
        executionLog,
        dispatcher: new JobDispatcher({
          registry,
          queue,
          clock: fixedClock(now),
          ids: deterministicIds(["retry-001"])
        }),
        clock: fixedClock(now)
      }),
      actor: unsafeHeaderActorResolver
    });
    const message = {
      tenantId: "acme",
      jobName: "reports.daily",
      payload: {},
      runId: "job_001",
      idempotencyKey: "reports.daily:job_001",
      enqueuedAt: now,
      metadata: {}
    };
    await executionLog.begin(message, now);
    await executionLog.complete(message, "2026-01-01T00:01:00.000Z", { rows: 3 });

    const response = await app.request("/api/jobs?status=succeeded", { headers: adminHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        jobs: [{ name: "reports.daily", description: "Build reports" }],
        filters: { status: "succeeded" },
        executions: [
          {
            idempotencyKey: "reports.daily:job_001",
            tenantId: "acme",
            status: "succeeded",
            result: { rows: 3 }
          }
        ]
      }
    });

    const retried = await app.request("/api/jobs/executions/reports.daily%3Ajob_001/retry", {
      method: "POST",
      headers: adminHeaders
    });
    expect(retried.status).toBe(400);

    await executionLog.fail(message, "2026-01-01T00:02:00.000Z", "down");
    const retryResponse = await app.request("/api/jobs/executions/reports.daily%3Ajob_001/retry", {
      method: "POST",
      headers: adminHeaders
    });

    expect(retryResponse.status).toBe(201);
    await expect(retryResponse.json()).resolves.toMatchObject({
      data: {
        message: {
          tenantId: "acme",
          runId: "job_retry-001",
          idempotencyKey: "reports.daily:job_001",
          metadata: {
            retriedBy: "admin@example.com",
            retriedFromRunId: "job_001"
          }
        }
      }
    });
    expect(queue.queued()).toHaveLength(1);
  });

  it("returns one job execution by idempotency key", async () => {
    const services = createServices();
    const executionLog = new InMemoryJobExecutionLog();
    const registry = createJobRegistry({ jobs: [{ name: "email.digest", handler: () => undefined }] });
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      jobs: new JobHistoryService({ registry, executionLog }),
      actor: unsafeHeaderActorResolver
    });
    const message = {
      tenantId: "acme",
      jobName: "email.digest",
      payload: {},
      runId: "job_002",
      idempotencyKey: "email.digest:job_002",
      enqueuedAt: now,
      metadata: {}
    };
    await executionLog.begin(message, now);
    await executionLog.fail(message, "2026-01-01T00:01:00.000Z", "smtp timeout");

    const response = await app.request("/api/jobs/executions/email.digest%3Ajob_002", {
      headers: adminHeaders
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        idempotencyKey: "email.digest:job_002",
        tenantId: "acme",
        status: "failed",
        error: "smtp timeout"
      }
    });
  });

  it("returns configured schedules and manually dispatches a schedule without execution history", async () => {
    const services = createServices();
    const scheduleEvents = new InMemoryEventStore();
    const registry = createJobRegistry({
      jobs: [{ name: "reports.daily", description: "Build reports", handler: () => undefined }]
    });
    const runner = vi.fn(async () => ({
      tenantId: "acme",
      jobName: "reports.daily",
      payload: {},
      runId: "job_manual-001",
      idempotencyKey: "manual:0 2 * * *:1767225600000:reports.daily",
      enqueuedAt: now,
      metadata: { dispatchSource: "manual" }
    }));
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      jobSchedules: new JobScheduleService({
        registry,
        schedules: [
          { id: "daily", cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" },
          { id: "digest", cron: "0 3 * * *", jobName: "reports.daily", tenantId: "acme", enabled: false }
        ],
        runner: { run: runner },
        events: scheduleEvents,
        clock: fixedClock(now),
        ids: deterministicIds(["disable-1", "reset-2", "pause-3", "reset-4", "enable-5", "reset-6"])
      }),
      actor: unsafeHeaderActorResolver
    });

    const list = await app.request("/api/jobs/schedules?job=reports.daily", { headers: adminHeaders });

    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      data: {
        filters: { jobName: "reports.daily" },
        schedules: [
          {
            id: "daily",
            cron: "0 2 * * *",
            jobName: "reports.daily",
            tenantId: "acme",
            enabled: true,
            registered: true
          },
          {
            id: "digest",
            cron: "0 3 * * *",
            jobName: "reports.daily",
            tenantId: "acme",
            enabled: false,
            registered: true
          }
        ]
      }
    });

    const run = await app.request("/api/jobs/schedules/daily/run", {
      method: "POST",
      headers: adminHeaders
    });

    expect(run.status).toBe(201);
    await expect(run.json()).resolves.toMatchObject({
      data: {
        message: {
          tenantId: "acme",
          runId: "job_manual-001",
          idempotencyKey: "manual:0 2 * * *:1767225600000:reports.daily"
        }
      }
    });

    const disabledRun = await app.request("/api/jobs/schedules/digest/run", {
      method: "POST",
      headers: adminHeaders
    });
    expect(disabledRun.status).toBe(400);
    await expect(disabledRun.json()).resolves.toMatchObject({
      error: { message: "Disabled job schedules cannot be manually dispatched" }
    });

    const disable = await app.request("/api/jobs/schedules/daily/disable", {
      method: "POST",
      headers: adminHeaders
    });
    expect(disable.status).toBe(200);
    await expect(disable.json()).resolves.toMatchObject({
      data: {
        schedule: {
          id: "daily",
          enabled: false,
          configuredEnabled: true,
          overridden: true,
          overrideEnabled: false,
          overrideUpdatedAt: now,
          overrideUpdatedBy: "admin@example.com",
          dispatchable: false
        }
      }
    });

    const disabledOverrideRun = await app.request("/api/jobs/schedules/daily/run", {
      method: "POST",
      headers: adminHeaders
    });
    expect(disabledOverrideRun.status).toBe(400);
    await expect(disabledOverrideRun.json()).resolves.toMatchObject({
      error: { message: "Disabled job schedules cannot be manually dispatched" }
    });

    const resetDaily = await app.request("/api/jobs/schedules/daily/reset", {
      method: "POST",
      headers: adminHeaders
    });
    expect(resetDaily.status).toBe(200);
    await expect(resetDaily.json()).resolves.toMatchObject({
      data: {
        schedule: {
          id: "daily",
          enabled: true,
          configuredEnabled: true,
          overridden: false,
          dispatchable: true
        }
      }
    });

    const invalidPause = await app.request("/api/jobs/schedules/daily/pause", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ pauseUntil: "not-a-date" })
    });
    expect(invalidPause.status).toBe(400);
    await expect(invalidPause.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Job schedule pauseUntil must be a valid timestamp" }
    });

    const pastPause = await app.request("/api/jobs/schedules/daily/pause", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ pauseUntil: "2025-12-31T00:00:00.000Z" })
    });
    expect(pastPause.status).toBe(400);
    await expect(pastPause.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Job schedule pauseUntil must be in the future" }
    });

    const pausedUntil = "2026-01-02T00:00:00.000Z";
    const pause = await app.request("/api/jobs/schedules/daily/pause", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ pauseUntil: pausedUntil })
    });
    expect(pause.status).toBe(200);
    await expect(pause.json()).resolves.toMatchObject({
      data: {
        schedule: {
          id: "daily",
          enabled: false,
          configuredEnabled: true,
          overridden: true,
          pausedUntil,
          dispatchable: false
        }
      }
    });

    const pausedRun = await app.request("/api/jobs/schedules/daily/run", {
      method: "POST",
      headers: adminHeaders
    });
    expect(pausedRun.status).toBe(400);
    await expect(pausedRun.json()).resolves.toMatchObject({
      error: { message: "Disabled job schedules cannot be manually dispatched" }
    });

    const resetPausedDaily = await app.request("/api/jobs/schedules/daily/reset", {
      method: "POST",
      headers: adminHeaders
    });
    expect(resetPausedDaily.status).toBe(200);
    await expect(resetPausedDaily.json()).resolves.toMatchObject({
      data: { schedule: { id: "daily", enabled: true, overridden: false, dispatchable: true } }
    });

    const enable = await app.request("/api/jobs/schedules/digest/enable", {
      method: "POST",
      headers: adminHeaders
    });
    expect(enable.status).toBe(200);
    await expect(enable.json()).resolves.toMatchObject({
      data: {
        schedule: {
          id: "digest",
          enabled: true,
          configuredEnabled: false,
          overridden: true,
          overrideEnabled: true,
          dispatchable: true
        }
      }
    });

    const resetDigest = await app.request("/api/jobs/schedules/digest/reset", {
      method: "POST",
      headers: adminHeaders
    });
    expect(resetDigest.status).toBe(200);
    await expect(resetDigest.json()).resolves.toMatchObject({
      data: {
        schedule: {
          id: "digest",
          enabled: false,
          configuredEnabled: false,
          overridden: false,
          dispatchable: false
        }
      }
    });

    expect(runner).toHaveBeenCalledOnce();
  });

  it("creates, updates, and deletes runtime job schedule definitions through the admin API", async () => {
    const services = createServices();
    const scheduleEvents = new InMemoryEventStore();
    const registry = createJobRegistry({
      jobs: [{ name: "reports.daily", description: "Build reports", handler: () => undefined }]
    });
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      jobSchedules: new JobScheduleService({
        registry,
        schedules: [],
        events: scheduleEvents,
        clock: fixedClock(now),
        ids: deterministicIds(["save-runtime", "update-runtime", "delete-runtime"])
      }),
      actor: unsafeHeaderActorResolver
    });

    const created = await app.request("/api/jobs/schedules", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        id: "runtime-daily",
        cron: "15 4 * * *",
        jobName: "reports.daily",
        enabled: true,
        payload: { scope: "runtime" },
        metadata: { source: "api" },
        delaySeconds: 30
      })
    });

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      data: {
        schedule: {
          id: "runtime-daily",
          source: "runtime",
          editable: true,
          cron: "15 4 * * *",
          enabled: true,
          registered: true,
          delaySeconds: 30
        }
      }
    });

    const invalidDelay = await app.request("/api/jobs/schedules", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        id: "runtime-too-late",
        cron: "15 4 * * *",
        jobName: "reports.daily",
        delaySeconds: 86_401
      })
    });
    expect(invalidDelay.status).toBe(400);
    await expect(invalidDelay.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "delaySeconds must be an integer between 0 and 86400" }
    });
    await expect(scheduleEvents.readStream(jobScheduleDefinitionsStream())).resolves.toHaveLength(1);

    const invalidKey = await app.request("/api/jobs/schedules", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        id: "runtime-key-too-long",
        cron: "15 4 * * *",
        jobName: "reports.daily",
        idempotencyKey: "x".repeat(257)
      })
    });
    expect(invalidKey.status).toBe(400);
    await expect(invalidKey.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Job schedule idempotencyKey must be at most 256 characters" }
    });
    await expect(scheduleEvents.readStream(jobScheduleDefinitionsStream())).resolves.toHaveLength(1);

    const list = await app.request("/api/jobs/schedules", { headers: adminHeaders });
    await expect(list.json()).resolves.toMatchObject({
      data: {
        schedules: [{ id: "runtime-daily", source: "runtime", editable: true, tenantId: "acme" }]
      }
    });

    const updated = await app.request("/api/jobs/schedules/runtime-daily", {
      method: "PUT",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        cron: "30 5 * * *",
        jobName: "reports.daily",
        enabled: false
      })
    });

    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      data: {
        schedule: {
          id: "runtime-daily",
          cron: "30 5 * * *",
          enabled: false,
          configuredEnabled: false,
          dispatchable: false
        }
      }
    });

    const deleted = await app.request("/api/jobs/schedules/runtime-daily", {
      method: "DELETE",
      headers: adminHeaders
    });

    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({
      data: { schedule: { id: "runtime-daily", deleted: true } }
    });
    const afterDelete = await app.request("/api/jobs/schedules", { headers: adminHeaders });
    await expect(afterDelete.json()).resolves.toMatchObject({ data: { schedules: [] } });
  });
});

const adminHeaders = {
  "x-cf-frappe-user": "admin@example.com",
  "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
  "x-cf-frappe-tenant": "acme"
};
