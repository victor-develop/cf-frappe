import { analyticsErrorMessage, analyticsUnavailable, snapshotFromAnalyticsRow } from "../application/analytics-policy.js";
import { badRequest } from "../core/errors.js";
import { isMetadataName, isPlainIdentifier } from "../core/identifiers.js";
import type { DocStatus } from "../core/types.js";
import type {
  AnalyticsDocumentReader,
  AnalyticsDocumentRow,
  AnalyticsDocumentScanPage,
  AnalyticsDocumentScanQuery,
  AnalyticsSink,
  AnalyticsStringEqualsPrefilter
} from "../ports/analytics.js";

/**
 * The record shape the analytics Pipelines stream receives, one per exported
 * document version. Create the stream with exactly this schema:
 *
 * `wrangler basin pipelines streams create cf_frappe_documents --schema-file <file>`
 *
 * with the file's contents being {@link ANALYTICS_PIPELINE_STREAM_SCHEMA}, then
 * a sink into a Data Catalog table on R2 and a pipeline
 * `INSERT INTO <sink> SELECT * FROM <stream>`. See `docs/analytics.md`.
 */
export interface AnalyticsPipelineRecord extends Record<string, unknown> {
  readonly tenant_id: string;
  readonly doctype: string;
  readonly name: string;
  readonly version: number;
  readonly docstatus: string;
  readonly data_json: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly exported_at: string;
}

/**
 * The stream schema for {@link AnalyticsPipelineRecord}. Every field required:
 * a structured stream accepts and then silently drops a record that does not
 * match its schema, so a field the exporter forgot would lose rows, not fail.
 */
export const ANALYTICS_PIPELINE_STREAM_SCHEMA = Object.freeze({
  fields: Object.freeze([
    Object.freeze({ name: "tenant_id", type: "string", required: true }),
    Object.freeze({ name: "doctype", type: "string", required: true }),
    Object.freeze({ name: "name", type: "string", required: true }),
    Object.freeze({ name: "version", type: "int64", required: true }),
    Object.freeze({ name: "docstatus", type: "string", required: true }),
    Object.freeze({ name: "data_json", type: "string", required: true }),
    Object.freeze({ name: "created_at", type: "string", required: true }),
    Object.freeze({ name: "updated_at", type: "string", required: true }),
    Object.freeze({ name: "exported_at", type: "string", required: true })
  ])
});

/** The part of a Workers Pipelines binding this uses: `env.STREAM.send(records)`. */
export interface AnalyticsPipelineBinding {
  send(records: AnalyticsPipelineRecord[]): Promise<void>;
}

export interface PipelinesAnalyticsSinkOptions {
  /**
   * Records per `send`. Pipelines does not document a per-call cap, so this
   * keeps each call well inside the Worker request size. Defaults to 500.
   */
  readonly maxRecordsPerSend?: number;
}

/**
 * Appends exported rows to a Cloudflare Pipelines stream, which writes them
 * into an Iceberg table in R2 for {@link R2SqlAnalyticsReader} to query.
 *
 * A multi-chunk append can fail after earlier chunks were accepted. That is
 * fine by the sink contract: the exporter does not advance, the next run sends
 * the whole batch again, and rows are keyed by version so the repeats are
 * invisible to a reader. Pipelines does not document exactly-once delivery, so
 * nothing here could rely on it anyway.
 */
export class PipelinesAnalyticsSink implements AnalyticsSink {
  private readonly maxRecordsPerSend: number;

  constructor(
    private readonly binding: AnalyticsPipelineBinding,
    options: PipelinesAnalyticsSinkOptions = {}
  ) {
    const size = options.maxRecordsPerSend ?? 500;
    if (!Number.isInteger(size) || size < 1) {
      throw badRequest("Pipelines analytics sink maxRecordsPerSend must be a positive integer");
    }
    this.maxRecordsPerSend = size;
  }

  async append(rows: readonly AnalyticsDocumentRow[]): Promise<void> {
    for (let start = 0; start < rows.length; start += this.maxRecordsPerSend) {
      await this.binding.send(rows.slice(start, start + this.maxRecordsPerSend).map(analyticsPipelineRecord));
    }
  }
}

export function analyticsPipelineRecord(row: AnalyticsDocumentRow): AnalyticsPipelineRecord {
  return {
    tenant_id: row.tenantId,
    doctype: row.doctype,
    name: row.name,
    version: row.version,
    docstatus: row.docstatus,
    data_json: row.dataJson,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    exported_at: row.exportedAt
  };
}

/** R2 SQL rejects a `LIMIT` above this ("maximum LIMIT is 10000"). */
export const R2_SQL_MAX_LIMIT = 10_000;

export const R2_SQL_DEFAULT_ENDPOINT = "https://api.sql.cloudflarestorage.com/api/v1/accounts/{accountId}/basin-sql/query/{bucket}";

/**
 * The two places the scan's SQL depends on the engine. R2 SQL (Basin SQL,
 * DataFusion underneath) reads a JSON string with `json_get_str(column, key)`;
 * the tests substitute SQLite's `json_extract` and run the very same statement
 * shape on a real engine.
 */
export interface AnalyticsSqlDialect {
  /** An expression yielding the field's value when it is a JSON string, and nothing equal to any string otherwise. */
  jsonString(column: string, field: string): string;
}

export const R2_SQL_DIALECT: AnalyticsSqlDialect = {
  jsonString: (column, field) => `json_get_str(${column}, ${requireSqlStringLiteral(field, "field name")})`
};

export interface R2SqlAnalyticsReaderOptions {
  readonly accountId: string;
  /** The R2 bucket the Data Catalog is enabled on (the API's `{BUCKET_NAME}`). */
  readonly bucket: string;
  /** `namespace.table`, as the sink created it. */
  readonly table: string;
  /**
   * Called per query, so a rotated secret takes effect without a redeploy. The
   * token needs R2 SQL read, Data Catalog read and R2 storage read; it is sent
   * only as the bearer header and never appears in an error.
   */
  readonly token: () => string | Promise<string>;
  readonly fetch?: typeof fetch;
  /** Overrides the endpoint template; `{accountId}` and `{bucket}` are substituted. */
  readonly endpoint?: string;
  /** Per query. Defaults to 30 seconds; R2 SQL can take seconds, and a report waiting longer is the wrong trade. */
  readonly timeoutMs?: number;
}

interface R2SqlRow {
  readonly name: string;
  readonly version: number;
  readonly docstatus: DocStatus;
  readonly data_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Queries the analytics copy in R2 through the R2 SQL (now Basin SQL) REST API.
 *
 * There is no Workers binding for R2 SQL, so this is an authenticated `fetch`.
 * **The API takes no bound parameters**, so values are rendered as SQL string
 * literals. Every value is either a framework-validated identifier or passed
 * through {@link requireSqlStringLiteral}, which doubles quotes and refuses
 * backslashes and control characters outright rather than trusting how the
 * engine's parser treats them. A pre-filter value it refuses is simply not
 * pushed down — the caller re-filters every row anyway. A tenant or DocType it
 * refuses fails the query as unavailable.
 *
 * Pages are by `OFFSET`, not by a name cursor, so a document name never has to
 * become a literal. The reader above de-duplicates by name, which covers a row
 * shifting across a page boundary between two queries.
 */
export class R2SqlAnalyticsReader implements AnalyticsDocumentReader {
  private readonly endpoint: string;
  private readonly table: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: R2SqlAnalyticsReaderOptions) {
    this.table = r2SqlTableName(options.table);
    if (!/^[A-Za-z0-9]+$/.test(options.accountId)) {
      throw badRequest("R2 SQL accountId must be alphanumeric");
    }
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(options.bucket)) {
      throw badRequest("R2 SQL bucket must be a valid R2 bucket name");
    }
    this.endpoint = (options.endpoint ?? R2_SQL_DEFAULT_ENDPOINT)
      .replace("{accountId}", encodeURIComponent(options.accountId))
      .replace("{bucket}", encodeURIComponent(options.bucket));
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async scan(query: AnalyticsDocumentScanQuery): Promise<AnalyticsDocumentScanPage> {
    const offset = query.cursor === undefined ? 0 : Number(query.cursor);
    if (!Number.isInteger(offset) || offset < 0) {
      throw analyticsUnavailable(`R2 SQL scan cursor '${query.cursor ?? ""}' is not a row offset`);
    }
    const limit = Math.min(Math.max(1, Math.trunc(query.limit)), R2_SQL_MAX_LIMIT);
    const sql = r2SqlAnalyticsScanSql({ ...query, limit }, { table: this.table, offset });
    const rows = await this.query(sql);
    const documents = rows.map((row) =>
      snapshotFromAnalyticsRow({
        tenantId: query.tenantId,
        doctype: query.doctype,
        name: row.name,
        version: row.version,
        docstatus: row.docstatus,
        dataJson: row.data_json,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })
    );
    return {
      documents,
      ...(documents.length === limit ? { nextCursor: String(offset + limit) } : {})
    };
  }

  private async query(sql: string): Promise<readonly R2SqlRow[]> {
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${await this.options.token()}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ query: sql }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw analyticsUnavailable(`R2 SQL request failed: ${analyticsErrorMessage(error)}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw analyticsUnavailable(`R2 SQL returned HTTP ${response.status} with a body that is not JSON`);
    }
    if (!response.ok || !isRecord(body) || body.success === false) {
      throw analyticsUnavailable(`R2 SQL query failed with HTTP ${response.status}: ${r2SqlErrorMessages(body)}`);
    }
    return parseR2SqlRows(body);
  }
}

/**
 * The scan statement: per document the newest version, then live documents
 * only, then the pre-filters — in that order, which is the property everything
 * else depends on. Ranking happens in the derived table over every version;
 * `docstatus` and the pre-filters are tested outside it, on the row that won.
 * Testing them inside would let an older version that still matched answer for
 * a document whose newest version does not, and would bring a deleted document
 * back as its last live version.
 *
 * A window function, unlike the correlated `MAX` the D1 adapter uses: R2 SQL
 * is a distributed scan engine that decorrelates subqueries into joins anyway,
 * and its documentation names `ROW_NUMBER() OVER (PARTITION BY …)` as supported.
 */
export function r2SqlAnalyticsScanSql(
  query: AnalyticsDocumentScanQuery,
  options: { readonly table: string; readonly offset: number; readonly dialect?: AnalyticsSqlDialect }
): string {
  const dialect = options.dialect ?? R2_SQL_DIALECT;
  const tenant = sqlStringLiteral(query.tenantId);
  const doctype = sqlStringLiteral(query.doctype);
  if (tenant === undefined || doctype === undefined) {
    throw analyticsUnavailable(
      `Tenant '${query.tenantId}' or DocType '${query.doctype}' cannot be written as an R2 SQL literal`
    );
  }
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > R2_SQL_MAX_LIMIT) {
    throw badRequest(`R2 SQL scan limit must be an integer between 1 and ${R2_SQL_MAX_LIMIT}`);
  }
  if (!Number.isInteger(options.offset) || options.offset < 0) {
    throw badRequest("R2 SQL scan offset must be a non-negative integer");
  }
  const outer = ["cf_rank = 1", "docstatus <> 'deleted'"];
  for (const prefilter of pushableR2Prefilters(query.prefilters ?? [])) {
    outer.push(`${dialect.jsonString("data_json", prefilter.field)} = ${prefilter.literal}`);
  }
  return [
    "SELECT name, version, docstatus, data_json, created_at, updated_at",
    "FROM (",
    "  SELECT name, version, docstatus, data_json, created_at, updated_at,",
    "    ROW_NUMBER() OVER (PARTITION BY name ORDER BY version DESC) AS cf_rank",
    `  FROM ${r2SqlTableName(options.table)}`,
    `  WHERE tenant_id = ${tenant} AND doctype = ${doctype}`,
    ") AS latest",
    `WHERE ${outer.join(" AND ")}`,
    "ORDER BY name ASC",
    `LIMIT ${query.limit} OFFSET ${options.offset}`
  ].join("\n");
}

/**
 * A SQL string literal, or `undefined` when the value is not safe to inline.
 *
 * Single quotes are doubled, the standard SQL escape. Backslashes and control
 * characters are refused rather than escaped: whether `\` is an escape inside a
 * literal depends on the parser's dialect settings, which R2 SQL does not
 * document, and a value nothing has to escape cannot be escaped wrongly.
 */
export function sqlStringLiteral(value: string): string | undefined {
  if (/[\u0000-\u001f\u007f\\]/.test(value)) {
    return undefined;
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function requireSqlStringLiteral(value: string, label: string): string {
  const literal = sqlStringLiteral(value);
  if (literal === undefined) {
    throw badRequest(`R2 SQL ${label} '${value}' cannot be written as a literal`);
  }
  return literal;
}

function pushableR2Prefilters(
  prefilters: readonly AnalyticsStringEqualsPrefilter[]
): readonly { readonly field: string; readonly literal: string }[] {
  const pushable: { readonly field: string; readonly literal: string }[] = [];
  for (const prefilter of prefilters) {
    const literal = sqlStringLiteral(prefilter.value);
    // Skipping is always correct for a pre-filter; inlining something unsafe never is.
    if (literal === undefined || !isMetadataName(prefilter.field)) {
      continue;
    }
    pushable.push({ field: prefilter.field, literal });
  }
  return pushable;
}

/** `namespace.table`, each part a plain identifier, since it is interpolated into the statement. */
export function r2SqlTableName(table: string): string {
  const parts = table.split(".");
  if (parts.length !== 2 || !parts.every(isPlainIdentifier)) {
    throw badRequest(`R2 SQL table '${table}' must be 'namespace.table' with plain identifiers`);
  }
  return table;
}

/**
 * Rows from the REST response. The documented envelope is Cloudflare's usual
 * `{ success, errors, result }`; the rows are read from `result.rows` as objects
 * keyed by column name, and every column is type-checked, because a schema
 * drift in the catalog must fail the query rather than produce a wrong report.
 */
export function parseR2SqlRows(body: unknown): readonly R2SqlRow[] {
  const result = isRecord(body) ? body.result : undefined;
  const rows = isRecord(result) ? result.rows : undefined;
  if (!Array.isArray(rows)) {
    throw analyticsUnavailable("R2 SQL response has no result.rows array");
  }
  return rows.map((row, index) => {
    if (!isRecord(row)) {
      throw analyticsUnavailable(`R2 SQL row ${index} is not an object`);
    }
    const version = typeof row.version === "string" ? Number(row.version) : row.version;
    if (typeof version !== "number" || !Number.isSafeInteger(version)) {
      throw analyticsUnavailable(`R2 SQL row ${index} has no integer version`);
    }
    return {
      name: requireRowString(row, "name", index),
      version,
      docstatus: requireRowString(row, "docstatus", index) as DocStatus,
      data_json: requireRowString(row, "data_json", index),
      created_at: requireRowString(row, "created_at", index),
      updated_at: requireRowString(row, "updated_at", index)
    };
  });
}

function requireRowString(row: Readonly<Record<string, unknown>>, column: string, index: number): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw analyticsUnavailable(`R2 SQL row ${index} column '${column}' is not a string`);
  }
  return value;
}

function r2SqlErrorMessages(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.errors) || body.errors.length === 0) {
    return "no error detail";
  }
  return body.errors
    .map((error) => (isRecord(error) && typeof error.message === "string" ? error.message : JSON.stringify(error)))
    .join("; ");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
