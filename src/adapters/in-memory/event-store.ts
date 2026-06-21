import { conflict } from "../../core/errors";
import type { DomainEvent, NewDomainEvent, StreamName } from "../../core/types";
import type { EventStore } from "../../ports/event-store";

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

  async readStream(stream: StreamName): Promise<readonly DomainEvent[]> {
    return [...(this.streams.get(stream) ?? [])];
  }

  async currentVersion(stream: StreamName): Promise<number> {
    return this.streams.get(stream)?.length ?? 0;
  }

  clear(): void {
    this.streams.clear();
  }
}
