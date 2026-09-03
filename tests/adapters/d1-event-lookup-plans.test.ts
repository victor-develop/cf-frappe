import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_DOCUMENT_NAME,
  DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS,
  documentDeliveryOutboxStream
} from "../../src";
import { auditDocumentEventQuery } from "../../src/adapters/d1/audit-event-query.js";
import { eventStreamQuery } from "../../src/adapters/d1/read-stream-query.js";

const MIGRATIONS_DIRECTORY = new URL("../../migrations/", import.meta.url);

/**
 * A real engine loaded with the planned event-table indexes, so the shape of
 * `idx_cf_frappe_events_document_name` is checked against SQLite's own choice
 * rather than against how the DDL reads.
 *
 * This exists because dropping the trailing `sequence` — leaving a
 * plausible-looking `(tenant_id, doctype, document_name)` index — makes the
 * planner take the stream index instead and scan the whole stream. Nothing
 * about the index or the query looks wrong when that happens; only the plan
 * says so.
 *
 * The engine is deliberately left un-analyzed, which is the state a deployment
 * is in: no migration runs `ANALYZE`. With statistics the planner reaches the
 * shorter index too, so an analyzed engine would not hold this shape in place.
 */
function eventEngine(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  // Every shipped migration file, in order — the schema a deployment actually
  // ends up with, rather than a re-derivation of it.
  for (const file of readdirSync(MIGRATIONS_DIRECTORY).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS_DIRECTORY), "utf8"));
  }
  return db;
}

function plan(db: DatabaseSync, sql: string): string {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all()
    .map((row) => String((row as { detail: unknown }).detail))
    .join(" | ");
}

describe("D1 event lookup plans", () => {
  it("serves a stream-qualified document lookup from the document-name index", () => {
    const db = eventEngine();
    const { sql } = auditDocumentEventQuery({
      tenantId: "acme",
      doctype: "__DocumentDeliveryOutbox",
      documentName: "evt_source:email",
      stream: documentDeliveryOutboxStream("acme")
    });

    const detail = plan(db, sql);

    expect(detail).toContain("idx_cf_frappe_events_document_name");
    // Reached by the document columns, so the lookup does not degrade into a
    // scan of a stream shared by the whole tenant. `stream` is not among them:
    // it is a residual filter, and putting it in the key changed neither this
    // plan nor the measured cost.
    expect(detail).toContain("tenant_id=? AND doctype=? AND document_name=?");
    // `ORDER BY sequence ASC` comes out of the index, not a temporary B-tree.
    // This is what the trailing `sequence` column buys.
    expect(detail).not.toContain("TEMP B-TREE");
    db.close();
  });

  it("still serves an unqualified document lookup from the stream index", () => {
    const db = eventEngine();
    const { sql } = auditDocumentEventQuery({
      tenantId: "acme",
      doctype: "Note",
      documentName: "One"
    });

    const detail = plan(db, sql);

    expect(detail).toContain("idx_cf_frappe_events_stream_sequence");
    expect(detail).not.toContain("TEMP B-TREE");
    db.close();
  });

  it("serves the newest-first delivery outbox checkpoint lookup from the document-name index", () => {
    // This lookup runs on every outbox operation, so it has to be indexed in
    // the case that has no checkpoint too — which is the state every
    // already-deployed stream starts in, and the state a tenant with more than
    // the carry-over limit in flight stays in. The `documentName` sentinel is
    // what buys that: an empty range in `idx_cf_frappe_events_document_name`
    // rather than a scan. Measured on this engine at 50k events in one outbox
    // stream: 2.0 µs with checkpoints present, 0.6 µs with none, against
    // 6.0 ms (`type` column) and 13.8 ms (`json_extract` on the payload kind)
    // for the same lookup when no checkpoint stops the backwards scan.
    const db = eventEngine();
    fillOutboxStream(db, 400);
    const { sql, params } = auditDocumentEventQuery({
      tenantId: "acme",
      doctype: "__DocumentDeliveryOutbox",
      documentName: DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_DOCUMENT_NAME,
      stream: documentDeliveryOutboxStream("acme"),
      order: "desc",
      limit: 1
    });

    const detail = planWith(db, sql, params);

    expect(detail).toContain("idx_cf_frappe_events_document_name");
    expect(detail).toContain("tenant_id=? AND doctype=? AND document_name=?");
    // `ORDER BY sequence DESC` is read backwards off the index. A sort here
    // would mean materialising every checkpoint the tenant has ever written,
    // which is the cost this lookup exists to avoid.
    expect(detail).not.toContain("TEMP B-TREE");
    db.close();
  });

  it("returns the newest checkpoint rather than the oldest", () => {
    // The plan being right is not the property; taking the *last* checkpoint
    // is. `ORDER BY sequence ASC LIMIT 1` also reads one indexed row and also
    // has no TEMP B-TREE — it just compacts nothing.
    const db = eventEngine();
    fillOutboxStream(db, 400);
    const { sql, params } = auditDocumentEventQuery({
      tenantId: "acme",
      doctype: "__DocumentDeliveryOutbox",
      documentName: DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_DOCUMENT_NAME,
      stream: documentDeliveryOutboxStream("acme"),
      order: "desc",
      limit: 1
    });

    const rows = db.prepare(sql).all(...(params as (string | number)[]));

    expect(rows).toHaveLength(1);
    expect(Number((rows[0] as { readonly sequence: unknown }).sequence)).toBe(399);
  });

  it("still serves the bounded outbox tail read from the stream index", () => {
    // The other half of the compacted read. `sequence >= ?` has to be reachable
    // through `idx_cf_frappe_events_stream_sequence`; a scan here would put the
    // per-operation cost straight back on total stream length.
    const db = eventEngine();
    fillOutboxStream(db, 400);
    const { sql, params } = eventStreamQuery({
      minSequence: 397,
      payloadKinds: DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS
    });

    const detail = planWith(db, sql, [documentDeliveryOutboxStream("acme"), ...params]);

    expect(detail).toContain("idx_cf_frappe_events_stream_sequence");
    expect(detail).toContain("stream=? AND sequence>?");
    expect(detail).not.toContain("TEMP B-TREE");
    db.close();
  });
});

/**
 * `count` outbox events in one tenant stream, a checkpoint every fourth, so a
 * plan is taken against a populated table rather than an empty one. The planner
 * chooses differently on an empty table, and an unpopulated probe has produced a
 * wrong conclusion on this repo before.
 */
function fillOutboxStream(db: DatabaseSync, count: number): void {
  const stream = documentDeliveryOutboxStream("acme");
  const insert = db.prepare(
    `INSERT INTO cf_frappe_events
       (id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json)
     VALUES (?, ?, ?, ?, ?, '__DocumentDeliveryOutbox', ?, 'system', '2026-01-01T00:00:00.000Z', ?, '{}')`
  );
  db.exec("BEGIN");
  for (let sequence = 1; sequence <= count; sequence += 1) {
    const checkpoint = sequence % 4 === 3;
    const kind = checkpoint ? "DocumentDeliveryOutboxCheckpointed" : "DocumentDeliveryOutboxEnqueued";
    const documentName = checkpoint
      ? DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_DOCUMENT_NAME
      : `evt_${String(sequence)}:email`;
    insert.run(
      `evt_${String(sequence)}`,
      "acme",
      stream,
      sequence,
      kind,
      documentName,
      JSON.stringify({ kind, upToSequence: sequence - 1, carryOver: [] })
    );
  }
  db.exec("COMMIT");
}

/**
 * `EXPLAIN QUERY PLAN` with the parameters bound, which is how D1 sends a query.
 * A plan taken against unbound placeholders is not the plan that runs.
 */
function planWith(db: DatabaseSync, sql: string, params: readonly (string | number)[]): string {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params)
    .map((row) => String((row as { detail: unknown }).detail))
    .join(" | ");
}
