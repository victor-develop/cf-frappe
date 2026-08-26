import { conflict } from "../../core/errors.js";
import type { DomainEvent, NewDomainEvent, StreamName } from "../../core/types.js";
import type { AuditDocumentEventQuery, AuditEventQuery, AuditEventStore } from "../../ports/audit-event-store.js";
import type { EventAppendBatchEntry, EventBatchStore, EventStore } from "../../ports/event-store.js";
import type { ReadStreamOptions } from "../../ports/document-store.js";
import { isD1ConstraintError } from "./constraint-error.js";
import { readD1AuditDocumentEvents, readD1EventStream, searchD1AuditEvents } from "./event-reader.js";
import { insertEventStatements, sequenceEvents } from "./event-writer.js";
import { D1_EVENTS_TABLE } from "./tables.js";

export class D1EventStore implements EventStore, EventBatchStore, AuditEventStore {
  constructor(private readonly db: D1Database) {}

  async append(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[]
  ): Promise<readonly DomainEvent[]> {
    const current = await this.currentVersion(stream);
    if (current !== expectedVersion) {
      throw conflict(`Expected stream '${stream}' at version ${expectedVersion}, found ${current}`);
    }

    const saved = sequenceEvents(expectedVersion, events);
    try {
      await this.db.batch([...insertEventStatements(this.db, saved)]);
    } catch (error) {
      if (isD1ConstraintError(error)) {
        throw conflict(`Stream '${stream}' changed while appending`);
      }
      throw error;
    }
    return saved;
  }

  async appendBatch(entries: readonly EventAppendBatchEntry[]): Promise<readonly DomainEvent[]> {
    for (const entry of entries) {
      const current = await this.currentVersion(entry.stream);
      if (current !== entry.expectedVersion) {
        throw conflict(`Expected stream '${entry.stream}' at version ${entry.expectedVersion}, found ${current}`);
      }
    }
    const saved = entries.flatMap((entry) => sequenceEvents(entry.expectedVersion, entry.events));
    try {
      await this.db.batch([...insertEventStatements(this.db, saved)]);
    } catch (error) {
      if (isD1ConstraintError(error)) {
        throw conflict("One or more streams changed while appending");
      }
      throw error;
    }
    return saved;
  }

  async readStream(stream: StreamName, options: ReadStreamOptions = {}): Promise<readonly DomainEvent[]> {
    return readD1EventStream(this.db, stream, options);
  }

  async currentVersion(stream: StreamName): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COALESCE(MAX(sequence), 0) AS version FROM ${D1_EVENTS_TABLE} WHERE stream = ?`)
      .bind(stream)
      .first<{ version: number }>();
    return Number(row?.version ?? 0);
  }

  async listStreams(query: { readonly tenantId: string; readonly doctype: string }): Promise<readonly StreamName[]> {
    const result = await this.db
      .prepare(
        `SELECT DISTINCT stream FROM ${D1_EVENTS_TABLE} ` +
        "WHERE tenant_id = ? AND doctype = ? ORDER BY stream ASC"
      )
      .bind(query.tenantId, query.doctype)
      .all<{ stream: string }>();
    return (result.results ?? []).map((row) => row.stream);
  }

  async searchEvents(query: AuditEventQuery): Promise<readonly DomainEvent[]> {
    return searchD1AuditEvents(this.db, query);
  }

  async readDocumentEvents(query: AuditDocumentEventQuery): Promise<readonly DomainEvent[]> {
    return readD1AuditDocumentEvents(this.db, query);
  }
}
