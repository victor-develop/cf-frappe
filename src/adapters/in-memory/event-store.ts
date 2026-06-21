import { conflict } from "../../core/errors";
import type { DomainEvent, NewDomainEvent, StreamName } from "../../core/types";
import type { EventStore } from "../../ports/event-store";
import type { ReadStreamOptions } from "../../ports/document-store";

export class InMemoryEventStore implements EventStore {
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
    const saved = events.map((event, index) => ({
      ...event,
      sequence: expectedVersion + index + 1
    }));
    this.streams.set(stream, [...current, ...saved]);
    return saved;
  }

  async readStream(stream: StreamName, options: ReadStreamOptions = {}): Promise<readonly DomainEvent[]> {
    const events = [...(this.streams.get(stream) ?? [])]
      .filter((event) => options.maxSequence === undefined || event.sequence <= options.maxSequence)
      .sort((left, right) => left.sequence - right.sequence);
    return options.limit === undefined ? events : events.slice(Math.max(0, events.length - options.limit));
  }

  async currentVersion(stream: StreamName): Promise<number> {
    return this.streams.get(stream)?.length ?? 0;
  }

  clear(): void {
    this.streams.clear();
  }
}
