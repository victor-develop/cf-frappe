import { describe, expect, it } from "vitest";

import {
  FIELD_PROPERTY_PAYLOAD_KINDS,
  fieldPropertyEventType,
  fieldPropertyOverrideClearedPayload,
  fieldPropertyOverrideSavedPayload,
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
});

function fieldPropertyPayload(payload: FieldPropertyEventPayload): FieldPropertyEventPayload {
  return payload;
}
