import { conflict } from "../../core/errors.js";
import type { DomainEvent, NewDomainEvent, StreamName } from "../../core/types.js";
import type { AuditDocumentEventQuery, AuditEventQuery, AuditEventStore } from "../../ports/audit-event-store.js";
import type { EventStore } from "../../ports/event-store.js";
import type { ReadStreamOptions } from "../../ports/document-store.js";
import { auditDocumentEventQuery, auditEventQuery } from "./audit-event-query.js";
import { isD1ConstraintError } from "./constraint-error.js";
import { insertEventStatements, sequenceEvents } from "./event-writer.js";
import { eventStreamQuery } from "./read-stream-query.js";
import { eventFromRow, type EventRow } from "./serde.js";

export class D1EventStore implements EventStore, AuditEventStore {
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

  async readStream(stream: StreamName, options: ReadStreamOptions = {}): Promise<readonly DomainEvent[]> {
    const query = eventStreamQuery(options);
    const result = await this.db
      .prepare(query.sql)
      .bind(stream, ...query.params)
      .all<EventRow>();
    const events = (result.results ?? []).map(eventFromRow);
    return query.reverseResults ? [...events].reverse() : events;
  }

  async currentVersion(stream: StreamName): Promise<number> {
    const row = await this.db
      .prepare("SELECT COALESCE(MAX(sequence), 0) AS version FROM cf_frappe_events WHERE stream = ?")
      .bind(stream)
      .first<{ version: number }>();
    return Number(row?.version ?? 0);
  }

  async searchEvents(query: AuditEventQuery): Promise<readonly DomainEvent[]> {
    const prepared = auditEventQuery(query);
    const result = await this.db
      .prepare(prepared.sql)
      .bind(...prepared.params)
      .all<EventRow>();
    return (result.results ?? []).map(eventFromRow);
  }

  async readDocumentEvents(query: AuditDocumentEventQuery): Promise<readonly DomainEvent[]> {
    const prepared = auditDocumentEventQuery(query);
    const result = await this.db
      .prepare(prepared.sql)
      .bind(...prepared.params)
      .all<EventRow>();
    return (result.results ?? []).map(eventFromRow);
  }
}
