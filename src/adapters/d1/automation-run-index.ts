import type { DocumentSnapshot, TenantId } from "../../core/types.js";
import { documentFromRow, type DocumentRow } from "./serde.js";
import { D1_AUTOMATION_RUNS_TABLE, D1_DOCUMENTS_TABLE } from "./tables.js";

export function automationRunIndexUpsertStatement(
  db: D1Database,
  snapshot: DocumentSnapshot
): D1PreparedStatement | undefined {
  if (snapshot.doctype !== "__AutomationRuns") {
    return undefined;
  }
  const { status, availableAt, enqueuedAt } = automationRunIndexRow(snapshot);
  return db
    .prepare(
      `INSERT INTO ${D1_AUTOMATION_RUNS_TABLE}
       (tenant_id, run_id, status, available_at, enqueued_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, run_id)
       DO UPDATE SET
         status = excluded.status,
         available_at = excluded.available_at,
         enqueued_at = excluded.enqueued_at,
         updated_at = excluded.updated_at`
    )
    .bind(snapshot.tenantId, snapshot.name, status, availableAt, enqueuedAt, snapshot.updatedAt);
}

/**
 * {@link automationRunIndexUpsertStatement}, but only while the document row
 * holds this snapshot's version. For writers that may deliver an older run
 * snapshot after a newer one: the claim index has no version column, so it
 * borrows the document row's — see `D1ProjectionStore.saveNewest`.
 */
export function automationRunIndexUpsertIfCurrentStatement(
  db: D1Database,
  snapshot: DocumentSnapshot
): D1PreparedStatement | undefined {
  if (snapshot.doctype !== "__AutomationRuns") {
    return undefined;
  }
  const row = automationRunIndexRow(snapshot);
  return db
    .prepare(
      `INSERT INTO ${D1_AUTOMATION_RUNS_TABLE}
       (tenant_id, run_id, status, available_at, enqueued_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM ${D1_DOCUMENTS_TABLE}
         WHERE tenant_id = ? AND doctype = '__AutomationRuns' AND name = ? AND version = ?
       )
       ON CONFLICT(tenant_id, run_id)
       DO UPDATE SET
         status = excluded.status,
         available_at = excluded.available_at,
         enqueued_at = excluded.enqueued_at,
         updated_at = excluded.updated_at`
    )
    .bind(
      snapshot.tenantId,
      snapshot.name,
      row.status,
      row.availableAt,
      row.enqueuedAt,
      snapshot.updatedAt,
      snapshot.tenantId,
      snapshot.name,
      snapshot.version
    );
}

function automationRunIndexRow(snapshot: DocumentSnapshot): {
  readonly status: string;
  readonly availableAt: string | null;
  readonly enqueuedAt: string;
} {
  const data = snapshot.data;
  const status = typeof data.status === "string" ? data.status : "";
  const enqueuedAt = typeof data.enqueuedAt === "string" ? data.enqueuedAt : snapshot.createdAt;
  const retryAt = typeof data.retryAt === "string" ? data.retryAt : null;
  const claimExpiresAt = typeof data.claimExpiresAt === "string" ? data.claimExpiresAt : null;
  return { status, availableAt: automationRunAvailableAt(status, enqueuedAt, retryAt, claimExpiresAt), enqueuedAt };
}

export async function listD1AutomationRunClaimCandidateSnapshots(
  db: D1Database,
  query: { readonly tenantId: TenantId; readonly now: string; readonly limit: number }
): Promise<readonly DocumentSnapshot[]> {
  const rows = await db
    .prepare(
      `SELECT d.tenant_id, d.doctype, d.name, d.version, d.docstatus, d.data_json, d.created_at, d.updated_at
       FROM ${D1_AUTOMATION_RUNS_TABLE} r
       JOIN ${D1_DOCUMENTS_TABLE} d
         ON d.tenant_id = r.tenant_id
        AND d.doctype = '__AutomationRuns'
        AND d.name = r.run_id
       WHERE r.tenant_id = ?
         AND r.status IN ('pending', 'failed', 'claimed')
         AND r.available_at IS NOT NULL
         AND r.available_at <= ?
       ORDER BY r.enqueued_at COLLATE BINARY ASC, r.run_id COLLATE BINARY ASC
       LIMIT ?`
    )
    .bind(query.tenantId, query.now, query.limit)
    .all<DocumentRow>();
  return ((rows.results ?? []) as DocumentRow[]).map(documentFromRow);
}

function automationRunAvailableAt(
  status: string,
  enqueuedAt: string,
  retryAt: string | null,
  claimExpiresAt: string | null
): string | null {
  if (status === "pending") {
    return enqueuedAt;
  }
  if (status === "failed") {
    return retryAt ?? enqueuedAt;
  }
  if (status === "claimed") {
    return claimExpiresAt ?? enqueuedAt;
  }
  return null;
}
