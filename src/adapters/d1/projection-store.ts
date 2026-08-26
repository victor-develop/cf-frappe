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
import { FrameworkError } from "../../core/errors.js";
import {
  d1ProjectionCountSql,
  d1ProjectionListQuery,
  d1ProjectionListSql,
  type D1ProjectionListQuery,
  type D1ProjectionRefinement
} from "./projection-query.js";
import { documentFromRow, type DocumentRow } from "./serde.js";
import { D1_DOCUMENTS_TABLE } from "./tables.js";

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

  async list(query: ListDocumentsQuery): Promise<ListDocumentsResult> {
    const listQuery = d1ProjectionListQuery(query);
    if (listQuery.refinement !== undefined) {
      return listWithRefinement(this.db, query.doctype, listQuery, listQuery.refinement);
    }
    const [rows, count] = await this.db.batch([
      this.db
        .prepare(d1ProjectionListSql(listQuery))
        .bind(...listQuery.params, listQuery.limit, listQuery.offset),
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

  async listAutomationRunClaimCandidates(query: {
    readonly tenantId: TenantId;
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly DocumentSnapshot[]> {
    return listD1AutomationRunClaimCandidateSnapshots(this.db, query);
  }
}

async function listWithRefinement(
  db: D1Database,
  doctype: DocTypeName,
  query: D1ProjectionListQuery,
  refinement: D1ProjectionRefinement
): Promise<ListDocumentsResult> {
  const result = await db
    .prepare(d1ProjectionListSql(query, { paged: false }))
    .bind(...query.params, D1_PROJECTION_MAX_POST_FILTER_ROWS + 1)
    .all<DocumentRow>();
  const rows = (result.results ?? []) as DocumentRow[];
  if (rows.length > D1_PROJECTION_MAX_POST_FILTER_ROWS) {
    throw new FrameworkError(
      "D1_PROJECTION_REFINEMENT_TOO_BROAD",
      `Filtering on ${refinement.operators.join(", ")} cannot be pushed into SQL, and the remaining ` +
        `predicate matched more than ${D1_PROJECTION_MAX_POST_FILTER_ROWS} candidate rows on ` +
        `'${doctype}'. Add a filter that does push down (an equality, range, or set membership) ` +
        "alongside it.",
      { status: 400 }
    );
  }
  const matching = rows
    .map(documentFromRow)
    .filter((document) => matchesPredicateExpression(document, refinement.predicate));
  return {
    data: matching.slice(query.offset, query.offset + query.limit),
    limit: query.limit,
    offset: query.offset,
    total: matching.length
  };
}
