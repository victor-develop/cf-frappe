import { defineDocType, FrameworkError, resolveFormView } from "../../src";

describe("form views", () => {
  it("resolves explicit form sections in metadata order", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "title", type: "text" },
        { name: "priority", type: "select", options: ["Low", "High"] },
        { name: "body", type: "longText" }
      ],
      formView: {
        sections: [
          { heading: "Summary", columns: 1, fields: ["title"] },
          { heading: "Details", columns: 2, fields: ["priority", "body"] }
        ]
      }
    });

    const formView = resolveFormView(Task);

    expect(formView.sections.map((section) => section.heading)).toEqual(["Summary", "Details"]);
    expect(formView.sections.map((section) => section.columns)).toEqual([1, 2]);
    expect(formView.fields.map((field) => field.name)).toEqual(["title", "priority", "body"]);
  });

  it("falls back to field-level form flags before visible fields", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "title", type: "text", inFormView: true },
        { name: "priority", type: "select", options: ["Low", "High"] },
        { name: "hidden", type: "text", hidden: true }
      ]
    });

    expect(resolveFormView(Task).fields.map((field) => field.name)).toEqual(["title"]);
  });

  it("rejects form sections that reference unknown fields", () => {
    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "title", type: "text" }],
        formView: { sections: [{ fields: ["missing"] }] }
      })
    ).toThrow("Form view on Task references unknown field 'missing'");
  });

  it("rejects explicitly empty form section metadata", () => {
    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "title", type: "text" }],
        formView: { sections: [] }
      })
    ).toThrow("Form view on Task must define at least one section");
  });

  it("rejects duplicate form section fields", () => {
    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "title", type: "text" }],
        formView: { sections: [{ fields: ["title", "title"] }] }
      })
    ).toThrow(expect.objectContaining({ code: "FORM_VIEW_INVALID" }));
  });

  it("rejects hidden fields in explicit form sections", () => {
    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "secret", type: "text", hidden: true }],
        formView: { sections: [{ fields: ["secret"] }] }
      })
    ).toThrow(FrameworkError);
  });
});
