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
  const result = row.result_json === null ? undefined : JSON.parse(row.result_json) as JsonValue;
  const payload = row.payload_json === null ? undefined : JSON.parse(row.payload_json) as JobExecutionRecord["payload"];
  const metadata = row.metadata_json === null ? undefined : JSON.parse(row.metadata_json) as JobExecutionRecord["metadata"];
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
