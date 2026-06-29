import { FrameworkError } from "./errors.js";
import { cloneJsonValue, isJsonValue } from "./json.js";
import type { DomainEvent, NewDomainEvent } from "./types.js";

export function sequenceEvents(
  expectedVersion: number,
  events: readonly NewDomainEvent[]
): readonly DomainEvent[] {
  return events.map((event, index) =>
    cloneDomainEvent({
      ...event,
      sequence: expectedVersion + index + 1
    })
  );
}

export function cloneDomainEvent<TEvent extends DomainEvent>(event: TEvent): TEvent {
  return {
    ...event,
    payload: cloneDomainEventObject(event.payload, "payload") as TEvent["payload"],
    metadata: cloneDomainEventObject(event.metadata, "metadata") as TEvent["metadata"]
  };
}

export function domainEventPayloadKind(event: DomainEvent): DomainEvent["payload"]["kind"] {
  return event.payload.kind;
}

function cloneDomainEventObject(value: unknown, field: "payload" | "metadata"): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !isJsonValue(value)) {
    throw new FrameworkError("EVENT_INVALID", `Domain event ${field} must be a JSON object`, { status: 409 });
  }
  return cloneJsonValue(value);
}
