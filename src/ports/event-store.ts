import type { DocTypeName, DomainEvent, NewDomainEvent, StreamName, TenantId } from "../core/types.js";
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

export interface EventAppendBatchEntry {
  readonly stream: StreamName;
  readonly expectedVersion: number;
  readonly events: readonly NewDomainEvent[];
}

export interface EventBatchStore {
  appendBatch(entries: readonly EventAppendBatchEntry[]): Promise<readonly DomainEvent[]>;
}

export interface StreamCatalog {
  listStreams(query: {
    readonly tenantId: TenantId;
    readonly doctype: DocTypeName;
  }): Promise<readonly StreamName[]>;
}
