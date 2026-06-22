import type { DomainEvent, NewDomainEvent, StreamName } from "../core/types.js";
import type { DocumentStore, ReadStreamOptions } from "./document-store.js";

export interface EventStore extends Pick<DocumentStore, "readStream"> {
  append(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[]
  ): Promise<readonly DomainEvent[]>;
  readStream(stream: StreamName, options?: ReadStreamOptions): Promise<readonly DomainEvent[]>;
  currentVersion(stream: StreamName): Promise<number>;
}
