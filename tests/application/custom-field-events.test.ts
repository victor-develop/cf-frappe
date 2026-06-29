import { describe, expect, it } from "vitest";

import {
  CUSTOM_FIELD_PAYLOAD_KINDS,
  customFieldDisabledPayload,
  customFieldEventType,
  customFieldSavedPayload,
  foldCustomFields,
  isCustomFieldEvent,
  type CustomFieldEventPayload,
  type DomainEvent
} from "../../src";

describe("custom field events", () => {
  it("derives custom-field event types from payload identity", () => {
    expect(customFieldEventType({
      kind: "CustomFieldSaved",
      doctypeName: "Note",
      field: { name: "priority", type: "select", options: ["Low", "High"] }
    })).toBe("CustomFieldSaved");
    expect(customFieldEventType({
      kind: "CustomFieldDisabled",
      doctypeName: "Note",
      fieldName: "priority"
    })).toBe("CustomFieldDisabled");
  });

  it("builds saved custom-field payloads", () => {
    expect(
      customFieldPayload(
        customFieldSavedPayload({
          doctypeName: "Note",
          field: { name: "priority", type: "select", options: ["Low", "High"] }
        })
      )
    ).toEqual({
      kind: "CustomFieldSaved",
      doctypeName: "Note",
      field: { name: "priority", type: "select", options: ["Low", "High"] }
    });
  });

  it("builds disabled custom-field payloads", () => {
    expect(
      customFieldPayload(
        customFieldDisabledPayload({
          doctypeName: "Note",
          fieldName: "priority"
        })
      )
    ).toEqual({
      kind: "CustomFieldDisabled",
      doctypeName: "Note",
      fieldName: "priority"
    });
  });

  it("exposes the bounded custom-field payload kind set", () => {
    expect(CUSTOM_FIELD_PAYLOAD_KINDS).toEqual([
      "CustomFieldSaved",
      "CustomFieldDisabled"
    ]);
  });

  it("narrows custom-field events for catalog stream filters", () => {
    expect(isCustomFieldEvent(event(customFieldSavedPayload({
      doctypeName: "Note",
      field: { name: "priority", type: "text" }
    })))).toBe(true);
    expect(isCustomFieldEvent(event({ kind: "DocumentDeleted" }))).toBe(false);
  });

  it("narrows custom-field events by payload kind when event type names are custom", () => {
    const saved = event(customFieldSavedPayload({
      doctypeName: "Note",
      field: { name: "priority", type: "text" }
    }), "NoteCustomFieldUpserted");

    expect(isCustomFieldEvent(saved)).toBe(true);
  });

  it("folds custom-field state by payload kind when event type names are custom", () => {
    const misleadingUnrelated = event({ kind: "DocumentDeleted" }, "CustomFieldSaved");
    const customTypedSaved = {
      ...event(customFieldSavedPayload({
        doctypeName: "Note",
        field: { name: "priority", type: "text" }
      }), "NoteCustomFieldUpserted"),
      sequence: 2
    };

    const state = foldCustomFields("acme", "Note", [misleadingUnrelated, customTypedSaved]);

    expect(state.version).toBe(2);
    expect(state.fields.map((entry) => entry.field.name)).toEqual(["priority"]);
  });
});

function customFieldPayload(payload: CustomFieldEventPayload): CustomFieldEventPayload {
  return payload;
}

function event(payload: DomainEvent["payload"], type: string = payload.kind): DomainEvent {
  return {
    id: "evt_1",
    tenantId: "acme",
    stream: "acme:__CustomFields",
    sequence: 1,
    type,
    doctype: "__CustomFields",
    documentName: "priority",
    actorId: "admin@example.com",
    occurredAt: "2026-06-29T01:00:00.000Z",
    payload,
    metadata: {}
  };
}
