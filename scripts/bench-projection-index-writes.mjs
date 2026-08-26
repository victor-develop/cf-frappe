// Measures how the number of partial projection indexes on cf_frappe_documents
// affects insert cost. Reproducible: `node scripts/bench-projection-index-writes.mjs`.
//
// Runs against node:sqlite (built into Node 22). That is not D1's SQLite build,
// so treat the shape of the curve as the result and re-measure absolute numbers
// on D1 before making a sizing decision. The `--d1` note at the bottom records
// how the same curve was measured on a real local D1.
//
// Options:
//   --rows=N        rows inserted per data point (default 3000)
//   --indexes=a,b,c index counts to measure (default 0,50,150,300,600)
//   --shape=wide    index key ends in updated_at, matching what the framework
//                   plans (default). `narrow` omits it.
//   --txn=single    one transaction for the whole run (default), or `per-row`
//   --cache=KB      PRAGMA cache_size, in KiB
//   --json          emit machine-readable output

import { DatabaseSync } from "node:sqlite";

const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [key, value] = arg.slice(2).split("=");
      return [key, value ?? "true"];
    })
);

const rows = Number(args.get("rows") ?? 3000);
const counts = (args.get("indexes") ?? "0,50,150,300,600").split(",").map(Number);
const shape = args.get("shape") ?? "wide";
const txn = args.get("txn") ?? "single";
const cacheKb = args.has("cache") ? Number(args.get("cache")) : null;
const asJson = args.has("json");

const TABLE = "cf_frappe_documents";

function measure(indexCount) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode=WAL;");
  if (cacheKb) db.exec(`PRAGMA cache_size=-${cacheKb}`);
  db.exec(`CREATE TABLE ${TABLE} (
    tenant_id TEXT NOT NULL, doctype TEXT NOT NULL, name TEXT NOT NULL,
    version INTEGER NOT NULL, docstatus TEXT NOT NULL, data_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, doctype, name));`);
  db.exec(`CREATE INDEX idx_${TABLE}_list ON ${TABLE}(tenant_id, doctype, updated_at);`);

  // One partial index per DocType, exactly the shape planD1ProjectionIndexes emits.
  const trailing = shape === "wide" ? ", updated_at" : "";
  for (let i = 1; i <= indexCount; i += 1) {
    db.exec(
      `CREATE INDEX io${i} ON ${TABLE} ` +
        `(tenant_id, doctype, json_extract(data_json,'$.f0')${trailing}) ` +
        `WHERE doctype = 'D${i}';`
    );
  }

  // Insert into a DocType that matches NO partial index: this measures the cost
  // every write pays for indexes it can never use.
  const payload = JSON.stringify({ f0: "Open", filler: "x".repeat(120) });
  const insert = db.prepare(
    `INSERT INTO ${TABLE} VALUES ('t1', 'DX', ?, 1, 'draft', ?, 'a', 'a')`
  );

  if (txn === "single") db.exec("BEGIN");
  const started = process.hrtime.bigint();
  for (let i = 0; i < rows; i += 1) {
    if (txn === "per-row") db.exec("BEGIN");
    insert.run(`N${i}`, payload);
    if (txn === "per-row") db.exec("COMMIT");
  }
  if (txn === "single") db.exec("COMMIT");
  const microsPerRow = Number(process.hrtime.bigint() - started) / 1000 / rows;
  db.close();
  return microsPerRow;
}

const results = counts.map((indexes) => ({
  indexes,
  microsPerRow: Number(measure(indexes).toFixed(2))
}));

if (asJson) {
  console.log(JSON.stringify({ rows, shape, txn, cacheKb, results }, null, 2));
} else {
  console.log(`rows=${rows} shape=${shape} txn=${txn} cache=${cacheKb ?? "default"}`);
  const baseline = results[0]?.microsPerRow ?? 0;
  for (const { indexes, microsPerRow } of results) {
    const factor = baseline > 0 ? (microsPerRow / baseline).toFixed(1) : "-";
    const marginal = indexes > 0 ? ((microsPerRow - baseline) / indexes).toFixed(3) : "-";
    console.log(
      `  ${String(indexes).padStart(4)} indexes  ${String(microsPerRow).padStart(9)} us/row` +
        `  ${String(factor).padStart(7)}x baseline  ${String(marginal).padStart(6)} us/index`
    );
  }
}
