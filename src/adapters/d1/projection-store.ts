import type {
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  ListDocumentsQuery,
  ListDocumentsResult,
  TenantId
} from "../../core/types.js";
import { cloneDocumentSnapshot } from "../../core/document-snapshots.js";
import type {
  MonotonicProjectionWriter,
  ProjectionDocumentRef,
  ProjectionStore,
  ProjectionVersionReader
} from "../../ports/projection-store.js";
import type { AutomationRunClaimStore } from "../../ports/automation-run-claim-store.js";
import {
  automationRunIndexUpsertIfCurrentStatement,
  listD1AutomationRunClaimCandidateSnapshots
} from "./automation-run-index.js";
import {
  d1ProjectionCountSql,
  d1ProjectionListQuery,
  d1ProjectionListSql
} from "./projection-query.js";
import { documentFromRow, type DocumentRow } from "./serde.js";
import { D1_DOCUMENTS_TABLE } from "./tables.js";

export class D1ProjectionStore
  implements ProjectionStore, MonotonicProjectionWriter, ProjectionVersionReader, AutomationRunClaimStore {
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

  /**
   * One batch for the lot, so a delivery either lands every row it carries or
   * none of them — the naming counter and the document it named stay together.
   *
   * The version guard is in SQL, not in a read-then-write here, because the
   * writers this exists for (outbox deliveries, an eager apply after the commit,
   * a backfill) run concurrently from different isolates. The automation-run
   * claim index has no version of its own, so its row follows the document row:
   * it is rewritten only when the document row now holds exactly this version,
   * which is false whenever the guard just refused the snapshot.
   */
  async saveNewest(snapshots: readonly DocumentSnapshot[]): Promise<void> {
    if (snapshots.length === 0) {
      return;
    }
    await this.db.batch(snapshots.flatMap((snapshot) => {
      const normalized = cloneDocumentSnapshot(snapshot);
      const index = automationRunIndexUpsertIfCurrentStatement(this.db, normalized);
      return [
        this.db
          .prepare(
            `INSERT INTO ${D1_DOCUMENTS_TABLE}
             (tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(tenant_id, doctype, name)
             DO UPDATE SET
               version = excluded.version,
               docstatus = excluded.docstatus,
               data_json = excluded.data_json,
               updated_at = excluded.updated_at
             WHERE excluded.version >= ${D1_DOCUMENTS_TABLE}.version`
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
          ),
        ...(index === undefined ? [] : [index])
      ];
    }));
  }

  /**
   * One statement for every ref. The refs go in as a single JSON parameter and
   * are unpacked with `json_each`, so the query stays inside D1's limit on
   * bound parameters however many documents it names, and each ref is still a
   * primary-key lookup.
   */
  async versions(tenantId: TenantId, refs: readonly ProjectionDocumentRef[]): Promise<readonly (number | null)[]> {
    if (refs.length === 0) {
      return [];
    }
    const result = await this.db
      .prepare(
        `SELECT CAST(ref.key AS INTEGER) AS position, document.version AS version
         FROM json_each(?) AS ref
         JOIN ${D1_DOCUMENTS_TABLE} AS document
           ON document.tenant_id = ?
          AND document.doctype = json_extract(ref.value, '$[0]')
          AND document.name = json_extract(ref.value, '$[1]')`
      )
      .bind(JSON.stringify(refs.map((ref) => [ref.doctype, ref.name])), tenantId)
      .all<{ position: number; version: number }>();
    const versions: (number | null)[] = refs.map(() => null);
    for (const row of result.results ?? []) {
      versions[Number(row.position)] = Number(row.version);
    }
    return versions;
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

  async listAutomationRunClaimCandidates(query: {
    readonly tenantId: TenantId;
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly DocumentSnapshot[]> {
    return listD1AutomationRunClaimCandidateSnapshots(this.db, query);
  }
}
