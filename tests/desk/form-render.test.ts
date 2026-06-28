import { defineDocType, renderFormView, resolveFormView, type DocumentSnapshot } from "../../src";

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

  it("renders update document action routes from one guarded document snapshot", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [{ name: "title", type: "text" }]
    });
    const document = taskSnapshot("TASK/1");

    const html = renderFormView(Task, resolveFormView(Task), {
      mode: "update",
      document,
      lifecycleActions: ["submit"],
      workflowActions: [{ action: "Approve & Close", label: "Approve", to: "Closed" }],
      printFormats: [{ name: "Task Print", label: "Task Print", doctype: "Task" }],
      printPdfEnabled: true,
      canDuplicate: true
    });

    expect(html).toContain('formaction="/desk/Task/TASK%2F1/submit"');
    expect(html).toContain('formaction="/desk/Task/TASK%2F1/transition/Approve%20%26%20Close"');
    expect(html).toContain('href="/desk/print/Task%20Print/TASK%2F1"');
    expect(html).toContain('href="/desk/print/Task%20Print/TASK%2F1/pdf"');
    expect(html).toContain('formaction="/desk/Task/TASK%2F1/duplicate"');
  });
});

function taskSnapshot(name: string): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Task",
    name,
    version: 3,
    docstatus: "draft",
    data: { title: "Ship it" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
