import { FrameworkError } from "../core/errors.js";
import { metadataRevisionStream } from "../core/streams.js";
import type { DocTypeName, DomainEvent, NewDomainEvent, TenantId } from "../core/types.js";
import type { EventBatchStore, EventStore } from "../ports/event-store.js";

export type MetadataMutationStore = EventStore & EventBatchStore;

export async function metadataRevisionVersion(
  events: EventStore,
  tenantId: TenantId,
  doctype: DocTypeName
): Promise<number> {
  return events.currentVersion(metadataRevisionStream(tenantId, doctype));
}

export async function appendMetadataMutation<TPayload extends NewDomainEvent["payload"]>(
  events: MetadataMutationStore,
  input: {
    readonly tenantId: TenantId;
    readonly doctype: DocTypeName;
    readonly sourceStream: string;
    readonly sourceExpectedVersion: number;
    readonly sourceEvent: NewDomainEvent<TPayload>;
    readonly metadataRevision: number;
  }
): Promise<DomainEvent<TPayload>> {
  const revisionStream = metadataRevisionStream(input.tenantId, input.doctype);
  const revisionEvent: NewDomainEvent = {
    id: `${input.sourceEvent.id}:metadata`,
    tenantId: input.tenantId,
    stream: revisionStream,
    type: input.metadataRevision === 0 ? "MetadataRevisionStarted" : "MetadataRevisionAdvanced",
    doctype: "__MetadataRevision",
    documentName: input.doctype,
    actorId: input.sourceEvent.actorId,
    occurredAt: input.sourceEvent.occurredAt,
    payload: input.metadataRevision === 0
      ? { kind: "DocumentCreated", data: { revision: 1 }, docstatus: "draft" }
      : { kind: "DocumentUpdated", patch: { revision: input.metadataRevision + 1 } },
    metadata: { sourceStream: input.sourceStream }
  };
  const saved = await events.appendBatch([
    {
      stream: input.sourceStream,
      expectedVersion: input.sourceExpectedVersion,
      events: [input.sourceEvent]
    },
    {
      stream: revisionStream,
      expectedVersion: input.metadataRevision,
      events: [revisionEvent]
    }
  ]);
  const source = saved.find((event) => event.id === input.sourceEvent.id);
  if (source === undefined) {
    throw new FrameworkError("DOCUMENT_INVALID", "Metadata mutation source event was not committed", { status: 500 });
  }
  return source as DomainEvent<TPayload>;
}
