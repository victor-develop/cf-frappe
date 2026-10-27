import { snapshotFromAnalyticsRow } from "../../application/analytics-policy.js";
import type { DocTypeName, DocumentSnapshot, TenantId } from "../../core/types.js";
import type {
  AnalyticsDocumentReader,
  AnalyticsDocumentRow,
  AnalyticsDocumentScanPage,
  AnalyticsDocumentScanQuery,
  AnalyticsExportCursor,
  AnalyticsExportCursorStore,
  AnalyticsSink,
  ProjectionChangeQuery
} from "../../ports/analytics.js";

/**
 * The analytics copy held in memory, for tests and local development.
 *
 * It keeps every appended row, as the Iceberg table does, rather than only the
 * newest version per document. That is deliberate: the property a reader must
 * get right is "newest version first, then hide deletes", and a store that
 * already collapsed versions on write could not show a reader getting it wrong.
 */
export class InMemoryAnalyticsStore implements AnalyticsSink, AnalyticsDocumentReader {
  private readonly rows = new Map<string, AnalyticsDocumentRow>();
  /** Every `append` call, in order, for tests that assert batching. */
  readonly appends: (readonly AnalyticsDocumentRow[])[] = [];

  async append(rows: readonly AnalyticsDocumentRow[]): Promise<void> {
    this.appends.push([...rows]);
    for (const row of rows) {
      // Keyed by version: appending the same version twice is a no-op, which is
      // the idempotency the exporter's at-least-once delivery depends on.
      this.rows.set(rowKey(row.tenantId, row.doctype, row.name, row.version), { ...row });
    }
  }

  async scan(query: AnalyticsDocumentScanQuery): Promise<AnalyticsDocumentScanPage> {
    const newest = new Map<string, AnalyticsDocumentRow>();
    for (const row of this.rows.values()) {
      if (row.tenantId !== query.tenantId || row.doctype !== query.doctype) {
        continue;
      }
      const current = newest.get(row.name);
      if (current === undefined || row.version > current.version) {
        newest.set(row.name, row);
      }
    }
    const after = query.cursor;
    const live = [...newest.values()]
      .filter((row) => row.docstatus !== "deleted")
      .map(snapshotFromAnalyticsRow)
      .filter((document) =>
        (query.prefilters ?? []).every((prefilter) => document.data[prefilter.field] === prefilter.value)
      )
      .filter((document) => after === undefined || document.name > after)
      .sort((left, right) => compareNames(left.name, right.name));
    const documents = live.slice(0, query.limit);
    const last = documents.at(-1);
    return {
      documents,
      ...(live.length > query.limit && last !== undefined ? { nextCursor: last.name } : {})
    };
  }

  /** Every stored row, every version, for assertions. */
  allRows(): readonly AnalyticsDocumentRow[] {
    return [...this.rows.values()];
  }

  clear(): void {
    this.rows.clear();
    this.appends.length = 0;
  }
}

export class InMemoryAnalyticsExportCursorStore implements AnalyticsExportCursorStore {
  private readonly cursors = new Map<string, AnalyticsExportCursor>();

  async get(tenantId: TenantId, doctype: DocTypeName): Promise<AnalyticsExportCursor | null> {
    const cursor = this.cursors.get(cursorKey(tenantId, doctype));
    return cursor === undefined ? null : { ...cursor };
  }

  async list(tenantId: TenantId): Promise<readonly AnalyticsExportCursor[]> {
    return [...this.cursors.values()]
      .filter((cursor) => cursor.tenantId === tenantId)
      .sort((left, right) => compareNames(left.doctype, right.doctype))
      .map((cursor) => ({ ...cursor }));
  }

  async save(cursor: AnalyticsExportCursor): Promise<void> {
    this.cursors.set(cursorKey(cursor.tenantId, cursor.doctype), { ...cursor });
  }

  async reset(tenantId: TenantId, doctype: DocTypeName): Promise<void> {
    this.cursors.delete(cursorKey(tenantId, doctype));
  }
}

/**
 * The change-feed read over an in-memory projection: one tenant's DocType in
 * `(updatedAt, name)` order, strictly after `after`, up to `through`. Shared by
 * both in-memory projection stores so they cannot order differently.
 */
export function listInMemoryProjectionChanges(
  documents: Iterable<DocumentSnapshot>,
  query: ProjectionChangeQuery
): readonly DocumentSnapshot[] {
  const after = query.after;
  return [...documents]
    .filter((document) => document.tenantId === query.tenantId && document.doctype === query.doctype)
    .filter((document) => document.updatedAt <= query.through)
    .filter((document) =>
      after === undefined ||
      document.updatedAt > after.updatedAt ||
      (document.updatedAt === after.updatedAt && document.name > after.name)
    )
    .sort((left, right) => compareNames(left.updatedAt, right.updatedAt) || compareNames(left.name, right.name))
    .slice(0, query.limit);
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rowKey(tenantId: TenantId, doctype: DocTypeName, name: string, version: number): string {
  return `${tenantId}\u0000${doctype}\u0000${name}\u0000${version}`;
}

function cursorKey(tenantId: TenantId, doctype: DocTypeName): string {
  return `${tenantId}\u0000${doctype}`;
}
