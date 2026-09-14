import { D1JobExecutionLog } from "../../src";
import { d1JobExecutionListQuery } from "../../src/adapters/d1/job-execution-query.js";
import type { DocumentData, JobMessage, JsonValue } from "../../src";
import { createTestD1, frameworkSchema, type TestD1 } from "../d1-engine.js";
import { now } from "../helpers";

describe("D1JobExecutionLog", () => {
  it("persists job execution transitions and reuses terminal records for duplicate protection", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const log = new D1JobExecutionLog(d1.database);
    const message = jobMessage("reports.daily", "job_001");

    await expect(log.begin(message, now)).resolves.toMatchObject({ status: "started" });
    await log.complete(message, "2026-01-01T00:01:00.000Z", { rows: 3 });

    await expect(log.begin(message, "2026-01-01T00:02:00.000Z")).resolves.toMatchObject({
      status: "duplicate",
      record: {
        tenantId: "default",
        idempotencyKey: "reports.daily:job_001",
        status: "succeeded",
        payload: {},
        metadata: {},
        enqueuedAt: now,
        result: { rows: 3 }
      }
    });
  });

  it("snapshots D1 job execution records across writes and reads", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const log = new D1JobExecutionLog(d1.database);
    const message = jobMessage("reports.daily", "job_001", "acme", {
      payload: { report: "daily", nested: { count: 1 } },
      metadata: { source: "queue", nested: { attempt: 1 } }
    });
    const result = { summary: { rows: 3 }, tags: ["daily"] };

    const started = await log.begin(message, "2026-01-01T00:00:00.000Z");
    (message.payload.nested as DocumentData).count = 2;
    (message.metadata.nested as DocumentData).attempt = 2;
    if (started.status === "started") {
      (started.record.payload!.nested as DocumentData).count = 3;
      (started.record.metadata!.nested as DocumentData).attempt = 3;
    }
    await log.complete(message, "2026-01-01T00:01:00.000Z", result);
    result.summary.rows = 4;
    result.tags.push("mutated");

    const [listed] = await log.list({ tenantId: "acme" });
    expect(listed).toMatchObject({
      payload: { report: "daily", nested: { count: 1 } },
      metadata: { source: "queue", nested: { attempt: 1 } },
      result: { summary: { rows: 3 }, tags: ["daily"] }
    });

    (listed!.payload!.nested as DocumentData).count = 5;
    (listed!.metadata!.nested as DocumentData).attempt = 5;
    ((listed!.result as DocumentData).summary as DocumentData).rows = 5;
    ((listed!.result as DocumentData).tags as JsonValue[]).push("listed");

    await expect(log.get("reports.daily:job_001", { tenantId: "acme" })).resolves.toMatchObject({
      payload: { report: "daily", nested: { count: 1 } },
      metadata: { source: "queue", nested: { attempt: 1 } },
      result: { summary: { rows: 3 }, tags: ["daily"] }
    });
  });

  it("claims duplicate deliveries atomically without overwriting running records", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const log = new D1JobExecutionLog(d1.database);
    const message = jobMessage("reports.daily", "job_001", "acme");

    await expect(log.begin(message, now)).resolves.toMatchObject({ status: "started" });
    await expect(log.begin(message, "2026-01-01T00:00:01.000Z")).resolves.toMatchObject({
      status: "duplicate",
      record: {
        tenantId: "acme",
        idempotencyKey: "reports.daily:job_001",
        status: "running",
        startedAt: now
      }
    });
    const claim = d1.executed.find((sql) => sql.includes("RETURNING tenant_id"));
    expect(claim).toBeDefined();
    expect(claim).toContain("ON CONFLICT(tenant_id, idempotency_key)");
    expect(claim).toContain("WHERE cf_frappe_job_executions.status = 'failed'");
  });


  it("scopes duplicate idempotency keys by tenant", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const log = new D1JobExecutionLog(d1.database);

    await expect(log.begin(jobMessage("reports.daily", "job_001", "acme"), now)).resolves.toMatchObject({
      status: "started"
    });
    await expect(log.begin(jobMessage("reports.daily", "job_001", "other"), now)).resolves.toMatchObject({
      status: "started",
      record: { tenantId: "other", idempotencyKey: "reports.daily:job_001" }
    });
  });

  it("reclaims failed records for retry attempts", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const log = new D1JobExecutionLog(d1.database);
    const message = jobMessage("email.digest", "job_003", "acme", {
      payload: { account: "acme" },
      metadata: { source: "manual" }
    });

    await log.begin(message, now);
    await log.fail(message, "2026-01-01T00:01:00.000Z", "smtp timeout");

    await expect(log.begin(message, "2026-01-01T00:02:00.000Z")).resolves.toMatchObject({
      status: "started",
      record: {
        tenantId: "acme",
        status: "running",
        payload: { account: "acme" },
        metadata: { source: "manual" },
        startedAt: "2026-01-01T00:02:00.000Z"
      }
    });
  });

  it("lists filtered executions with bound parameters in newest-first order", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const log = new D1JobExecutionLog(d1.database);
    const first = jobMessage("reports.daily", "job_001");
    const second = jobMessage("email.digest", "job_002");

    await log.begin(first, "2026-01-01T00:00:00.000Z");
    await log.complete(first, "2026-01-01T00:01:00.000Z", undefined);
    await log.begin(second, "2026-01-01T00:02:00.000Z");
    await log.fail(second, "2026-01-01T00:03:00.000Z", new Error("mail service down"));

    await expect(log.list({ tenantId: "default", status: "failed", limit: 5 })).resolves.toMatchObject([
      {
        tenantId: "default",
        idempotencyKey: "email.digest:job_002",
        status: "failed",
        error: "mail service down"
      }
    ]);
    const statement = d1.statements.at(-1);
    expect(statement?.sql).toContain("tenant_id = ?");
    expect(statement?.sql).toContain("status = ?");
    expect(statement?.sql).toContain("ORDER BY started_at DESC, idempotency_key ASC LIMIT ?");
    expect(statement?.params).toEqual(["default", "failed", 5]);
  });

  it("plans D1 job execution list filters as bound SQL", () => {
    const filtered = d1JobExecutionListQuery({
      tenantId: "acme",
      jobName: "reports.daily",
      status: "failed",
      runId: "run_001",
      limit: 7
    });

    expect(filtered.sql).toContain(
      "WHERE tenant_id = ? AND job_name = ? AND status = ? AND run_id = ?"
    );
    expect(filtered.sql).toContain("ORDER BY started_at DESC, idempotency_key ASC LIMIT ?");
    expect(filtered.params).toEqual(["acme", "reports.daily", "failed", "run_001", 7]);

    const unfiltered = d1JobExecutionListQuery({});
    expect(unfiltered.sql).not.toContain("WHERE");
    expect(unfiltered.params).toEqual([50]);
  });

  it("rejects invalid stored D1 job execution JSON", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const log = new D1JobExecutionLog(d1.database);
    const key = "jobs.bad:run_001";

    seedRow(d1, { idempotency_key: key, payload_json: "[]" });
    await expect(log.get(key, { tenantId: "default" })).rejects.toMatchObject({
      code: "JOB_EXECUTION_INVALID",
      status: 409
    });

    seedRow(d1, { idempotency_key: key, payload_json: "{}", metadata_json: "{" });
    await expect(log.get(key, { tenantId: "default" })).rejects.toMatchObject({
      code: "JOB_EXECUTION_INVALID",
      status: 409
    });

    seedRow(d1, { idempotency_key: key, payload_json: "{}", metadata_json: "{}", result_json: "{" });
    await expect(log.get(key, { tenantId: "default" })).rejects.toMatchObject({
      code: "JOB_EXECUTION_INVALID",
      status: 409
    });
  });

  it("rejects stored D1 job execution results with non-finite JSON numbers", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const log = new D1JobExecutionLog(d1.database);

    seedRow(d1, { idempotency_key: "jobs.bad:run_001", result_json: "1e999" });
    await expect(log.get("jobs.bad:run_001", { tenantId: "default" })).rejects.toMatchObject({
      code: "JOB_EXECUTION_INVALID",
      status: 409
    });
  });

  it("rejects non-JSON D1 job execution payloads before claiming", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const log = new D1JobExecutionLog(d1.database);
    const message = jobMessage("jobs.bad", "run_001", "default", {
      payload: { count: Number.POSITIVE_INFINITY } as never
    });

    await expect(log.begin(message, now)).rejects.toMatchObject({
      code: "JOB_EXECUTION_INVALID",
      status: 409
    });
    expect(rowCount(d1)).toBe(0);
  });

  it("rejects non-JSON D1 job execution metadata before claiming", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const log = new D1JobExecutionLog(d1.database);
    const message = jobMessage("jobs.bad", "run_001", "default", {
      metadata: { count: Number.POSITIVE_INFINITY } as never
    });

    await expect(log.begin(message, now)).rejects.toMatchObject({
      code: "JOB_EXECUTION_INVALID",
      status: 409
    });
    expect(rowCount(d1)).toBe(0);
  });

  it("rejects non-JSON D1 job execution results before completing", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const log = new D1JobExecutionLog(d1.database);
    const message = jobMessage("jobs.bad", "run_001", "default");

    await log.begin(message, now);
    await expect(
      log.complete(message, "2026-01-01T00:01:00.000Z", Number.POSITIVE_INFINITY as never)
    ).rejects.toMatchObject({
      code: "JOB_EXECUTION_INVALID",
      status: 409
    });
    await expect(log.get(message.idempotencyKey, { tenantId: "default" })).resolves.toMatchObject({
      status: "running"
    });
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

/**
 * Inserts a row with the exact column values given, bypassing the adapter.
 *
 * These are rows real D1 could hold but the adapter's own writes never produce
 * — the hand-rolled fake used to keep them in a side map that shadowed the
 * table. Seeding the real table keeps the corrupt bytes where `get` reads them,
 * with SQLite deciding what the SELECT returns.
 */
function seedRow(
  d1: TestD1,
  overrides: {
    readonly idempotency_key: string;
    readonly payload_json?: string | null;
    readonly metadata_json?: string | null;
    readonly result_json?: string | null;
  }
): void {
  d1.query(
    `INSERT OR REPLACE INTO cf_frappe_job_executions
       (tenant_id, idempotency_key, job_name, run_id, payload_json, metadata_json,
        enqueued_at, status, started_at, finished_at, result_json, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "default",
    overrides.idempotency_key,
    "jobs.bad",
    "run_001",
    overrides.payload_json ?? "{}",
    overrides.metadata_json ?? "{}",
    now,
    "succeeded",
    now,
    now,
    overrides.result_json ?? null,
    null
  );
}

function rowCount(d1: TestD1): number {
  const [row] = d1.query("SELECT COUNT(*) AS n FROM cf_frappe_job_executions");
  return Number(row?.n);
}
