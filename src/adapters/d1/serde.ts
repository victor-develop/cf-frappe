import { FrameworkError } from "../../core/errors.js";
import type { DocumentData, DocumentSnapshot, DomainEvent, JsonValue } from "../../core/types.js";
import type { JobExecutionRecord } from "../../ports/job-execution-log.js";

export interface EventRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly stream: string;
  readonly sequence: number;
  readonly type: DomainEvent["type"];
  readonly doctype: string;
  readonly document_name: string;
  readonly actor_id: string;
  readonly occurred_at: string;
  readonly payload_json: string;
  readonly metadata_json: string;
}

export interface DocumentRow {
  readonly tenant_id: string;
  readonly doctype: string;
  readonly name: string;
  readonly version: number;
  readonly docstatus: DocumentSnapshot["docstatus"];
  readonly data_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface JobExecutionRow {
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

export function eventFromRow(row: EventRow): DomainEvent {
  const payload = JSON.parse(row.payload_json) as DomainEvent["payload"];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    stream: row.stream,
    sequence: row.sequence,
    type: row.type,
    doctype: row.doctype,
    documentName: row.document_name,
    actorId: row.actor_id,
    occurredAt: row.occurred_at,
    payload,
    metadata: JSON.parse(row.metadata_json) as DocumentData
  };
}

export function documentFromRow(row: DocumentRow): DocumentSnapshot {
  return {
    tenantId: row.tenant_id,
    doctype: row.doctype,
    name: row.name,
    version: row.version,
    docstatus: row.docstatus,
    data: JSON.parse(row.data_json) as DocumentData,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function jobExecutionFromRow(row: JobExecutionRow): JobExecutionRecord {
  const result = row.result_json === null ? undefined : parseJobJsonValue(row, "result_json", row.result_json);
  const payload = row.payload_json === null ? undefined : parseJobDocumentData(row, "payload_json", row.payload_json);
  const metadata = row.metadata_json === null ? undefined : parseJobDocumentData(row, "metadata_json", row.metadata_json);
  return {
    idempotencyKey: row.idempotency_key,
    tenantId: row.tenant_id,
    jobName: row.job_name,
    runId: row.run_id,
    ...(payload === undefined ? {} : { payload }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(row.enqueued_at === null ? {} : { enqueuedAt: row.enqueued_at }),
    status: row.status,
    startedAt: row.started_at,
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
    ...(result === undefined ? {} : { result }),
    ...(row.error === null ? {} : { error: row.error })
  };
}

function parseJobDocumentData(
  row: JobExecutionRow,
  field: "payload_json" | "metadata_json",
  value: string
): DocumentData {
  const parsed = parseJobJsonValue(row, field, value);
  if (isJsonRecord(parsed)) {
    return parsed;
  }
  throw invalidJobExecutionJson(row, field);
}

function parseJobJsonValue(
  row: JobExecutionRow,
  field: "payload_json" | "metadata_json" | "result_json",
  value: string
): JsonValue {
  try {
    const parsed: unknown = JSON.parse(value);
    if (isJsonValue(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through to the framework boundary error below.
  }
  throw invalidJobExecutionJson(row, field);
}

function invalidJobExecutionJson(
  row: JobExecutionRow,
  field: "payload_json" | "metadata_json" | "result_json"
): FrameworkError {
  return new FrameworkError(
    "JOB_EXECUTION_INVALID",
    `Job execution '${row.idempotency_key}' has invalid ${field}`,
    { status: 409 }
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isJsonRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function isJsonRecord(value: unknown): value is DocumentData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
