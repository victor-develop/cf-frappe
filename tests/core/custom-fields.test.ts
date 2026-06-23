import {
  applyCustomFieldsToDocType,
  customFieldsStream,
  defineDocType,
  foldCustomFields,
  FrameworkError
} from "../../src";
import type { DomainEvent } from "../../src";

describe("custom fields", () => {
  const Note = defineDocType({
    name: "Note",
    fields: [{ name: "title", type: "text", required: true }]
  });

  it("folds saved and disabled custom field events into tenant metadata state", () => {
    const events: DomainEvent[] = [
      customFieldEvent(1, "CustomFieldSaved", {
        kind: "CustomFieldSaved",
        doctypeName: "Note",
        field: { name: "priority", type: "select", options: ["Low", "High"] }
      }),
      customFieldEvent(2, "CustomFieldSaved", {
        kind: "CustomFieldSaved",
        doctypeName: "Note",
        field: { name: "reviewed", type: "boolean" }
      }),
      customFieldEvent(3, "CustomFieldDisabled", {
        kind: "CustomFieldDisabled",
        doctypeName: "Note",
        fieldName: "priority"
      })
    ];

    const state = foldCustomFields("acme", "Note", events);

    expect(state).toMatchObject({
      tenantId: "acme",
      doctype: "Note",
      version: 3,
      fields: [
        { enabled: false, field: { name: "priority" } },
        { enabled: true, field: { name: "reviewed" } }
      ]
    });
  });

  it("composes enabled custom fields into an immutable DocType definition", () => {
    const state = foldCustomFields("acme", "Note", [
      customFieldEvent(1, "CustomFieldSaved", {
        kind: "CustomFieldSaved",
        doctypeName: "Note",
        field: { name: "priority", label: "Priority", type: "select", options: ["Low", "High"], inListFilter: true }
      })
    ]);

    const effective = applyCustomFieldsToDocType(Note, state);

    expect(effective.fields.map((field) => field.name)).toEqual(["title", "priority"]);
    expect(Object.isFrozen(effective.fields)).toBe(true);
    expect(() =>
      applyCustomFieldsToDocType(Note, foldCustomFields("acme", "Other", []))
    ).toThrow(FrameworkError);
  });

  it("extends configured form and list views with view-enabled custom fields", () => {
    const configured = defineDocType({
      name: "Note",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "body", type: "longText" }
      ],
      formView: {
        sections: [{ heading: "Details", fields: ["title"], columns: 1 }]
      },
      listView: {
        columns: ["title"],
        filterFields: ["title"],
        pageSize: 25
      }
    });
    const state = foldCustomFields("acme", "Note", [
      customFieldEvent(1, "CustomFieldSaved", {
        kind: "CustomFieldSaved",
        doctypeName: "Note",
        field: {
          name: "reviewed",
          label: "Reviewed",
          type: "boolean",
          inFormView: true,
          inListView: true,
          inListFilter: true
        }
      })
    ]);

    const effective = applyCustomFieldsToDocType(configured, state);

    expect(effective.formView?.sections).toEqual([
      { heading: "Details", fields: ["title", "reviewed"], columns: 1 }
    ]);
    expect(effective.listView).toMatchObject({
      columns: ["title", "reviewed"],
      filterFields: ["title", "reviewed"],
      pageSize: 25
    });
  });

  it("rejects custom fields that collide with base fields during composition", () => {
    const state = foldCustomFields("acme", "Note", [
      customFieldEvent(1, "CustomFieldSaved", {
        kind: "CustomFieldSaved",
        doctypeName: "Note",
        field: { name: "title", type: "text" }
      })
    ]);

    expect(() => applyCustomFieldsToDocType(Note, state)).toThrow("already exists on base DocType");
  });
});

function customFieldEvent(
  sequence: number,
  type: "CustomFieldSaved" | "CustomFieldDisabled",
  payload: DomainEvent["payload"]
): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: customFieldsStream("acme", "Note"),
    sequence,
    type,
    doctype: "__CustomFields",
    documentName: "Note",
    actorId: "admin@example.com",
    occurredAt: `2026-01-01T00:00:0${sequence}.000Z`,
    payload,
    metadata: {}
  };
}
