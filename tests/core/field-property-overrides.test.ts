import {
  applyFieldPropertyOverridesToDocType,
  defineDocType,
  fieldPropertyOverridesStream,
  foldFieldPropertyOverrides,
  type DocumentEventPayload,
  type DomainEvent
} from "../../src";

describe("field property override helpers", () => {
  const Ticket = defineDocType({
    name: "Ticket",
    fields: [
      { name: "title", type: "text", required: true },
      { name: "status", type: "select", options: ["Open", "Closed"], defaultValue: "Open", inListView: true }
    ]
  });

  it("folds saved and cleared field property override events", () => {
    const saved = fieldPropertyEvent(1, {
      kind: "FieldPropertyOverrideSaved",
      doctypeName: "Ticket",
      fieldName: "status",
      overrides: { label: "State", options: ["Open", "Done"], defaultValue: "Done" }
    });
    const cleared = fieldPropertyEvent(2, {
      kind: "FieldPropertyOverrideCleared",
      doctypeName: "Ticket",
      fieldName: "status"
    });

    const savedState = foldFieldPropertyOverrides("acme", "Ticket", [saved]);
    const clearedState = foldFieldPropertyOverrides("acme", "Ticket", [saved, cleared]);

    expect(savedState).toMatchObject({
      tenantId: "acme",
      doctype: "Ticket",
      version: 1,
      fields: [{ fieldName: "status", overrides: { label: "State", options: ["Open", "Done"] } }]
    });
    expect(clearedState).toMatchObject({ tenantId: "acme", doctype: "Ticket", version: 2, fields: [] });
  });

  it("applies overrides to field metadata without mutating the base DocType", () => {
    const state = foldFieldPropertyOverrides("acme", "Ticket", [
      fieldPropertyEvent(1, {
        kind: "FieldPropertyOverrideSaved",
        doctypeName: "Ticket",
        fieldName: "status",
        overrides: {
          label: "State",
          required: true,
          inListFilter: true,
          options: ["Open", "Done"],
          defaultValue: "Done"
        }
      })
    ]);

    const effective = applyFieldPropertyOverridesToDocType(Ticket, state);

    expect(effective.fields.find((field) => field.name === "status")).toMatchObject({
      label: "State",
      required: true,
      inListFilter: true,
      options: ["Open", "Done"],
      defaultValue: "Done"
    });
    expect(Ticket.fields.find((field) => field.name === "status")).toMatchObject({
      options: ["Open", "Closed"],
      defaultValue: "Open"
    });
  });

  it("rejects overrides that reference unknown fields or invalid defaults", () => {
    const unknownField = foldFieldPropertyOverrides("acme", "Ticket", [
      fieldPropertyEvent(1, {
        kind: "FieldPropertyOverrideSaved",
        doctypeName: "Ticket",
        fieldName: "missing",
        overrides: { label: "Missing" }
      })
    ]);
    const invalidDefault = foldFieldPropertyOverrides("acme", "Ticket", [
      fieldPropertyEvent(1, {
        kind: "FieldPropertyOverrideSaved",
        doctypeName: "Ticket",
        fieldName: "status",
        overrides: { options: ["Open"], defaultValue: "Closed" }
      })
    ]);

    expect(() => applyFieldPropertyOverridesToDocType(Ticket, unknownField)).toThrow(
      "Field property override references unknown field 'missing'"
    );
    expect(() => applyFieldPropertyOverridesToDocType(Ticket, invalidDefault)).toThrow(
      "Field 'status' must be one of Open"
    );
  });
});

function fieldPropertyEvent(
  sequence: number,
  payload: Extract<DocumentEventPayload, { readonly kind: "FieldPropertyOverrideSaved" | "FieldPropertyOverrideCleared" }>
): DomainEvent {
  return {
    id: `evt-${sequence}`,
    tenantId: "acme",
    stream: fieldPropertyOverridesStream("acme"),
    sequence,
    type: payload.kind,
    doctype: "__FieldProperties",
    documentName: payload.fieldName,
    actorId: "admin@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload,
    metadata: {}
  };
}
