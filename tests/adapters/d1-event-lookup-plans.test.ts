import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { documentDeliveryOutboxStream } from "../../src";
import { auditDocumentEventQuery } from "../../src/adapters/d1/audit-event-query.js";

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
});
