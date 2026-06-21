import type {
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  ListDocumentsQuery,
  ListDocumentsResult,
  TenantId
} from "../../core/types";
import type { ProjectionStore } from "../../ports/projection-store";
import { documentFromRow, type DocumentRow } from "./serde";

export class D1ProjectionStore implements ProjectionStore {
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
        snapshot.tenantId,
        snapshot.doctype,
        snapshot.name,
        snapshot.version,
        snapshot.docstatus,
        JSON.stringify(snapshot.data),
        snapshot.createdAt,
        snapshot.updatedAt
      )
      .run();
  }

  async list(query: ListDocumentsQuery): Promise<ListDocumentsResult> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const [rows, count] = await this.db.batch([
      this.db
        .prepare(
          `SELECT tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at
           FROM cf_frappe_documents
           WHERE tenant_id = ? AND doctype = ?
           ORDER BY updated_at DESC
           LIMIT ? OFFSET ?`
        )
        .bind(query.tenantId, query.doctype, limit, offset),
      this.db
        .prepare(
          "SELECT COUNT(*) AS total FROM cf_frappe_documents WHERE tenant_id = ? AND doctype = ?"
        )
        .bind(query.tenantId, query.doctype)
    ]);
    if (!rows || !count) {
      return { data: [], limit, offset, total: 0 };
    }
    return {
      data: ((rows.results ?? []) as DocumentRow[]).map(documentFromRow),
      limit,
      offset,
      total: Number(((count.results ?? [])[0] as { total?: number } | undefined)?.total ?? 0)
    };
  }
}
