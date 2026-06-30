import type {
  DocumentCommitBatchEntry
} from "../ports/document-store.js";
import type {
  DocumentSnapshot,
  DomainEvent,
  NewDomainEvent
} from "../core/types.js";
import {
  requireSavedEvent,
  snapshotFromCommittedDocumentEvent,
  snapshotFromDocumentCreatedEvent
} from "./document-lifecycle-events.js";
import {
  projectUniqueValueReleaseWrite,
  projectUniqueValueReservationWrite,
  type UniqueValueReservation
} from "./document-unique-values.js";

export interface AtomicUniqueReservationWrite {
  readonly reservation: UniqueValueReservation;
  readonly existing: DocumentSnapshot | null;
  readonly event: NewDomainEvent;
}

export interface AtomicUniqueReleaseWrite {
  readonly reservation: UniqueValueReservation;
  readonly existing: DocumentSnapshot;
  readonly event: NewDomainEvent;
}

export interface AtomicNamingSeriesWrite {
  readonly stream: string;
  readonly existing: DocumentSnapshot | null;
  readonly next: number;
  readonly event: NewDomainEvent;
}

export function documentAtomicCommitEntries(input: {
  readonly namingSeriesWrite?: AtomicNamingSeriesWrite;
  readonly uniqueReservationWrites?: readonly AtomicUniqueReservationWrite[];
  readonly uniqueReleaseWrites?: readonly AtomicUniqueReleaseWrite[];
  readonly document: {
    readonly stream: string;
    readonly expectedVersion: number;
    readonly event: NewDomainEvent;
  };
}): readonly DocumentCommitBatchEntry[] {
  return [
    ...(input.namingSeriesWrite === undefined
      ? []
      : [{
          stream: input.namingSeriesWrite.stream,
          expectedVersion: input.namingSeriesWrite.existing?.version ?? 0,
          events: [input.namingSeriesWrite.event]
        }]),
    ...(input.uniqueReservationWrites ?? []).map((write) => ({
      stream: write.reservation.stream,
      expectedVersion: write.existing?.version ?? 0,
      events: [write.event]
    })),
    ...(input.uniqueReleaseWrites ?? []).map((write) => ({
      stream: write.reservation.stream,
      expectedVersion: write.existing.version,
      events: [write.event]
    })),
    {
      stream: input.document.stream,
      expectedVersion: input.document.expectedVersion,
      events: [input.document.event]
    }
  ];
}

export function documentAtomicAuxiliarySnapshots(input: {
  readonly savedEvents: readonly DomainEvent[];
  readonly namingSeriesWrite?: AtomicNamingSeriesWrite;
  readonly uniqueReservationWrites?: readonly AtomicUniqueReservationWrite[];
  readonly uniqueReleaseWrites?: readonly AtomicUniqueReleaseWrite[];
}): readonly DocumentSnapshot[] {
  return [
    ...(input.namingSeriesWrite === undefined
      ? []
      : [projectNamingSeriesWrite(input.namingSeriesWrite, input.savedEvents)]),
    ...(input.uniqueReservationWrites ?? []).map((write) =>
      projectUniqueValueReservationWrite({
        reservation: write.reservation,
        existing: write.existing,
        saved: requireSavedEvent(input.savedEvents, write.event.id)
      })
    ),
    ...(input.uniqueReleaseWrites ?? []).map((write) =>
      projectUniqueValueReleaseWrite({
        existing: write.existing,
        saved: requireSavedEvent(input.savedEvents, write.event.id)
      })
    )
  ];
}

function projectNamingSeriesWrite(
  write: AtomicNamingSeriesWrite,
  savedEvents: readonly DomainEvent[]
): DocumentSnapshot {
  const saved = requireSavedEvent(savedEvents, write.event.id);
  if (!write.existing) {
    return snapshotFromDocumentCreatedEvent(saved);
  }
  return snapshotFromCommittedDocumentEvent(write.existing, saved, {
    data: { ...write.existing.data, current: write.next }
  });
}
