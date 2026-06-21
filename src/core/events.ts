import type { DocumentData, DocumentSnapshot, DomainEvent } from "./types";

export function foldDocument(events: readonly DomainEvent[]): DocumentSnapshot | null {
  let snapshot: DocumentSnapshot | null = null;

  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    switch (event.payload.kind) {
      case "DocumentCreated":
        snapshot = {
          tenantId: event.tenantId,
          doctype: event.doctype,
          name: event.documentName,
          version: event.sequence,
          docstatus: event.payload.docstatus,
          data: cloneData(event.payload.data),
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt
        };
        break;
      case "DocumentUpdated":
        if (snapshot) {
          const current: DocumentSnapshot = snapshot;
          snapshot = {
            ...current,
            version: event.sequence,
            data: { ...current.data, ...cloneData(event.payload.patch) },
            updatedAt: event.occurredAt
          };
        }
        break;
      case "WorkflowTransitioned":
      case "DomainCommandApplied":
        if (snapshot) {
          const current: DocumentSnapshot = snapshot;
          snapshot = {
            ...current,
            version: event.sequence,
            data: { ...current.data, ...cloneData(event.payload.patch) },
            updatedAt: event.occurredAt
          };
        }
        break;
      case "DocumentDeleted":
        if (snapshot) {
          const current: DocumentSnapshot = snapshot;
          snapshot = {
            ...current,
            version: event.sequence,
            docstatus: "deleted",
            updatedAt: event.occurredAt
          };
        }
        break;
    }
  }

  return snapshot;
}

function cloneData<TData extends DocumentData>(data: TData): TData {
  return JSON.parse(JSON.stringify(data)) as TData;
}
