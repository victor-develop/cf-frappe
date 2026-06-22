import {
  createJobRegistry,
  createResourceApi,
  InMemoryJobExecutionLog,
  JobHistoryService,
  SYSTEM_MANAGER_ROLE,
  unsafeHeaderActorResolver
} from "../../src";
import { createServices, now } from "../helpers";

describe("job api", () => {
  it("returns admin job definitions and execution history", async () => {
    const services = createServices();
    const executionLog = new InMemoryJobExecutionLog();
    const registry = createJobRegistry({
      jobs: [{ name: "reports.daily", description: "Build reports", handler: () => undefined }]
    });
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      jobs: new JobHistoryService({ registry, executionLog }),
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
});

const adminHeaders = {
  "x-cf-frappe-user": "admin@example.com",
  "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
  "x-cf-frappe-tenant": "acme"
};
