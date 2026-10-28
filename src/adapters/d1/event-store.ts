import { conflict } from "../../core/errors.js";
import type { DomainEvent, NewDomainEvent, StreamName } from "../../core/types.js";
import type { AuditDocumentEventQuery, AuditEventQuery, AuditEventStore } from "../../ports/audit-event-store.js";
import type { EventAppendBatchEntry, EventBatchStore, EventStore } from "../../ports/event-store.js";
import type { ReadStreamOptions } from "../../ports/document-store.js";
import { isD1ConstraintError } from "./constraint-error.js";
import type { D1ArchivedEvents } from "./archived-events.js";
import {
  readD1AuditDocumentEvents,
  readD1EventStream,
  readD1StreamVersion,
  searchD1AuditEvents
} from "./event-reader.js";
import { insertEventStatements, sequenceEvents } from "./event-writer.js";
import { D1_EVENTS_TABLE } from "./tables.js";

export class D1EventStore implements EventStore, EventBatchStore, AuditEventStore {
  private readonly archive: D1ArchivedEvents | undefined;

  /**
   * @param options.archive Reads archived events back from cold storage
   *   (issue #18). Omitted, the store reads the hot table only, exactly as it
   *   did before the archive existed — and refuses, rather than returns, a
   *   stream whose oldest events are missing from it. See `readD1EventStream`.
   */
  constructor(
    private readonly db: D1Database,
    options: { readonly archive?: D1ArchivedEvents } = {}
  ) {
    this.archive = options.archive;
  }

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
    return this.archive === undefined
      ? readD1EventStream(this.db, stream, options)
      : this.archive.readStream(stream, options);
  }

  async currentVersion(stream: StreamName): Promise<number> {
    return readD1StreamVersion(this.db, stream);
  }

  async listStreams(query: { readonly tenantId: string; readonly doctype: string }): Promise<readonly StreamName[]> {
    if (this.archive !== undefined) {
      return this.archive.listStreams(query);
    }
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
    return this.archive === undefined
      ? searchD1AuditEvents(this.db, query)
      : this.archive.searchEvents(query);
  }

  async readDocumentEvents(query: AuditDocumentEventQuery): Promise<readonly DomainEvent[]> {
    return this.archive === undefined
      ? readD1AuditDocumentEvents(this.db, query)
      : this.archive.readDocumentEvents(query);
  }
}
