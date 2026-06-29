import { describe, expect, it } from "vitest";

import {
  FIELD_PROPERTY_PAYLOAD_KINDS,
  fieldPropertyEventType,
  fieldPropertyOverrideClearedPayload,
  fieldPropertyOverrideSavedPayload,
  foldFieldPropertyOverrides,
  isFieldPropertyEvent,
  type DomainEvent,
  type FieldPropertyEventPayload
} from "../../src";

describe("field property events", () => {
  it("builds saved field-property override payloads", () => {
    expect(
      fieldPropertyPayload(
        fieldPropertyOverrideSavedPayload({
          doctypeName: "Note",
          fieldName: "priority",
          overrides: { label: "Urgency", inListFilter: true }
        })
      )
    ).toEqual({
      kind: "FieldPropertyOverrideSaved",
      doctypeName: "Note",
      fieldName: "priority",
      overrides: { label: "Urgency", inListFilter: true }
    });
  });

  it("builds cleared field-property override payloads", () => {
    expect(
      fieldPropertyPayload(
        fieldPropertyOverrideClearedPayload({
          doctypeName: "Note",
          fieldName: "priority"
        })
      )
    ).toEqual({
      kind: "FieldPropertyOverrideCleared",
      doctypeName: "Note",
      fieldName: "priority"
    });
  });

  it("exposes the bounded field-property payload kind set", () => {
    expect(FIELD_PROPERTY_PAYLOAD_KINDS).toEqual([
      "FieldPropertyOverrideSaved",
      "FieldPropertyOverrideCleared"
    ]);
  });

  it("derives field-property event types from payload identity", () => {
    expect(
      fieldPropertyEventType(
        fieldPropertyOverrideSavedPayload({
          doctypeName: "Note",
          fieldName: "priority",
          overrides: { label: "Urgency" }
        })
      )
    ).toBe("FieldPropertyOverrideSaved");
    expect(
      fieldPropertyEventType(
        fieldPropertyOverrideClearedPayload({
          doctypeName: "Note",
          fieldName: "priority"
        })
      )
    ).toBe("FieldPropertyOverrideCleared");
  });

  it("narrows field-property events by payload kind when event type names are custom", () => {
    const saved = event(fieldPropertyOverrideSavedPayload({
      doctypeName: "Note",
      fieldName: "priority",
      overrides: { label: "Urgency" }
    }), "NotePriorityPresentationChanged");

    expect(isFieldPropertyEvent(saved)).toBe(true);
    expect(isFieldPropertyEvent(event({ kind: "DocumentDeleted" }))).toBe(false);
  });

  it("folds field-property state by payload kind when event type names are custom", () => {
    const misleadingUnrelated = event({ kind: "DocumentDeleted" }, "FieldPropertyOverrideSaved");
    const customTypedSaved = {
      ...event(fieldPropertyOverrideSavedPayload({
        doctypeName: "Note",
        fieldName: "priority",
        overrides: { label: "Urgency" }
      }), "NotePriorityPresentationChanged"),
      sequence: 2
    };

    const state = foldFieldPropertyOverrides("acme", "Note", [misleadingUnrelated, customTypedSaved]);

    expect(state.version).toBe(2);
    expect(state.fields.map((entry) => [entry.fieldName, entry.overrides])).toEqual([
      ["priority", { label: "Urgency" }]
    ]);
  });
});

function fieldPropertyPayload(payload: FieldPropertyEventPayload): FieldPropertyEventPayload {
  return payload;
}

function event(payload: DomainEvent["payload"], type: string = payload.kind): DomainEvent {
  return {
    id: "evt_1",
    tenantId: "acme",
    stream: "acme:__FieldProperties",
    sequence: 1,
    type,
    doctype: "__FieldProperties",
    documentName: "priority",
    actorId: "admin@example.com",
    occurredAt: "2026-06-29T01:00:00.000Z",
    payload,
    metadata: {}
  };
}
