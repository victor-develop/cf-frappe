import type {
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  ListDocumentsQuery,
  ListDocumentsResult,
  TenantId
} from "../../core/types.js";
import { cloneDocumentSnapshot } from "../../core/document-snapshots.js";
import type { ProjectionStore } from "../../ports/projection-store.js";
import type { AutomationRunClaimStore } from "../../ports/automation-run-claim-store.js";
import type { ProjectionChangeFeed, ProjectionChangeQuery } from "../../ports/analytics.js";
import { listD1AutomationRunClaimCandidateSnapshots } from "./automation-run-index.js";
import {
  d1ProjectionCountSql,
  d1ProjectionListQuery,
  d1ProjectionListSql
} from "./projection-query.js";
import { documentFromRow, type DocumentRow } from "./serde.js";
import { D1_DOCUMENTS_TABLE } from "./tables.js";

export class D1ProjectionStore implements ProjectionStore, AutomationRunClaimStore, ProjectionChangeFeed {
  constructor(private readonly db: D1Database) {}

  async get(
    tenantId: TenantId,
    doctype: DocTypeName,
    name: DocumentName
  ): Promise<DocumentSnapshot | null> {
    const row = await this.db
      .prepare(
        `SELECT tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at
         FROM ${D1_DOCUMENTS_TABLE}
         WHERE tenant_id = ? AND doctype = ? AND name = ?`
      )
      .bind(tenantId, doctype, name)
      .first<DocumentRow>();
    return row ? documentFromRow(row) : null;
  }

  async save(snapshot: DocumentSnapshot): Promise<void> {
    const normalized = cloneDocumentSnapshot(snapshot);
    await this.db
      .prepare(
        `INSERT INTO ${D1_DOCUMENTS_TABLE}
         (tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, doctype, name)
         DO UPDATE SET
           version = excluded.version,
           docstatus = excluded.docstatus,
           data_json = excluded.data_json,
           updated_at = excluded.updated_at`
      )
      .bind(
        normalized.tenantId,
        normalized.doctype,
        normalized.name,
        normalized.version,
        normalized.docstatus,
        JSON.stringify(normalized.data),
        normalized.createdAt,
        normalized.updatedAt
      )
      .run();
  }

  async remove(tenantId: TenantId, doctype: DocTypeName, name: DocumentName): Promise<void> {
    await this.db
      .prepare(
        `DELETE FROM ${D1_DOCUMENTS_TABLE}
         WHERE tenant_id = ? AND doctype = ? AND name = ?`
      )
      .bind(tenantId, doctype, name)
      .run();
  }

  async list(query: ListDocumentsQuery): Promise<ListDocumentsResult> {
    const listQuery = d1ProjectionListQuery(query);
    const page = this.db
      .prepare(d1ProjectionListSql(listQuery))
      .bind(...listQuery.params, listQuery.limit, listQuery.offset);
    if (query.skipTotal === true) {
      // One statement instead of two. The count is a full-table `COUNT(*)` under
      // the same predicate, and a pushed-down text filter makes it a scan — so a
      // caller paging for rows it already has the total for should not pay for it
      // on every page.
      const rowsOnly = await page.all();
      return {
        data: ((rowsOnly.results ?? []) as unknown as DocumentRow[]).map(documentFromRow),
        limit: listQuery.limit,
        offset: listQuery.offset,
        total: 0
      };
    }
    const [rows, count] = await this.db.batch([
      page,
      this.db.prepare(d1ProjectionCountSql(listQuery)).bind(...listQuery.params)
    ]);
    if (!rows || !count) {
      return { data: [], limit: listQuery.limit, offset: listQuery.offset, total: 0 };
    }
    return {
      data: ((rows.results ?? []) as DocumentRow[]).map(documentFromRow),
      limit: listQuery.limit,
      offset: listQuery.offset,
      total: Number(((count.results ?? [])[0] as { total?: number } | undefined)?.total ?? 0)
    };
  }

  /**
   * The analytics exporter's read (#16): one tenant's DocType in
   * `(updated_at, name)` order, after a position and up to a horizon.
   *
   * It rides `idx_cf_frappe_documents_list (tenant_id, doctype, updated_at)`:
   * the `updated_at` range is an index range, and only rows tied on the
   * boundary `updated_at` are checked against the name. Written as
   * `updated_at >= ? AND (updated_at > ? OR name > ?)` rather than the row
   * value `(updated_at, name) > (?, ?)` so the range on the indexed column is
   * explicit; `tests/adapters/d1-analytics-store.test.ts` pins the plan.
   */
  async listChangedSince(query: ProjectionChangeQuery): Promise<readonly DocumentSnapshot[]> {
    const after = query.after;
    const statement = after === undefined
      ? this.db
          .prepare(
            `SELECT tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at
             FROM ${D1_DOCUMENTS_TABLE}
             WHERE tenant_id = ? AND doctype = ? AND updated_at <= ?
             ORDER BY updated_at ASC, name ASC
             LIMIT ?`
          )
          .bind(query.tenantId, query.doctype, query.through, query.limit)
      : this.db
          .prepare(
            `SELECT tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at
             FROM ${D1_DOCUMENTS_TABLE}
             WHERE tenant_id = ? AND doctype = ?
               AND updated_at >= ? AND updated_at <= ?
               AND (updated_at > ? OR name > ?)
             ORDER BY updated_at ASC, name ASC
             LIMIT ?`
          )
          .bind(query.tenantId, query.doctype, after.updatedAt, query.through, after.updatedAt, after.name, query.limit);
    const rows = await statement.all<DocumentRow>();
    return (rows.results ?? []).map(documentFromRow);
  }

  async listAutomationRunClaimCandidates(query: {
    readonly tenantId: TenantId;
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly DocumentSnapshot[]> {
    return listD1AutomationRunClaimCandidateSnapshots(this.db, query);
  }
}
