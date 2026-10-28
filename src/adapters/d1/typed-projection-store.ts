import type {
  DocTypeDefinition,
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  ListDocumentsQuery,
  ListDocumentsResult,
  TenantId
} from "../../core/types.js";
import { FrameworkError } from "../../core/errors.js";
import { cloneDocumentSnapshot } from "../../core/document-snapshots.js";
import type { ProjectionStore } from "../../ports/projection-store.js";
import { d1JsonExtract } from "./json-path.js";
import {
  d1ProjectionCountSql,
  d1ProjectionListQuery,
  d1ProjectionListSql,
  type D1ProjectionTableShape
} from "./projection-query.js";
import { documentFromRow, type DocumentRow } from "./serde.js";
import {
  d1TypedProjectionColumn,
  planD1TypedProjectionLayout,
  type D1TypedProjectionLayout
} from "./typed-projection-layout.js";

/**
 * How one DocType's projection uses its typed table (issue #15).
 *
 * - `off` — no typed table is written or read. The default, and exactly the
 *   behaviour before typed tables existed.
 * - `shadow` — the typed table is written after every commit, outside the
 *   commit's atomic batch, and never read by the application. A failed shadow
 *   write is reported, not raised: a table still being verified must not be
 *   able to fail a document write. This is the state a table is rebuilt and
 *   compared in.
 * - `active` — the typed table is written inside the commit's atomic batch,
 *   next to the events and the shared projection row, and list/get read from
 *   it. Its CHECK constraints now reject a write whose value does not fit the
 *   declared field type.
 *
 * The shared `cf_frappe_documents` row is written in every mode, so turning a
 * DocType back to `off` is a configuration change with nothing to rebuild.
 */
export type D1TypedProjectionMode = "off" | "shadow" | "active";

export const D1_TYPED_PROJECTION_MODES = ["off", "shadow", "active"] as const satisfies readonly D1TypedProjectionMode[];

export interface D1TypedProjectionShadowWriteFailure {
  readonly table: string;
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
  readonly version: number;
  readonly reason: string;
}

/**
 * One DocType's typed projection setting: a bare mode, or a mode with the
 * table it is pinned to.
 *
 * `active` must be pinned. The table name is derived from the DocType's
 * layout (promoted columns, their types, its indexes), so a routine change
 * such as adding an index moves the DocType to a *new*, empty table. Without
 * a pin, an `active` DocType would follow it silently: lists would come back
 * empty and every write would land in a table nobody rebuilt or compared. The
 * pin names the table that was rebuilt and compared; when the DocType's
 * current layout no longer plans that table, startup refuses
 * (`D1_TYPED_PROJECTION_LAYOUT_MISMATCH`) instead of reading the wrong one.
 *
 * `shadow` may be pinned too, and is checked the same way when it is; it need
 * not be, since nothing reads a shadow table.
 */
export type D1TypedProjectionDocTypeSetting =
  | D1TypedProjectionMode
  | {
      readonly mode: D1TypedProjectionMode;
      /** The typed table this DocType's layout must plan, e.g. `cf_frappe_p_ticket_4c1d07a2`. */
      readonly table?: string;
    };

export interface D1TypedProjectionSettings {
  /**
   * Mode for every DocType not named in {@link doctypes}. Defaults to `off`.
   * `active` here still needs every DocType it reaches pinned in
   * {@link doctypes}, so in practice it is `off` or `shadow`.
   */
  readonly mode?: D1TypedProjectionMode;
  /** Per-DocType overrides, keyed by DocType name. Unknown names are refused. */
  readonly doctypes?: Readonly<Record<string, D1TypedProjectionDocTypeSetting>>;
  /** Column ceiling handed to the layout planner. Must match what the migrations were planned with. */
  readonly maxColumns?: number;
  /**
   * Called when a `shadow` write fails. Defaults to `console.error`: the commit
   * has already succeeded, so this is the only place the drift becomes visible
   * before a parity check finds it.
   */
  readonly onShadowWriteFailure?: (failure: D1TypedProjectionShadowWriteFailure) => void;
}

/** Resolved settings: which layouts are written how, decided once at startup. */
export interface D1TypedProjectionPlan {
  /** Layouts written atomically with the commit and read from. */
  readonly active: readonly D1TypedProjectionLayout[];
  /** Layouts written after the commit and never read by the application. */
  readonly shadow: readonly D1TypedProjectionLayout[];
  mode(doctype: DocTypeName): D1TypedProjectionMode;
  /** The layout of an `active` or `shadow` DocType. */
  layout(doctype: DocTypeName): D1TypedProjectionLayout | undefined;
  readonly onShadowWriteFailure: (failure: D1TypedProjectionShadowWriteFailure) => void;
}

/**
 * Plans the typed tables the runtime will touch. Throws on an unknown DocType
 * name or mode, on any layout the migration planner would also refuse, on an
 * `active` DocType with no pinned table, and on a pinned table the DocType's
 * current layout no longer plans — so a misconfiguration, or a layout change
 * deployed without its rebuild, fails at startup rather than reading or
 * writing the wrong table.
 */
export function planD1TypedProjections(
  doctypes: readonly DocTypeDefinition[],
  settings: D1TypedProjectionSettings = {}
): D1TypedProjectionPlan {
  const fallbackMode = assertMode(settings.mode ?? "off", "default");
  const known = new Map(doctypes.map((doctype) => [doctype.name, doctype]));
  const overrides = new Map<string, { readonly mode: D1TypedProjectionMode; readonly table?: string }>();
  for (const [name, setting] of Object.entries(settings.doctypes ?? {})) {
    overrides.set(name, normalizeDocTypeSetting(setting, name));
    if (!known.has(name)) {
      throw new FrameworkError(
        "D1_TYPED_PROJECTION_UNKNOWN_DOCTYPE",
        `Typed projection settings name DocType '${name}', which is not registered`,
        { status: 400 }
      );
    }
  }
  const modes = new Map<string, D1TypedProjectionMode>();
  const layouts = new Map<string, D1TypedProjectionLayout>();
  for (const doctype of doctypes) {
    const override = overrides.get(doctype.name);
    const mode = override?.mode ?? fallbackMode;
    modes.set(doctype.name, mode);
    if (mode === "off") {
      continue;
    }
    const layout = planD1TypedProjectionLayout(doctype, {
      ...(settings.maxColumns === undefined ? {} : { maxColumns: settings.maxColumns })
    });
    const pinned = override?.table;
    if (pinned === undefined && mode === "active") {
      throw new FrameworkError(
        "D1_TYPED_PROJECTION_ACTIVE_UNPINNED",
        `Typed projection for DocType '${doctype.name}' is active but names no table. Pin the table that was ` +
          `rebuilt and compared in shadow: doctypes: { ${JSON.stringify(doctype.name)}: { mode: "active", ` +
          `table: ${JSON.stringify(layout.table)} } } — if that is the table you verified.`,
        { status: 400 }
      );
    }
    if (pinned !== undefined && pinned !== layout.table) {
      throw new FrameworkError(
        "D1_TYPED_PROJECTION_LAYOUT_MISMATCH",
        `Typed projection for DocType '${doctype.name}' is pinned to table '${pinned}', but its current layout ` +
          `plans '${layout.table}'. The promoted fields, their types or the indexes changed. Put the DocType in ` +
          "shadow, apply the new table's migration, rebuild and compare it, then pin the new table.",
        { status: 409 }
      );
    }
    layouts.set(doctype.name, layout);
  }
  const byMode = (wanted: D1TypedProjectionMode) =>
    Object.freeze([...layouts.values()].filter((layout) => modes.get(layout.doctype) === wanted));
  return Object.freeze({
    active: byMode("active"),
    shadow: byMode("shadow"),
    mode: (doctype: DocTypeName) => modes.get(doctype) ?? "off",
    layout: (doctype: DocTypeName) => layouts.get(doctype),
    onShadowWriteFailure: settings.onShadowWriteFailure ?? reportShadowWriteFailure
  });
}

export interface D1TypedProjectionStoreOptions {
  /** The typed tables this store owns. */
  readonly layouts: readonly D1TypedProjectionLayout[];
  /**
   * Where a DocType without a typed table is read and written — normally the
   * shared `D1ProjectionStore`. Without one, `get`/`list` of such a DocType
   * throw, and `save`/`remove` of one are no-ops: a typed store mounted as a
   * projection target receives every commit's auxiliary rows (naming counters,
   * unique reservations, automation runs), and those belong to the shared table,
   * which already has them.
   */
  readonly fallback?: ProjectionStore;
}

/**
 * A `ProjectionStore` over typed per-DocType tables.
 *
 * Reads compile through the same predicate compiler as the shared table; the
 * only difference is that a promoted field reads its column instead of calling
 * `json_extract`. Because that column *is* `json_extract` of the same
 * `data_json`, evaluated at write, every predicate and ordering answers the
 * same rows in the same order on either table — callers in `application` cannot
 * tell which one served them, which is what lets this be mounted as a named
 * projection target (#10), rebuilt into (#11), and compared row by row with the
 * shared table before it is read from.
 */
export class D1TypedProjectionStore implements ProjectionStore {
  private readonly layouts: ReadonlyMap<string, D1TypedProjectionLayout>;
  private readonly fallback: ProjectionStore | undefined;

  constructor(private readonly db: D1Database, options: D1TypedProjectionStoreOptions) {
    this.layouts = new Map(options.layouts.map((layout) => [layout.doctype, layout]));
    this.fallback = options.fallback;
  }

  /** The typed table a DocType is stored in, or `undefined` when it has none here. */
  tableFor(doctype: DocTypeName): string | undefined {
    return this.layouts.get(doctype)?.table;
  }

  async get(tenantId: TenantId, doctype: DocTypeName, name: DocumentName): Promise<DocumentSnapshot | null> {
    const layout = this.layouts.get(doctype);
    if (layout === undefined) {
      return this.requireFallback(doctype).get(tenantId, doctype, name);
    }
    const row = await this.db
      .prepare(
        `SELECT ${TYPED_PROJECTION_COLUMNS}
         FROM ${layout.table}
         WHERE tenant_id = ? AND name = ?`
      )
      .bind(tenantId, name)
      .first<TypedDocumentRow>();
    return row ? typedDocumentFromRow(layout, row) : null;
  }

  async save(snapshot: DocumentSnapshot): Promise<void> {
    const layout = this.layouts.get(snapshot.doctype);
    if (layout === undefined) {
      await this.fallback?.save(snapshot);
      return;
    }
    await d1TypedProjectionUpsertStatement(this.db, layout, snapshot).run();
  }

  async remove(tenantId: TenantId, doctype: DocTypeName, name: DocumentName): Promise<void> {
    const layout = this.layouts.get(doctype);
    if (layout === undefined) {
      await this.fallback?.remove?.(tenantId, doctype, name);
      return;
    }
    await this.db
      .prepare(`DELETE FROM ${layout.table} WHERE tenant_id = ? AND name = ?`)
      .bind(tenantId, name)
      .run();
  }

  async list(query: ListDocumentsQuery): Promise<ListDocumentsResult> {
    const layout = this.layouts.get(query.doctype);
    if (layout === undefined) {
      return this.requireFallback(query.doctype).list(query);
    }
    const shape = d1TypedProjectionShape(layout);
    const listQuery = d1ProjectionListQuery(query, shape);
    const page = this.db
      .prepare(d1ProjectionListSql(listQuery, shape))
      .bind(...listQuery.params, listQuery.limit, listQuery.offset);
    const toSnapshot = (row: TypedDocumentRow) => typedDocumentFromRow(layout, row);
    if (query.skipTotal === true) {
      // Same contract as the shared store: a caller that already has the total
      // is not made to pay for a second COUNT(*) on every page.
      const rowsOnly = await page.all<TypedDocumentRow>();
      return { data: (rowsOnly.results ?? []).map(toSnapshot), limit: listQuery.limit, offset: listQuery.offset, total: 0 };
    }
    const [rows, count] = await this.db.batch([
      page,
      this.db.prepare(d1ProjectionCountSql(listQuery, shape)).bind(...listQuery.params)
    ]);
    if (!rows || !count) {
      return { data: [], limit: listQuery.limit, offset: listQuery.offset, total: 0 };
    }
    return {
      data: ((rows.results ?? []) as TypedDocumentRow[]).map(toSnapshot),
      limit: listQuery.limit,
      offset: listQuery.offset,
      total: Number(((count.results ?? [])[0] as { total?: number } | undefined)?.total ?? 0)
    };
  }

  private requireFallback(doctype: DocTypeName): ProjectionStore {
    if (this.fallback === undefined) {
      throw new FrameworkError(
        "D1_TYPED_PROJECTION_UNKNOWN_DOCTYPE",
        `DocType '${doctype}' has no typed projection table in this store`,
        { status: 404 }
      );
    }
    return this.fallback;
  }
}

/** The table shape the predicate compiler reads a typed table through. */
export function d1TypedProjectionShape(layout: D1TypedProjectionLayout): D1ProjectionTableShape {
  return {
    table: layout.table,
    columns: TYPED_PROJECTION_COLUMNS,
    scopedByDoctype: false,
    fieldExpression: (field) => d1TypedProjectionColumn(layout, field) ?? d1JsonExtract(field)
  };
}

/**
 * Upserts one snapshot into its typed table. Only the system columns and
 * `data_json` are written; SQLite generates the promoted columns from it.
 *
 * Guarded by version: `shadow` writes land after their commit, so two commits
 * to one document from different coordinator instances can arrive out of order.
 * An older snapshot must not overwrite a newer one. The shared table needs no
 * such guard because its row is written atomically with the events.
 */
export function d1TypedProjectionUpsertStatement(
  db: D1Database,
  layout: D1TypedProjectionLayout,
  snapshot: DocumentSnapshot
): D1PreparedStatement {
  const normalized = cloneDocumentSnapshot(snapshot);
  return db
    .prepare(
      `INSERT INTO ${layout.table}
       (tenant_id, name, version, docstatus, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, name)
       DO UPDATE SET
         version = excluded.version,
         docstatus = excluded.docstatus,
         data_json = excluded.data_json,
         updated_at = excluded.updated_at
       WHERE excluded.version >= ${layout.table}.version`
    )
    .bind(
      normalized.tenantId,
      normalized.name,
      normalized.version,
      normalized.docstatus,
      JSON.stringify(normalized.data),
      normalized.createdAt,
      normalized.updatedAt
    );
}

/** True when a D1 error is a typed column's CHECK rejecting a value. */
export function isD1CheckConstraintError(error: unknown): boolean {
  return error instanceof Error && /CHECK constraint failed/i.test(error.message);
}

const TYPED_PROJECTION_COLUMNS = "tenant_id, name, version, docstatus, data_json, created_at, updated_at";

type TypedDocumentRow = Omit<DocumentRow, "doctype">;

function typedDocumentFromRow(layout: D1TypedProjectionLayout, row: TypedDocumentRow): DocumentSnapshot {
  // One table per DocType, so the DocType is the table's, not the row's.
  return documentFromRow({ ...row, doctype: layout.doctype });
}

function normalizeDocTypeSetting(
  setting: unknown,
  label: string
): { readonly mode: D1TypedProjectionMode; readonly table?: string } {
  if (typeof setting === "object" && setting !== null) {
    const { mode, table } = setting as { mode?: unknown; table?: unknown };
    if (table !== undefined && typeof table !== "string") {
      throw new FrameworkError(
        "MIGRATION_TYPED_PROJECTION_INVALID",
        `Typed projection table for '${label}' must be a string, got ${typeof table}`,
        { status: 400 }
      );
    }
    return table === undefined ? { mode: assertMode(mode, label) } : { mode: assertMode(mode, label), table };
  }
  return { mode: assertMode(setting, label) };
}

function assertMode(mode: unknown, label: string): D1TypedProjectionMode {
  if (typeof mode === "string" && (D1_TYPED_PROJECTION_MODES as readonly string[]).includes(mode)) {
    return mode as D1TypedProjectionMode;
  }
  throw new FrameworkError(
    "MIGRATION_TYPED_PROJECTION_INVALID",
    `Typed projection mode for '${label}' must be one of ${D1_TYPED_PROJECTION_MODES.join(", ")}, got '${String(mode)}'`,
    { status: 400 }
  );
}

function reportShadowWriteFailure(failure: D1TypedProjectionShadowWriteFailure): void {
  console.error("cf-frappe typed projection shadow write failed", failure);
}
