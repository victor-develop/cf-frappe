import type { DocumentSnapshot, DomainEvent, NewDomainEvent, StreamName } from "../core/types";

export interface DocumentCommit {
  readonly events: readonly DomainEvent[];
  readonly snapshot: DocumentSnapshot;
}

export interface DocumentStore {
  readStream(stream: StreamName): Promise<readonly DomainEvent[]>;
  commit(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[],
    project: (events: readonly DomainEvent[]) => DocumentSnapshot
  ): Promise<DocumentCommit>;
}
