import { snapshotFromAnalyticsRow } from "../../application/analytics-policy.js";
import { isMetadataName } from "../../core/identifiers.js";
import type { DocStatus, DocTypeName, TenantId } from "../../core/types.js";
import type {
  AnalyticsDocumentReader,
  AnalyticsDocumentRow,
  AnalyticsDocumentScanPage,
  AnalyticsDocumentScanQuery,
  AnalyticsExportCursor,
  AnalyticsExportCursorStore,
  AnalyticsSink
} from "../../ports/analytics.js";
import { d1JsonExtract } from "./json-path.js";
import { D1_ANALYTICS_DOCUMENTS_TABLE, D1_ANALYTICS_EXPORTS_TABLE } from "./tables.js";

/**
 * D1 caps bound parameters at 100 per statement; a page query binds the tenant,
 * the DocType, the cursor, the limit and two per pre-filter.
 */
const MAX_PUSHED_PREFILTERS = 40;
const MAX_SCAN_PAGE_SIZE = 10_000;

interface AnalyticsDocumentDbRow {
  readonly name: string;
  readonly version: number;
  readonly docstatus: DocStatus;
  readonly data_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * The analytics copy in a D1 database of its own (issue #16).
 *
 * **Bind it to a different database from `DB`.** The point of the analytical
 * path is that a report's full scan lands somewhere other than the
 * single-writer database serving the Desk; a copy in the same database moves
 * nothing. Its schema is `planD1AnalyticsMigrations()` /
 * `migrations/analytics/`, not the framework migrations.
 *
 * Two reasons this exists alongside the R2 SQL reader. It is a real deployment
 * option for an app that wants the scan off its primary without running
 * Pipelines and an Iceberg catalog. And it is the reader the test suite runs on
 * a real SQLite engine, which is how "newest version first, then hide deletes,
 * then pre-filter" is checked against an engine rather than against a fake.
 */
export class D1AnalyticsStore implements AnalyticsSink, AnalyticsDocumentReader {
  constructor(private readonly db: D1Database) {}

  async append(rows: readonly AnalyticsDocumentRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    // One batch, so the whole append is one D1 request and atomic: the
    // exporter's cursor only moves once this resolves, and a partial append is
    // never left behind for it to skip over. `OR IGNORE` on the
    // `(tenant, doctype, name, version)` key is the idempotency the exporter's
    // at-least-once delivery relies on.
    await this.db.batch(
      rows.map((row) =>
        this.db
          .prepare(
            `INSERT OR IGNORE INTO ${D1_ANALYTICS_DOCUMENTS_TABLE}
               (tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at, exported_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            row.tenantId,
            row.doctype,
            row.name,
            row.version,
            row.docstatus,
            row.dataJson,
            row.createdAt,
            row.updatedAt,
            row.exportedAt
          )
      )
    );
  }

  async scan(query: AnalyticsDocumentScanQuery): Promise<AnalyticsDocumentScanPage> {
    const limit = Math.min(Math.max(1, Math.trunc(query.limit)), MAX_SCAN_PAGE_SIZE);
    const statement = d1AnalyticsScanStatement({ ...query, limit });
    const result = await this.db.prepare(statement.sql).bind(...statement.params).all<AnalyticsDocumentDbRow>();
    const rows = result.results ?? [];
    const documents = rows.map((row) =>
      snapshotFromAnalyticsRow({
        tenantId: query.tenantId,
        doctype: query.doctype,
        name: row.name,
        version: Number(row.version),
        docstatus: row.docstatus,
        dataJson: row.data_json,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })
    );
    const last = documents.at(-1);
    return {
      documents,
      ...(documents.length === limit && last !== undefined ? { nextCursor: last.name } : {})
    };
  }
}

/**
 * One page of the newest live version of each document, after `cursor` by name.
 *
 * The newest version is chosen by a correlated `MAX(version)` rather than a
 * window function. Both are correct; this one is a seek per outer row on the
 * primary key `(tenant_id, doctype, name, version)`, so a page costs its own
 * size, where `ROW_NUMBER() OVER (PARTITION BY name …)` numbers every version
 * of the DocType before `LIMIT` applies and makes each page cost the table.
 *
 * Where the conditions sit is the part that matters. `docstatus` and the
 * pre-filters are tested on the row that *is* the newest version, never used to
 * choose it: filtering first would let an older version that still matched
 * answer for a document whose current version does not — a deleted document
 * would come back as its last live version.
 */
export function d1AnalyticsScanStatement(query: AnalyticsDocumentScanQuery): {
  readonly sql: string;
  readonly params: readonly unknown[];
} {
  const conditions = ["d.tenant_id = ?", "d.doctype = ?"];
  const params: unknown[] = [query.tenantId, query.doctype];
  if (query.cursor !== undefined) {
    conditions.push("d.name > ?");
    params.push(query.cursor);
  }
  conditions.push(
    `d.version = (SELECT MAX(n.version) FROM ${D1_ANALYTICS_DOCUMENTS_TABLE} AS n
       WHERE n.tenant_id = d.tenant_id AND n.doctype = d.doctype AND n.name = d.name)`
  );
  conditions.push("d.docstatus <> 'deleted'");
  for (const prefilter of pushablePrefilters(query)) {
    conditions.push(`${d1JsonExtract(prefilter.field)} = ?`);
    params.push(prefilter.value);
  }
  params.push(query.limit);
  return {
    sql:
      `SELECT d.name, d.version, d.docstatus, d.data_json, d.created_at, d.updated_at
       FROM ${D1_ANALYTICS_DOCUMENTS_TABLE} AS d
       WHERE ${conditions.join("\n         AND ")}
       ORDER BY d.name ASC
       LIMIT ?`,
    params
  };
}

/**
 * Pre-filters this adapter will put in SQL. The field name is interpolated into
 * the JSON path, so anything that is not a metadata name is left for the
 * caller's exact filter instead — dropping a pre-filter is always allowed.
 */
function pushablePrefilters(query: AnalyticsDocumentScanQuery) {
  return (query.prefilters ?? []).filter((prefilter) => isMetadataName(prefilter.field)).slice(0, MAX_PUSHED_PREFILTERS);
}

interface AnalyticsExportCursorRow {
  readonly tenant_id: string;
  readonly doctype: string;
  readonly position_updated_at: string | null;
  readonly position_name: string | null;
  readonly complete_through: string | null;
  readonly exported_rows: number;
  readonly last_run_at: string | null;
  readonly last_error: string | null;
}

/**
 * Export cursors in the framework database (migration 0009).
 *
 * They live next to the projection they describe, not in the analytics store:
 * the cursor says how much of *this* database has been copied out, and the
 * analytics store may be an Iceberg table nothing here can write a row into.
 */
export class D1AnalyticsExportCursorStore implements AnalyticsExportCursorStore {
  constructor(private readonly db: D1Database) {}

  async get(tenantId: TenantId, doctype: DocTypeName): Promise<AnalyticsExportCursor | null> {
    const row = await this.db
      .prepare(
        `SELECT tenant_id, doctype, position_updated_at, position_name, complete_through,
                exported_rows, last_run_at, last_error
         FROM ${D1_ANALYTICS_EXPORTS_TABLE}
         WHERE tenant_id = ? AND doctype = ?`
      )
      .bind(tenantId, doctype)
      .first<AnalyticsExportCursorRow>();
    return row === null ? null : cursorFromRow(row);
  }

  async list(tenantId: TenantId): Promise<readonly AnalyticsExportCursor[]> {
    const result = await this.db
      .prepare(
        `SELECT tenant_id, doctype, position_updated_at, position_name, complete_through,
                exported_rows, last_run_at, last_error
         FROM ${D1_ANALYTICS_EXPORTS_TABLE}
         WHERE tenant_id = ?
         ORDER BY doctype ASC`
      )
      .bind(tenantId)
      .all<AnalyticsExportCursorRow>();
    return (result.results ?? []).map(cursorFromRow);
  }

  async save(cursor: AnalyticsExportCursor): Promise<void> {
    // `complete_through` never moves backwards, decided inside the statement:
    // two overlapping runs (a retry landing on the next cron tick) can save in
    // either order, and the freshness claim must not regress when the slower
    // one finishes last. The position may regress that way, which only costs
    // re-appending rows the sink already has.
    await this.db
      .prepare(
        `INSERT INTO ${D1_ANALYTICS_EXPORTS_TABLE}
           (tenant_id, doctype, position_updated_at, position_name, complete_through,
            exported_rows, last_run_at, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, doctype) DO UPDATE SET
           position_updated_at = excluded.position_updated_at,
           position_name = excluded.position_name,
           complete_through = CASE
             WHEN ${D1_ANALYTICS_EXPORTS_TABLE}.complete_through IS NULL THEN excluded.complete_through
             WHEN excluded.complete_through IS NULL THEN ${D1_ANALYTICS_EXPORTS_TABLE}.complete_through
             WHEN excluded.complete_through > ${D1_ANALYTICS_EXPORTS_TABLE}.complete_through THEN excluded.complete_through
             ELSE ${D1_ANALYTICS_EXPORTS_TABLE}.complete_through
           END,
           exported_rows = excluded.exported_rows,
           last_run_at = excluded.last_run_at,
           last_error = excluded.last_error`
      )
      .bind(
        cursor.tenantId,
        cursor.doctype,
        cursor.position?.updatedAt ?? null,
        cursor.position?.name ?? null,
        cursor.completeThrough,
        cursor.exportedRows,
        cursor.lastRunAt,
        cursor.lastError
      )
      .run();
  }

  async reset(tenantId: TenantId, doctype: DocTypeName): Promise<void> {
    await this.db
      .prepare(`DELETE FROM ${D1_ANALYTICS_EXPORTS_TABLE} WHERE tenant_id = ? AND doctype = ?`)
      .bind(tenantId, doctype)
      .run();
  }
}

function cursorFromRow(row: AnalyticsExportCursorRow): AnalyticsExportCursor {
  return {
    tenantId: row.tenant_id,
    doctype: row.doctype,
    position:
      row.position_updated_at === null || row.position_name === null
        ? null
        : { updatedAt: row.position_updated_at, name: row.position_name },
    completeThrough: row.complete_through,
    exportedRows: Number(row.exported_rows),
    lastRunAt: row.last_run_at,
    lastError: row.last_error
  };
}
