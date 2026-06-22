import { D1JobExecutionLog } from "../../src";
import type { DocumentData, JobExecutionRecord, JobMessage, JsonValue } from "../../src";
import { now } from "../helpers";

describe("D1JobExecutionLog", () => {
  it("persists job execution transitions and reuses terminal records for duplicate protection", async () => {
    const db = new FakeD1Database();
    const log = new D1JobExecutionLog(db as unknown as D1Database);
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

  it("claims duplicate deliveries atomically without overwriting running records", async () => {
    const db = new FakeD1Database();
    const log = new D1JobExecutionLog(db as unknown as D1Database);
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
    const claim = db.statements.find((statement) => statement.sql.includes("RETURNING tenant_id"));
    expect(claim?.sql).toContain("ON CONFLICT(tenant_id, idempotency_key)");
    expect(claim?.sql).toContain("WHERE cf_frappe_job_executions.status = 'failed'");
  });

  it("scopes duplicate idempotency keys by tenant", async () => {
    const db = new FakeD1Database();
    const log = new D1JobExecutionLog(db as unknown as D1Database);

    await expect(log.begin(jobMessage("reports.daily", "job_001", "acme"), now)).resolves.toMatchObject({
      status: "started"
    });
    await expect(log.begin(jobMessage("reports.daily", "job_001", "other"), now)).resolves.toMatchObject({
      status: "started",
      record: { tenantId: "other", idempotencyKey: "reports.daily:job_001" }
    });
  });

  it("reclaims failed records for retry attempts", async () => {
    const db = new FakeD1Database();
    const log = new D1JobExecutionLog(db as unknown as D1Database);
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
    const db = new FakeD1Database();
    const log = new D1JobExecutionLog(db as unknown as D1Database);
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
    const statement = db.statements.at(-1);
    expect(statement?.sql).toContain("tenant_id = ?");
    expect(statement?.sql).toContain("status = ?");
    expect(statement?.sql).toContain("ORDER BY started_at DESC, idempotency_key ASC LIMIT ?");
    expect(statement?.params).toEqual(["default", "failed", 5]);
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

class FakeD1Database {
  readonly records = new Map<string, JobExecutionRecord>();
  readonly statements: FakeD1PreparedStatement[] = [];

  prepare(sql: string): FakeD1PreparedStatement {
    const statement = new FakeD1PreparedStatement(this, sql);
    this.statements.push(statement);
    return statement;
  }
}

class FakeD1PreparedStatement {
  params: readonly unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    readonly sql: string
  ) {}

  bind(...params: readonly unknown[]): FakeD1PreparedStatement {
    this.params = params;
    return this;
  }

  async first(): Promise<JobExecutionRow | null> {
    if (this.sql.includes("INSERT INTO cf_frappe_job_executions")) {
      const [tenantId, idempotencyKey, jobName, runId, payloadJson, metadataJson, enqueuedAt, startedAt] = this.params;
      const key = recordKey(String(tenantId), String(idempotencyKey));
      const existing = this.db.records.get(key);
      if (existing && existing.status !== "failed") {
        return null;
      }
      const payload = JSON.parse(String(payloadJson)) as DocumentData;
      const metadata = JSON.parse(String(metadataJson)) as DocumentData;
      const record: JobExecutionRecord = {
        tenantId: String(tenantId),
        idempotencyKey: String(idempotencyKey),
        jobName: String(jobName),
        runId: String(runId),
        payload,
        metadata,
        enqueuedAt: String(enqueuedAt),
        status: "running",
        startedAt: String(startedAt)
      };
      this.db.records.set(key, record);
      return rowFromRecord(record);
    }
    const hasTenant = this.sql.includes("tenant_id = ? AND idempotency_key = ?");
    const tenantId = hasTenant ? String(this.params[0]) : undefined;
    const idempotencyKey = String(this.params[hasTenant ? 1 : 0]);
    const record = tenantId === undefined
      ? [...this.db.records.values()].find((item) => item.idempotencyKey === idempotencyKey)
      : this.db.records.get(recordKey(tenantId, idempotencyKey));
    return record ? rowFromRecord(record) : null;
  }

  async all(): Promise<{ readonly results: readonly JobExecutionRow[] }> {
    let index = 0;
    const tenantId = this.sql.includes("tenant_id = ?") ? String(this.params[index++]) : undefined;
    const jobName = this.sql.includes("job_name = ?") ? String(this.params[index++]) : undefined;
    const status = this.sql.includes("status = ?") ? String(this.params[index++]) : undefined;
    const runId = this.sql.includes("run_id = ?") ? String(this.params[index++]) : undefined;
    const limit = Number(this.params.at(-1));
    const results = [...this.db.records.values()]
      .filter((record) => tenantId === undefined || record.tenantId === tenantId)
      .filter((record) => jobName === undefined || record.jobName === jobName)
      .filter((record) => status === undefined || record.status === status)
      .filter((record) => runId === undefined || record.runId === runId)
      .sort((left, right) => {
        const started = right.startedAt.localeCompare(left.startedAt);
        return started === 0 ? left.idempotencyKey.localeCompare(right.idempotencyKey) : started;
      })
      .slice(0, limit)
      .map(rowFromRecord);
    return { results };
  }

  async run(): Promise<{ readonly success: true }> {
    const [
      tenantId,
      idempotencyKey,
      jobName,
      runId,
      payloadJson,
      metadataJson,
      enqueuedAt,
      status,
      startedAt,
      finishedAt,
      resultJson,
      error
    ] = this.params;
    const payload = payloadJson === null ? undefined : JSON.parse(String(payloadJson)) as JobExecutionRecord["payload"];
    const metadata = metadataJson === null ? undefined : JSON.parse(String(metadataJson)) as JobExecutionRecord["metadata"];
    const result = resultJson === null ? undefined : JSON.parse(String(resultJson)) as JsonValue;
    this.db.records.set(recordKey(String(tenantId), String(idempotencyKey)), {
      tenantId: String(tenantId),
      idempotencyKey: String(idempotencyKey),
      jobName: String(jobName),
      runId: String(runId),
      ...(payload === undefined ? {} : { payload }),
      ...(metadata === undefined ? {} : { metadata }),
      ...(enqueuedAt === null ? {} : { enqueuedAt: String(enqueuedAt) }),
      status: status as JobExecutionRecord["status"],
      startedAt: String(startedAt),
      ...(finishedAt === null ? {} : { finishedAt: String(finishedAt) }),
      ...(result === undefined ? {} : { result }),
      ...(error === null ? {} : { error: String(error) })
    });
    return { success: true };
  }
}

interface JobExecutionRow {
  readonly tenant_id: string;
  readonly idempotency_key: string;
  readonly job_name: string;
  readonly run_id: string;
  readonly payload_json: string | null;
  readonly metadata_json: string | null;
  readonly enqueued_at: string | null;
  readonly status: JobExecutionRecord["status"];
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly result_json: string | null;
  readonly error: string | null;
}

function rowFromRecord(record: JobExecutionRecord): JobExecutionRow {
  return {
    tenant_id: record.tenantId,
    idempotency_key: record.idempotencyKey,
    job_name: record.jobName,
    run_id: record.runId,
    payload_json: record.payload === undefined ? null : JSON.stringify(record.payload),
    metadata_json: record.metadata === undefined ? null : JSON.stringify(record.metadata),
    enqueued_at: record.enqueuedAt ?? null,
    status: record.status,
    started_at: record.startedAt,
    finished_at: record.finishedAt ?? null,
    result_json: record.result === undefined ? null : JSON.stringify(record.result),
    error: record.error ?? null
  };
}

function recordKey(tenantId: string, idempotencyKey: string): string {
  return `${tenantId}\0${idempotencyKey}`;
}
