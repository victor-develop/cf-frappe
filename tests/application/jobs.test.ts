import {
  badRequest,
  classifyJobError,
  createJobRegistry,
  deterministicIds,
  fixedClock,
  InMemoryEventStore,
  InMemoryJobExecutionLog,
  InMemoryJobQueue,
  JobHistoryService,
  JobDispatcher,
  JobExecutor,
  JobRetryService,
  JobScheduleService,
  DEFAULT_TENANT_ID,
  jobScheduleDefinitionsStream,
  jobScheduleOverridesStream,
  permanentJobError,
  retryableJobError,
  SYSTEM_MANAGER_ROLE
} from "../../src";
import type {
  DocumentData,
  DocumentEventPayload,
  DomainEvent,
  EventStore,
  JobMessage,
  JobScheduleEventPayload,
  NewDomainEvent,
  ReadStreamOptions,
  StreamName
} from "../../src";
import { now } from "../helpers";

describe("JobDispatcher", () => {
  it("creates deterministic queue envelopes", async () => {
    const queue = new InMemoryJobQueue();
    const dispatcher = new JobDispatcher({
      registry: createJobRegistry({
        jobs: [{ name: "email.digest", handler: () => undefined }]
      }),
      queue,
      clock: fixedClock(now),
      ids: deterministicIds(["001"])
    });

    const message = await dispatcher.dispatch({
      jobName: "email.digest",
      payload: { account: "acme" },
      metadata: { source: "test" },
      delaySeconds: 90
    });

    expect(message).toEqual({
      tenantId: "default",
      jobName: "email.digest",
      payload: { account: "acme" },
      runId: "job_001",
      idempotencyKey: "email.digest:job_001",
      enqueuedAt: now,
      metadata: { source: "test" }
    });
    expect(queue.queued()).toEqual([{ message, delaySeconds: 90 }]);
  });

  it("rejects queue delays outside the Cloudflare delivery window", async () => {
    const queue = new InMemoryJobQueue();
    const dispatcher = new JobDispatcher({
      registry: createJobRegistry({
        jobs: [{ name: "email.digest", handler: () => undefined }]
      }),
      queue,
      clock: fixedClock(now),
      ids: deterministicIds(["001"])
    });

    await expect(
      dispatcher.dispatch({
        jobName: "email.digest",
        payload: {},
        delaySeconds: 86_401
      })
    ).rejects.toThrow("Job queue delaySeconds must be an integer between 0 and 86400");
    await expect(dispatcher.dispatch({ jobName: "email.digest", payload: {} })).resolves.toMatchObject({
      runId: "job_001"
    });
    expect(queue.queued()).toHaveLength(1);
  });

  it("rejects oversized queue idempotency keys before allocating ids", async () => {
    const queue = new InMemoryJobQueue();
    const dispatcher = new JobDispatcher({
      registry: createJobRegistry({
        jobs: [{ name: "email.digest", handler: () => undefined }]
      }),
      queue,
      clock: fixedClock(now),
      ids: deterministicIds(["001"])
    });

    await expect(
      dispatcher.dispatch({
        jobName: "email.digest",
        payload: {},
        idempotencyKey: "x".repeat(257)
      })
    ).rejects.toThrow("Job queue idempotencyKey must be at most 256 characters");
    await expect(dispatcher.dispatch({ jobName: "email.digest", payload: {} })).resolves.toMatchObject({
      runId: "job_001"
    });
    expect(queue.queued()).toHaveLength(1);
  });
});

describe("JobExecutor", () => {
  it("passes job context and skips duplicate idempotency keys", async () => {
    const handler = vi.fn(() => "done");
    const registry = createJobRegistry<{ readonly service: string }>({
      jobs: [{ name: "reports.weekly", handler }]
    });
    const executionLog = new InMemoryJobExecutionLog();
    const executor = new JobExecutor({
      registry,
      resources: { service: "documents" },
      executionLog,
      clock: fixedClock(now)
    });
    const message = {
      jobName: "reports.weekly",
      payload: { week: "2026-W01" },
      runId: "job_001",
      idempotencyKey: "reports.weekly:2026-W01",
      enqueuedAt: now,
      metadata: {}
    };

    await expect(executor.execute(message, { attempt: 1 })).resolves.toEqual({
      status: "succeeded",
      result: "done"
    });
    await expect(executor.execute(message, { attempt: 2 })).resolves.toEqual({
      status: "skipped",
      reason: "duplicate"
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "default",
        payload: { week: "2026-W01" },
        resources: { service: "documents" },
        attempt: 1
      })
    );
    await expect(executionLog.get("reports.weekly:2026-W01")).resolves.toMatchObject({
      tenantId: "default",
      status: "succeeded",
      result: "done"
    });
  });
});

describe("JobHistoryService", () => {
  it("lists job definitions and filtered execution history for admins", async () => {
    const registry = createJobRegistry({
      workerPools: [{ name: "reports", concurrency: 2 }],
      jobs: [
        {
          name: "reports.daily",
          pool: "reports",
          description: "Build the daily report",
          retry: { maxAttempts: 3, baseDelaySeconds: 30 },
          handler: () => undefined
        },
        { name: "email.digest", handler: () => undefined }
      ]
    });
    const executionLog = new InMemoryJobExecutionLog();
    const service = new JobHistoryService({ registry, executionLog });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const failedMessage = jobMessage("email.digest", "job_001", "acme");
    const succeededMessage = jobMessage("reports.daily", "job_002", "acme");

    await executionLog.begin(failedMessage, "2026-01-01T00:00:00.000Z");
    await executionLog.fail(failedMessage, "2026-01-01T00:01:00.000Z", new Error("mail service down"));
    await executionLog.begin(succeededMessage, "2026-01-01T00:02:00.000Z");
    await executionLog.complete(succeededMessage, "2026-01-01T00:03:00.000Z", { count: 7 });

    await expect(service.dashboard(admin, { status: "failed", limit: 10 })).resolves.toEqual({
      jobs: [
        { name: "email.digest", pool: "default" },
        {
          name: "reports.daily",
          pool: "reports",
          description: "Build the daily report",
          retry: { maxAttempts: 3, baseDelaySeconds: 30 }
        }
      ],
      filters: { status: "failed" },
      limit: 10,
      executions: [
        expect.objectContaining({
          tenantId: "acme",
          idempotencyKey: "email.digest:job_001",
          jobName: "email.digest",
          status: "failed",
          error: "mail service down"
        })
      ]
    });
  });

  it("keeps job execution history scoped to the actor tenant", async () => {
    const executionLog = new InMemoryJobExecutionLog();
    const service = new JobHistoryService({
      registry: createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] }),
      executionLog
    });
    const acme = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const other = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "other" };
    const acmeMessage = jobMessage("reports.daily", "job_001", "acme");
    const otherMessage = jobMessage("reports.daily", "job_001", "other");

    await executionLog.begin(acmeMessage, "2026-01-01T00:00:00.000Z");
    await executionLog.complete(acmeMessage, "2026-01-01T00:01:00.000Z", "acme");
    await executionLog.begin(otherMessage, "2026-01-01T00:02:00.000Z");
    await executionLog.complete(otherMessage, "2026-01-01T00:03:00.000Z", "other");

    await expect(service.dashboard(acme, { limit: 10 })).resolves.toMatchObject({
      executions: [{ tenantId: "acme", result: "acme" }]
    });
    await expect(service.get(other, "reports.daily:job_001")).resolves.toMatchObject({
      tenantId: "other",
      result: "other"
    });
  });

  it("rejects non-admin job history access and invalid filters", async () => {
    const service = new JobHistoryService({
      registry: createJobRegistry(),
      executionLog: new InMemoryJobExecutionLog()
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(service.dashboard({ id: "owner@example.com", roles: ["User"], tenantId: "acme" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
    await expect(service.dashboard(admin, { status: "waiting" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Unknown job execution status 'waiting'"
    });
  });
});

describe("JobRetryService", () => {
  it("requeues failed executions for tenant admins with the original message snapshot", async () => {
    const registry = createJobRegistry({
      jobs: [{ name: "email.digest", handler: () => undefined }]
    });
    const queue = new InMemoryJobQueue();
    const executionLog = new InMemoryJobExecutionLog();
    const dispatcher = new JobDispatcher({
      registry,
      queue,
      clock: fixedClock(now),
      ids: deterministicIds(["retry-001"])
    });
    const retry = new JobRetryService({ executionLog, dispatcher, clock: fixedClock(now) });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const failedMessage = jobMessage("email.digest", "job_001", "acme", {
      payload: { account: "acme" },
      metadata: { source: "cron" }
    });

    await executionLog.begin(failedMessage, "2026-01-01T00:00:00.000Z");
    await executionLog.fail(failedMessage, "2026-01-01T00:01:00.000Z", "smtp timeout");

    await expect(retry.retry(admin, "email.digest:job_001")).resolves.toMatchObject({
      original: {
        tenantId: "acme",
        status: "failed",
        payload: { account: "acme" },
        metadata: { source: "cron" }
      },
      message: {
        tenantId: "acme",
        jobName: "email.digest",
        payload: { account: "acme" },
        runId: "job_retry-001",
        idempotencyKey: "email.digest:job_001",
        metadata: {
          source: "cron",
          retriedAt: now,
          retriedBy: "admin@example.com",
          retriedFromRunId: "job_001"
        }
      }
    });
    expect(queue.queued()).toEqual([
      expect.objectContaining({
        message: expect.objectContaining({
          idempotencyKey: "email.digest:job_001",
          runId: "job_retry-001"
        })
      })
    ]);
  });

  it("rejects retry attempts for non-failed or cross-tenant executions", async () => {
    const registry = createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] });
    const queue = new InMemoryJobQueue();
    const executionLog = new InMemoryJobExecutionLog();
    const retry = new JobRetryService({
      executionLog,
      dispatcher: new JobDispatcher({
        registry,
        queue,
        clock: fixedClock(now),
        ids: deterministicIds(["retry-001"])
      }),
      clock: fixedClock(now)
    });
    const acmeAdmin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const otherAdmin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "other" };
    const succeededMessage = jobMessage("reports.daily", "job_001", "acme");
    const failedMessage = jobMessage("reports.daily", "job_002", "acme");

    await executionLog.begin(succeededMessage, "2026-01-01T00:00:00.000Z");
    await executionLog.complete(succeededMessage, "2026-01-01T00:01:00.000Z", undefined);
    await executionLog.begin(failedMessage, "2026-01-01T00:02:00.000Z");
    await executionLog.fail(failedMessage, "2026-01-01T00:03:00.000Z", "down");

    await expect(retry.retry(acmeAdmin, "reports.daily:job_001")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Only failed job executions can be retried"
    });
    await expect(retry.retry(otherAdmin, "reports.daily:job_002")).rejects.toMatchObject({
      code: "JOB_EXECUTION_NOT_FOUND"
    });
  });
});

describe("JobScheduleService", () => {
  it("registers job schedule payloads through the domain event extension map", () => {
    const payload = jobSchedulePayload({
      kind: "JobScheduleSaved",
      scheduleId: "runtime-daily",
      cron: "15 4 * * *",
      jobName: "reports.daily",
      tenantId: "acme",
      enabled: true,
      payload: { scope: "daily" }
    });

    expect(payload.payload?.scope).toBe("daily");
  });

  it("lists tenant-visible schedules with job metadata and dynamic flags", async () => {
    const registry = createJobRegistry({
      jobs: [
        {
          name: "reports.daily",
          description: "Build daily reports",
          retry: { maxAttempts: 2 },
          handler: () => undefined
        },
        { name: "email.digest", handler: () => undefined }
      ]
    });
    const service = new JobScheduleService({
      registry,
      schedules: [
        {
          cron: "0 2 * * *",
          jobName: "reports.daily",
          tenantId: "acme",
          payload: () => ({ scope: "daily" }),
          delaySeconds: 30
        },
        {
          cron: "0 3 * * *",
          jobName: "email.digest",
          tenantId: "other",
          enabled: false
        },
        {
          cron: "0 4 * * *",
          jobName: "missing.job",
          tenantId: "acme"
        },
        {
          cron: "0 5 * * *",
          jobName: "email.digest",
          tenantId: () => "acme"
        }
      ]
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(service.dashboard(admin, { jobName: "reports.daily" })).resolves.toEqual({
      filters: { jobName: "reports.daily" },
      schedules: [
        {
          id: "1",
          cron: "0 2 * * *",
          jobName: "reports.daily",
          source: "configured",
          editable: false,
          enabled: true,
          configuredEnabled: true,
          overridden: false,
          overrideable: false,
          registered: true,
          dispatchable: false,
          description: "Build daily reports",
          retry: { maxAttempts: 2 },
          delaySeconds: 30,
          tenantId: "acme",
          dynamic: {
            enabled: false,
            tenantId: false,
            payload: true,
            metadata: false,
            idempotencyKey: false
          }
        }
      ]
    });

    await expect(service.dashboard(admin)).resolves.toMatchObject({
      schedules: [
        { id: "1", jobName: "reports.daily", tenantId: "acme" },
        { id: "3", jobName: "missing.job", registered: false, tenantId: "acme" }
      ]
    });
  });

  it("dispatches registered schedules through the configured runner", async () => {
    const registry = createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] });
    const runner = vi.fn(async () => jobMessage("reports.daily", "job_manual", "acme"));
    const service = new JobScheduleService({
      registry,
      schedules: [{ cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" }],
      runner: { run: runner }
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(service.dispatch(admin, "1")).resolves.toMatchObject({
      schedule: { id: "1", cron: "0 2 * * *", jobName: "reports.daily" },
      message: { tenantId: "acme", idempotencyKey: "reports.daily:job_manual" }
    });
    expect(runner).toHaveBeenCalledWith(
      { cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" },
      admin
    );
  });

  it("overrides static schedules through the event store for admin, manual, and cron dispatch", async () => {
    const registry = createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] });
    const events = new InMemoryEventStore();
    const runner = vi.fn(async () => jobMessage("reports.daily", "job_manual", "acme"));
    const service = new JobScheduleService({
      registry,
      schedules: [
        { id: "daily-reports", cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" },
        { id: "initially-off", cron: "0 3 * * *", jobName: "reports.daily", tenantId: "acme", enabled: false }
      ],
      runner: { run: runner },
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["disable-daily", "enable-daily", "clear-daily", "enable-static-off", "clear-static-off"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(service.disable(admin, "daily-reports")).resolves.toMatchObject({
      schedule: {
        id: "daily-reports",
        enabled: false,
        configuredEnabled: true,
        overridden: true,
        overrideEnabled: false,
        overrideUpdatedAt: now,
        overrideUpdatedBy: "admin@example.com",
        overrideable: true,
        dispatchable: false
      }
    });
    await expect(service.dispatch(admin, "daily-reports")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Disabled job schedules cannot be manually dispatched"
    });
    await expect(service.schedulesForCron("0 2 * * *")).resolves.toMatchObject([{ enabled: false }]);

    await expect(service.enable(admin, "daily-reports")).resolves.toMatchObject({
      schedule: {
        id: "daily-reports",
        enabled: true,
        configuredEnabled: true,
        overridden: true,
        overrideEnabled: true,
        dispatchable: true
      }
    });
    await expect(service.dispatch(admin, "daily-reports")).resolves.toMatchObject({
      schedule: { id: "daily-reports", enabled: true },
      message: { tenantId: "acme", idempotencyKey: "reports.daily:job_manual" }
    });
    expect(runner).toHaveBeenCalledWith(
      { id: "daily-reports", cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme", enabled: true },
      admin
    );
    await expect(service.schedulesForCron("0 2 * * *")).resolves.toMatchObject([{ enabled: true }]);

    await expect(service.clearOverride(admin, "daily-reports")).resolves.toMatchObject({
      schedule: {
        id: "daily-reports",
        enabled: true,
        configuredEnabled: true,
        overridden: false,
        dispatchable: true
      }
    });
    await expect(service.dashboard(admin)).resolves.toMatchObject({
      schedules: expect.arrayContaining([
        expect.objectContaining({
          id: "daily-reports",
          enabled: true,
          overridden: false
        })
      ])
    });

    await expect(service.enable(admin, "initially-off")).resolves.toMatchObject({
      schedule: {
        id: "initially-off",
        enabled: true,
        configuredEnabled: false,
        overridden: true,
        overrideEnabled: true,
        dispatchable: true
      }
    });
    await expect(service.clearOverride(admin, "initially-off")).resolves.toMatchObject({
      schedule: {
        id: "initially-off",
        enabled: false,
        configuredEnabled: false,
        overridden: false,
        dispatchable: false
      }
    });
  });

  it("clears runtime schedule overrides idempotently back to metadata defaults", async () => {
    const registry = createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] });
    const service = new JobScheduleService({
      registry,
      schedules: [{ id: "daily", cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" }],
      events: new InMemoryEventStore(),
      clock: fixedClock(now),
      ids: deterministicIds(["disable-daily", "clear-daily"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await service.disable(admin, "daily");

    await expect(service.clearOverride(admin, "daily")).resolves.toMatchObject({
      schedule: {
        id: "daily",
        enabled: true,
        configuredEnabled: true,
        overridden: false,
        overrideable: true
      }
    });
    await expect(service.clearOverride(admin, "daily")).resolves.toMatchObject({
      schedule: {
        id: "daily",
        enabled: true,
        configuredEnabled: true,
        overridden: false
      }
    });
  });

  it("pauses static schedules through event-sourced overrides for manual and cron dispatch", async () => {
    const registry = createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] });
    const events = new InMemoryEventStore();
    const runner = vi.fn(async () => jobMessage("reports.daily", "job_manual", "acme"));
    const service = new JobScheduleService({
      registry,
      schedules: [{ id: "daily", cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" }],
      runner: { run: runner },
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["pause-daily", "clear-daily"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const pausedUntil = "2026-01-02T00:00:00.000Z";

    await expect(service.pause(admin, "daily", { pausedUntil })).resolves.toMatchObject({
      schedule: {
        id: "daily",
        enabled: false,
        configuredEnabled: true,
        overridden: true,
        pausedUntil,
        overrideUpdatedAt: now,
        overrideUpdatedBy: "admin@example.com",
        dispatchable: false
      }
    });
    await expect(service.dispatch(admin, "daily")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Disabled job schedules cannot be manually dispatched"
    });
    await expect(service.schedulesForCron("0 2 * * *")).resolves.toMatchObject([{ id: "daily", enabled: false }]);
    await expect(events.readStream(jobScheduleOverridesStream("acme"))).resolves.toMatchObject([
      { type: "JobSchedulePaused", payload: { kind: "JobSchedulePaused", scheduleId: "daily", pausedUntil } }
    ]);

    const afterPause = new JobScheduleService({
      registry,
      schedules: [{ id: "daily", cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" }],
      runner: { run: runner },
      events,
      clock: fixedClock("2026-01-03T00:00:00.000Z")
    });
    await expect(afterPause.dashboard(admin)).resolves.toMatchObject({
      schedules: [{ id: "daily", enabled: true, overridden: false, dispatchable: true }]
    });
    const expiredCronSchedules = await afterPause.schedulesForCron("0 2 * * *");
    expect(expiredCronSchedules).toHaveLength(1);
    expect(expiredCronSchedules[0]).toMatchObject({ id: "daily" });
    expect(Object.prototype.hasOwnProperty.call(expiredCronSchedules[0], "enabled")).toBe(false);

    await expect(service.clearOverride(admin, "daily")).resolves.toMatchObject({
      schedule: { id: "daily", enabled: true, overridden: false, dispatchable: true }
    });

    const disabledEvents = new InMemoryEventStore();
    const disabledThenPaused = new JobScheduleService({
      registry,
      schedules: [{ id: "daily", cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" }],
      events: disabledEvents,
      clock: fixedClock(now),
      ids: deterministicIds(["disable-daily", "pause-disabled-daily"])
    });
    await disabledThenPaused.disable(admin, "daily");
    await disabledThenPaused.pause(admin, "daily", { pausedUntil });

    const afterDisabledPauseExpires = new JobScheduleService({
      registry,
      schedules: [{ id: "daily", cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" }],
      events: disabledEvents,
      clock: fixedClock("2026-01-03T00:00:00.000Z")
    });
    await expect(afterDisabledPauseExpires.dashboard(admin)).resolves.toMatchObject({
      schedules: [{ id: "daily", enabled: false, overridden: true, overrideEnabled: false, dispatchable: false }]
    });
    await expect(afterDisabledPauseExpires.schedulesForCron("0 2 * * *")).resolves.toMatchObject([
      { id: "daily", enabled: false }
    ]);
  });

  it("saves, dispatches, updates, and deletes tenant-owned runtime schedule definitions from events", async () => {
    const registry = createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] });
    const events = new InMemoryEventStore();
    const runner = vi.fn(async () => jobMessage("reports.daily", "job_runtime", "acme"));
    const service = new JobScheduleService({
      registry,
      schedules: [{ id: "static-daily", cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" }],
      runner: { run: runner },
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["save-runtime", "update-runtime", "delete-runtime"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(
      service.save(admin, {
        id: "runtime-daily",
        cron: "15 4 * * *",
        jobName: "reports.daily",
        enabled: true,
        payload: { scope: "runtime" },
        metadata: { source: "desk" },
        idempotencyKey: "runtime-daily-key",
        delaySeconds: 45
      })
    ).resolves.toMatchObject({
      schedule: {
        id: "runtime-daily",
        source: "runtime",
        editable: true,
        cron: "15 4 * * *",
        jobName: "reports.daily",
        tenantId: "acme",
        enabled: true,
        configuredEnabled: true,
        overrideable: false,
        registered: true,
        dispatchable: true,
        delaySeconds: 45
      }
    });

    await expect(service.dashboard(admin)).resolves.toMatchObject({
      schedules: [
        { id: "static-daily", source: "configured", editable: false },
        { id: "runtime-daily", source: "runtime", editable: true, delaySeconds: 45 }
      ]
    });
    await expect(service.schedulesForCron("15 4 * * *")).resolves.toMatchObject([
      {
        id: "runtime-daily",
        cron: "15 4 * * *",
        jobName: "reports.daily",
        tenantId: "acme",
        payload: { scope: "runtime" },
        metadata: { source: "desk" },
        idempotencyKey: "runtime-daily-key",
        delaySeconds: 45
      }
    ]);
    await expect(service.dispatch(admin, "runtime-daily")).resolves.toMatchObject({
      schedule: { id: "runtime-daily", source: "runtime", dispatchable: true },
      message: { idempotencyKey: "reports.daily:job_runtime" }
    });
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "runtime-daily",
        payload: { scope: "runtime" },
        metadata: { source: "desk" }
      }),
      admin
    );

    await expect(
      service.save(admin, {
        id: "runtime-daily",
        cron: "30 5 * * *",
        jobName: "reports.daily",
        enabled: false
      })
    ).resolves.toMatchObject({
      schedule: {
        id: "runtime-daily",
        cron: "30 5 * * *",
        enabled: false,
        configuredEnabled: false,
        dispatchable: false
      }
    });
    await expect(service.schedulesForCron("15 4 * * *")).resolves.toEqual([]);
    await expect(service.dispatch(admin, "runtime-daily")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Disabled job schedules cannot be manually dispatched"
    });

    await expect(service.delete(admin, "runtime-daily")).resolves.toMatchObject({
      schedule: { id: "runtime-daily", deleted: true, editable: true }
    });
    await expect(service.dashboard(admin)).resolves.toMatchObject({
      schedules: [{ id: "static-daily" }]
    });
    await expect(service.schedulesForCron("30 5 * * *")).resolves.toEqual([]);
    await expect(events.readStream(jobScheduleDefinitionsStream())).resolves.toMatchObject([
      { type: "JobScheduleSaved", payload: { kind: "JobScheduleSaved", scheduleId: "runtime-daily" } },
      { type: "JobScheduleSaved", payload: { kind: "JobScheduleSaved", scheduleId: "runtime-daily" } },
      { type: "JobScheduleDeleted", payload: { kind: "JobScheduleDeleted", scheduleId: "runtime-daily" } }
    ]);
  });

  it("fails explicitly when a saved runtime schedule cannot be replayed", async () => {
    const registry = createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] });
    const events = new ReplayMissingDefinitionEventStore();
    const service = new JobScheduleService({
      registry,
      schedules: [],
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["save-runtime"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(
      service.save(admin, {
        id: "runtime-daily",
        cron: "15 4 * * *",
        jobName: "reports.daily"
      })
    ).rejects.toThrow("Saved job schedule 'runtime-daily' for tenant 'acme' was not found after replay");
    expect(events.appended).toMatchObject([
      {
        stream: jobScheduleDefinitionsStream(),
        payload: { kind: "JobScheduleSaved", scheduleId: "runtime-daily" }
      }
    ]);
  });

  it("rejects runtime schedules with queue delays outside the delivery window before appending events", async () => {
    const registry = createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] });
    const events = new InMemoryEventStore();
    const service = new JobScheduleService({
      registry,
      schedules: [],
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["save-runtime"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(
      service.save(admin, {
        id: "runtime-daily",
        cron: "15 4 * * *",
        jobName: "reports.daily",
        delaySeconds: 86_401
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "delaySeconds must be an integer between 0 and 86400"
    });
    await expect(events.readStream(jobScheduleDefinitionsStream())).resolves.toEqual([]);
  });

  it("rejects runtime schedules with oversized idempotency keys before appending events", async () => {
    const registry = createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] });
    const events = new InMemoryEventStore();
    const service = new JobScheduleService({
      registry,
      schedules: [],
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["save-runtime"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(
      service.save(admin, {
        id: "runtime-daily",
        cron: "15 4 * * *",
        jobName: "reports.daily",
        idempotencyKey: "x".repeat(257)
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Job schedule idempotencyKey must be at most 256 characters"
    });
    await expect(events.readStream(jobScheduleDefinitionsStream())).resolves.toEqual([]);
  });

  it("keeps runtime schedule ids tenant-scoped in the global definition stream", async () => {
    const registry = createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] });
    const events = new InMemoryEventStore();
    const service = new JobScheduleService({
      registry,
      schedules: [],
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["save-acme", "save-beta"])
    });
    const acmeAdmin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const betaAdmin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "beta" };

    await service.save(acmeAdmin, {
      id: "runtime-daily",
      cron: "15 4 * * *",
      jobName: "reports.daily",
      payload: { tenant: "acme" }
    });
    await service.save(betaAdmin, {
      id: "runtime-daily",
      cron: "15 4 * * *",
      jobName: "reports.daily",
      payload: { tenant: "beta" }
    });

    await expect(service.dashboard(acmeAdmin)).resolves.toMatchObject({
      schedules: [{ id: "runtime-daily", tenantId: "acme" }]
    });
    await expect(service.dashboard(betaAdmin)).resolves.toMatchObject({
      schedules: [{ id: "runtime-daily", tenantId: "beta" }]
    });
    await expect(service.schedulesForCron("15 4 * * *")).resolves.toMatchObject([
      { id: "runtime-daily", tenantId: "acme", payload: { tenant: "acme" } },
      { id: "runtime-daily", tenantId: "beta", payload: { tenant: "beta" } }
    ]);
    await expect(events.searchEvents({ tenantId: "acme", payloadKinds: ["JobScheduleSaved"] })).resolves.toMatchObject([
      {
        tenantId: "acme",
        payload: { kind: "JobScheduleSaved", scheduleId: "runtime-daily", tenantId: "acme" }
      }
    ]);
  });

  it("validates runtime schedule crons against an explicit trigger catalog", async () => {
    const registry = createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] });
    const service = new JobScheduleService({
      registry,
      schedules: [],
      events: new InMemoryEventStore(),
      runtimeCronTriggers: ["15 4 * * *"],
      clock: fixedClock(now),
      ids: deterministicIds(["save-runtime"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(
      service.save(admin, { id: "runtime-daily", cron: "15 4 * * *", jobName: "reports.daily" })
    ).resolves.toMatchObject({ schedule: { id: "runtime-daily", cron: "15 4 * * *" } });
    await expect(
      service.save(admin, { id: "runtime-hourly", cron: "0 * * * *", jobName: "reports.daily" })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Job schedule cron '0 * * * *' is not configured as a Worker Cron Trigger"
    });
  });

  it("preserves payload metadata and idempotency key for form-style runtime schedule updates", async () => {
    const registry = createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] });
    const service = new JobScheduleService({
      registry,
      schedules: [],
      events: new InMemoryEventStore(),
      clock: fixedClock(now),
      ids: deterministicIds(["save-runtime", "update-runtime"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await service.save(admin, {
      id: "runtime-daily",
      cron: "15 4 * * *",
      jobName: "reports.daily",
      payload: { scope: "api" },
      metadata: { source: "api" },
      idempotencyKey: "runtime-key",
      delaySeconds: 30
    });
    await service.save(admin, {
      id: "runtime-daily",
      cron: "30 5 * * *",
      jobName: "reports.daily",
      enabled: false,
      preserveExistingFields: true
    });

    await expect(service.schedulesForCron("30 5 * * *")).resolves.toMatchObject([
      {
        id: "runtime-daily",
        payload: { scope: "api" },
        metadata: { source: "api" },
        idempotencyKey: "runtime-key",
        enabled: false
      }
    ]);
  });

  it("keeps dynamic schedules immutable and validates configured schedule ids", async () => {
    const registry = createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const defaultAdmin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: DEFAULT_TENANT_ID };
    const service = new JobScheduleService({
      registry,
      schedules: [
        { id: "tenant-dynamic", cron: "0 2 * * *", jobName: "reports.daily", tenantId: () => "acme" },
        { id: "enabled-dynamic", cron: "0 3 * * *", jobName: "reports.daily", tenantId: "acme", enabled: () => true },
        { id: "static", cron: "0 4 * * *", jobName: "reports.daily", tenantId: "acme" }
      ],
      events: new InMemoryEventStore(),
      clock: fixedClock(now),
      ids: deterministicIds(["unused"])
    });

    await expect(service.disable(defaultAdmin, "tenant-dynamic")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Dynamic tenant job schedules cannot be overridden"
    });
    await expect(service.disable(admin, "enabled-dynamic")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Dynamic enabled job schedules cannot be overridden"
    });
    expect(() =>
      new JobScheduleService({ registry, schedules: [{ id: " ", cron: "* * * * *", jobName: "reports.daily" }] })
    ).toThrow("Job schedule id is required");
    expect(() =>
      new JobScheduleService({
        registry,
        schedules: [
          { id: "duplicate", cron: "0 2 * * *", jobName: "reports.daily" },
          { id: "duplicate", cron: "0 3 * * *", jobName: "reports.daily" }
        ]
      })
    ).toThrow("Job schedule id 'duplicate' is duplicated");
    await expect(
      new JobScheduleService({ registry, schedules: [{ id: "static", cron: "0 4 * * *", jobName: "reports.daily" }] })
        .disable(admin, "static")
    ).rejects.toMatchObject({
      code: "JOB_SCHEDULE_NOT_FOUND",
      message: "Job schedule overrides are not enabled"
    });

    const generatedIdService = new JobScheduleService({
      registry,
      schedules: [{ cron: "0 7 * * *", jobName: "reports.daily", tenantId: "acme" }],
      events: new InMemoryEventStore()
    });
    await expect(generatedIdService.dashboard(admin)).resolves.toMatchObject({
      schedules: [{ id: "1", overrideable: false }]
    });
    await expect(generatedIdService.disable(admin, "1")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Job schedule id is required for runtime overrides"
    });
  });

  it("ignores stale overrides when app metadata changes a schedule to dynamic enabled", async () => {
    const registry = createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] });
    const events = new InMemoryEventStore();
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const staticService = new JobScheduleService({
      registry,
      schedules: [{ id: "daily", cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" }],
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["disable-daily"])
    });
    await staticService.disable(admin, "daily");

    const runner = vi.fn(async () => jobMessage("reports.daily", "job_manual", "acme"));
    const evolvedService = new JobScheduleService({
      registry,
      schedules: [{ id: "daily", cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme", enabled: () => false }],
      runner: { run: runner },
      events
    });

    await expect(evolvedService.dashboard(admin)).resolves.toMatchObject({
      schedules: [
        {
          id: "daily",
          overridden: false,
          overrideable: false,
          dynamic: { enabled: true }
        }
      ]
    });
    const [schedule] = await evolvedService.schedulesForCron("0 2 * * *");
    expect(typeof schedule?.enabled).toBe("function");
    await expect(evolvedService.dispatch(admin, "daily")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Dynamic enabled job schedules cannot be manually dispatched"
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("rejects non-admin, cross-tenant, and invalid schedule dispatch", async () => {
    const registry = createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] });
    const runner = vi.fn(async () => jobMessage("reports.daily", "job_manual", "acme"));
    const service = new JobScheduleService({
      registry,
      schedules: [
        { cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" },
        { cron: "0 3 * * *", jobName: "missing.job", tenantId: "acme" },
        { cron: "0 4 * * *", jobName: "reports.daily", tenantId: () => "acme" },
        { cron: "0 5 * * *", jobName: "reports.daily", tenantId: "acme", enabled: false },
        { cron: "0 6 * * *", jobName: "reports.daily", tenantId: "acme", enabled: () => true }
      ],
      runner: { run: runner }
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const otherAdmin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "other" };
    const defaultAdmin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: DEFAULT_TENANT_ID };

    await expect(service.dashboard({ id: "owner@example.com", roles: ["User"], tenantId: "acme" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
    await expect(service.dispatch(otherAdmin, "1")).rejects.toMatchObject({
      code: "JOB_SCHEDULE_NOT_FOUND"
    });
    await expect(service.dispatch(admin, "2")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Scheduled job 'missing.job' is not registered"
    });
    await expect(service.dispatch(defaultAdmin, "3")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Dynamic tenant job schedules cannot be manually dispatched"
    });
    await expect(service.dispatch(admin, "4")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Disabled job schedules cannot be manually dispatched"
    });
    await expect(service.dispatch(admin, "5")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Dynamic enabled job schedules cannot be manually dispatched"
    });
    expect(runner).not.toHaveBeenCalled();
  });
});

function jobSchedulePayload(
  payload: Extract<DocumentEventPayload, { readonly kind: "JobScheduleSaved" }>
): Extract<JobScheduleEventPayload, { readonly kind: "JobScheduleSaved" }> {
  return payload;
}

class ReplayMissingDefinitionEventStore implements EventStore {
  readonly appended: NewDomainEvent[] = [];

  async append(
    _stream: StreamName,
    _expectedVersion: number,
    events: readonly NewDomainEvent[]
  ): Promise<readonly DomainEvent[]> {
    this.appended.push(...events);
    return [];
  }

  async readStream(_stream: StreamName, _options?: ReadStreamOptions): Promise<readonly DomainEvent[]> {
    return [];
  }

  async currentVersion(_stream: StreamName): Promise<number> {
    return 0;
  }
}

describe("job retry classification", () => {
  it("uses exponential backoff for retryable failures", () => {
    expect(
      classifyJobError(retryableJobError("busy"), { maxAttempts: 3, baseDelaySeconds: 5 }, 2)
    ).toEqual({ action: "retry", delaySeconds: 10 });
  });

  it("honors explicit retry delays", () => {
    expect(classifyJobError(retryableJobError("rate limited", 120), { maxAttempts: 3 }, 1)).toEqual({
      action: "retry",
      delaySeconds: 120
    });
  });

  it("rejects retry delays outside Cloudflare Queue retry bounds", () => {
    expect(() => retryableJobError("rate limited", 0)).toThrow(
      "Job retry delaySeconds must be an integer between 1 and 86400"
    );
    expect(() => classifyJobError(retryableJobError("busy"), { baseDelaySeconds: 86_401 }, 1)).toThrow(
      "Job retry policy baseDelaySeconds must be an integer between 1 and 86400"
    );
  });

  it("fails permanent and exhausted errors", () => {
    expect(classifyJobError(permanentJobError("bad payload"), {}, 1)).toEqual({ action: "fail" });
    expect(classifyJobError(retryableJobError("still down"), { maxAttempts: 2 }, 2)).toEqual({
      action: "fail"
    });
    expect(classifyJobError(badRequest("invalid"), {}, 1)).toEqual({ action: "fail" });
  });
});

function jobMessage(
  jobName: string,
  runId: string,
  tenantId?: string,
  options: { readonly payload?: DocumentData; readonly metadata?: DocumentData } = {}
): JobMessage {
  return {
    ...(tenantId === undefined ? {} : { tenantId }),
    jobName,
    payload: options.payload ?? {},
    runId,
    idempotencyKey: `${jobName}:${runId}`,
    enqueuedAt: now,
    metadata: options.metadata ?? {}
  };
}
