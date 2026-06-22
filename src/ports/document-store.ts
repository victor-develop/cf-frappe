import type { DocumentEventPayload, DocumentSnapshot, DomainEvent, NewDomainEvent, StreamName } from "../core/types.js";

export interface ReadStreamOptions {
  readonly maxSequence?: number;
  readonly limit?: number;
  readonly payloadKinds?: readonly DocumentEventPayload["kind"][];
}

export interface DocumentCommit {
  readonly events: readonly DomainEvent[];
  readonly snapshot: DocumentSnapshot;
}

export interface DocumentStore {
  readStream(stream: StreamName, options?: ReadStreamOptions): Promise<readonly DomainEvent[]>;
  commit(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[],
    project: (events: readonly DomainEvent[]) => DocumentSnapshot
  ): Promise<DocumentCommit>;
}
