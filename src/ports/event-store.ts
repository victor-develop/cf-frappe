import type { DomainEvent, NewDomainEvent, StreamName } from "../core/types";
import type { DocumentStore } from "./document-store";

export interface EventStore extends Pick<DocumentStore, "readStream"> {
  append(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[]
  ): Promise<readonly DomainEvent[]>;
  readStream(stream: StreamName): Promise<readonly DomainEvent[]>;
  currentVersion(stream: StreamName): Promise<number>;
}
