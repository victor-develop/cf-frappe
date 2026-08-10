import {
  DataTable,
  DeskLayout,
  Notice,
  renderFragment,
  renderPage,
  type DeskElement
} from "../../src/adapters/desk/ui/primitives.js";

describe("Desk UI primitive branch coverage", () => {
  it("renders inactive nav links and a layout without a flash message", () => {
    const html = renderPage(
      <DeskLayout
        title="Tasks"
        navSections={[{ heading: "DocTypes", items: [{ href: "/desk/Task", label: "Task" }] }]}
      >
        <p>body</p>
      </DeskLayout>
    );
    expect(html).toContain('<a class="nav-link" href="/desk/Task">Task</a>');
    expect(html).not.toContain('class="notice"');
  });

  it("renders a default-tone notice as a status paragraph", () => {
    const html = renderFragment(<Notice>Saved</Notice>);
    expect(html).toBe('<p class="notice" role="status">Saved</p>');
  });

  it("renders data table captions and blanks null or missing cell values", () => {
    const html = renderFragment(
      <DataTable
        caption="Tasks"
        columns={[
          { key: "title", label: "Title" },
          { key: "owner", label: "Owner" }
        ]}
        rows={[{ title: "Ship it", owner: null }, { title: "Later" }]}
        empty="No rows."
      />
    );
    expect(html).toContain("<caption>Tasks</caption>");
    expect(html).toContain('<td data-label="Title">Ship it</td>');
    expect(html).toContain('<td data-label="Owner"></td>');
    expect(html).not.toContain("No rows.");
  });

  it("rejects async components in renderPage and renderFragment", () => {
    const asyncElement = { toString: () => Promise.resolve("<p></p>") } as DeskElement;
    expect(() => renderPage(asyncElement)).toThrow("renderPage does not support async components");
    expect(() => renderFragment(asyncElement)).toThrow("renderFragment does not support async components");
  });
});
