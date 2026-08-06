import { conflict } from "../../core/errors.js";
import type { DomainEvent, NewDomainEvent, StreamName } from "../../core/types.js";
import type { AuditDocumentEventQuery, AuditEventQuery, AuditEventStore } from "../../ports/audit-event-store.js";
import type { EventAppendBatchEntry, EventBatchStore, EventStore } from "../../ports/event-store.js";
import type { ReadStreamOptions } from "../../ports/document-store.js";
import { cloneDomainEvent, sequenceEvents } from "../../core/domain-events.js";
import { readInMemoryAuditDocumentEvents, searchInMemoryAuditEvents } from "./audit-events.js";

export class InMemoryEventStore implements EventStore, EventBatchStore, AuditEventStore {
  private readonly streams = new Map<StreamName, DomainEvent[]>();

  async append(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[]
  ): Promise<readonly DomainEvent[]> {
    const current = this.streams.get(stream) ?? [];
    if (current.length !== expectedVersion) {
      throw conflict(`Expected stream '${stream}' at version ${expectedVersion}, found ${current.length}`);
    }
    const saved = sequenceEvents(expectedVersion, events);
    this.streams.set(stream, [...current, ...saved.map(cloneDomainEvent)]);
    return saved;
  }

  async appendBatch(entries: readonly EventAppendBatchEntry[]): Promise<readonly DomainEvent[]> {
    for (const entry of entries) {
      const current = this.streams.get(entry.stream) ?? [];
      if (current.length !== entry.expectedVersion) {
        throw conflict(`Expected stream '${entry.stream}' at version ${entry.expectedVersion}, found ${current.length}`);
      }
    }
    const saved = entries.flatMap((entry) => sequenceEvents(entry.expectedVersion, entry.events));
    for (const entry of entries) {
      const current = this.streams.get(entry.stream) ?? [];
      this.streams.set(entry.stream, [
        ...current,
        ...saved.filter((event) => event.stream === entry.stream).map(cloneDomainEvent)
      ]);
    }
    return saved;
  }

  async readStream(stream: StreamName, options: ReadStreamOptions = {}): Promise<readonly DomainEvent[]> {
    const payloadKinds = options.payloadKinds === undefined ? undefined : new Set(options.payloadKinds);
    const events = [...(this.streams.get(stream) ?? [])]
      .filter((event) => options.maxSequence === undefined || event.sequence <= options.maxSequence)
      .filter((event) => payloadKinds === undefined || payloadKinds.has(event.payload.kind))
      .sort((left, right) => left.sequence - right.sequence);
    const page = options.limit === undefined ? events : events.slice(Math.max(0, events.length - options.limit));
    return page.map(cloneDomainEvent);
  }

  async currentVersion(stream: StreamName): Promise<number> {
    return this.streams.get(stream)?.length ?? 0;
  }

  async listStreams(query: { readonly tenantId: string; readonly doctype: string }): Promise<readonly StreamName[]> {
    return [...this.streams.entries()]
      .filter(([, events]) => events.some((event) => event.tenantId === query.tenantId && event.doctype === query.doctype))
      .map(([stream]) => stream)
      .sort();
  }

  async searchEvents(query: AuditEventQuery): Promise<readonly DomainEvent[]> {
    return searchInMemoryAuditEvents(this.streams.values(), query).map(cloneDomainEvent);
  }

  async readDocumentEvents(query: AuditDocumentEventQuery): Promise<readonly DomainEvent[]> {
    return readInMemoryAuditDocumentEvents(this.streams, query).map(cloneDomainEvent);
  }

  clear(): void {
    this.streams.clear();
  }
}
