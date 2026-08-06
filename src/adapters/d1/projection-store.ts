import type {
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  ListDocumentsQuery,
  ListDocumentsResult,
  TenantId
} from "../../core/types.js";
import { cloneDocumentSnapshot } from "../../core/document-snapshots.js";
import { matchesPredicateExpression } from "../../core/list-view.js";
import type { ProjectionStore } from "../../ports/projection-store.js";
import type { AutomationRunClaimStore } from "../../ports/automation-run-claim-store.js";
import { listD1AutomationRunClaimCandidateSnapshots } from "./automation-run-index.js";
import { d1ProjectionListQuery, type D1ProjectionListQuery } from "./projection-query.js";
import { documentFromRow, type DocumentRow } from "./serde.js";

export const D1_PROJECTION_MAX_POST_FILTER_ROWS = 1_000;

export class D1ProjectionStore implements ProjectionStore, AutomationRunClaimStore {
  constructor(private readonly db: D1Database) {}

  async get(
    tenantId: TenantId,
    doctype: DocTypeName,
    name: DocumentName
  ): Promise<DocumentSnapshot | null> {
    const row = await this.db
      .prepare(
        `SELECT tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at
         FROM cf_frappe_documents
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
        `INSERT INTO cf_frappe_documents
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

  async list(query: ListDocumentsQuery): Promise<ListDocumentsResult> {
    const listQuery = d1ProjectionListQuery(query);
    if (listQuery.postFilter !== undefined) {
      return listWithPostFilter(this.db, listQuery, listQuery.postFilter);
    }
    const [rows, count] = await this.db.batch([
      this.db
        .prepare(
          `SELECT tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at
           FROM cf_frappe_documents
           WHERE ${listQuery.where}
           ORDER BY ${listQuery.orderBy}
           LIMIT ? OFFSET ?`
        )
        .bind(...listQuery.params, listQuery.limit, listQuery.offset),
      this.db
        .prepare(`SELECT COUNT(*) AS total FROM cf_frappe_documents WHERE ${listQuery.where}`)
        .bind(...listQuery.params)
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

  async listAutomationRunClaimCandidates(query: {
    readonly tenantId: TenantId;
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly DocumentSnapshot[]> {
    return listD1AutomationRunClaimCandidateSnapshots(this.db, query);
  }
}

async function listWithPostFilter(
  db: D1Database,
  query: D1ProjectionListQuery,
  postFilter: NonNullable<D1ProjectionListQuery["postFilter"]>
): Promise<ListDocumentsResult> {
  const result = await db
    .prepare(
      `SELECT tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at
       FROM cf_frappe_documents
       WHERE ${query.where}
       ORDER BY ${query.orderBy}
       LIMIT ?`
    )
    .bind(...query.params, D1_PROJECTION_MAX_POST_FILTER_ROWS + 1)
    .all<DocumentRow>();
  const rows = (result.results ?? []) as DocumentRow[];
  if (rows.length > D1_PROJECTION_MAX_POST_FILTER_ROWS) {
    throw new Error(
      `D1 projection Predicate post-filter exceeded ${D1_PROJECTION_MAX_POST_FILTER_ROWS} candidate rows; add a selective exact filter`
    );
  }
  const matching = rows
    .map(documentFromRow)
    .filter((document) => matchesPredicateExpression(document, postFilter));
  return {
    data: matching.slice(query.offset, query.offset + query.limit),
    limit: query.limit,
    offset: query.offset,
    total: matching.length
  };
}
