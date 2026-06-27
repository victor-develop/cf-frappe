import { defineDocType, renderFormView, resolveFormView } from "../../src";

describe("Desk form rendering", () => {
  it("renders DocField placeholders on generated text inputs and textareas", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "title", type: "text", placeholder: "Write a concise title" },
        { name: "body", type: "longText", placeholder: "Add useful context" },
        { name: "priority", type: "select", options: ["Low", "High"], placeholder: "Not rendered on selects" }
      ]
    });

    const html = renderFormView(Task, resolveFormView(Task), { mode: "create" });

    expect(html).toContain('name="title"');
    expect(html).toContain('placeholder="Write a concise title"');
    expect(html).toContain('name="body"');
    expect(html).toContain('placeholder="Add useful context"');
    expect(html).not.toContain("Not rendered on selects");
  });
});
