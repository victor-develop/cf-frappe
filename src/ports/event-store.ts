import type { DomainEvent, NewDomainEvent, StreamName } from "../core/types";
import type { DocumentStore, ReadStreamOptions } from "./document-store";

export interface EventStore extends Pick<DocumentStore, "readStream"> {
  append(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[]
  ): Promise<readonly DomainEvent[]>;
  readStream(stream: StreamName, options?: ReadStreamOptions): Promise<readonly DomainEvent[]>;
  currentVersion(stream: StreamName): Promise<number>;
}
