import {
  ActionBar,
  DataTable,
  DeskLayout,
  EmptyState,
  ErrorState,
  Field,
  FormRow,
  Notice,
  Panel,
  UnsafeRawHtml,
  renderFragment,
  renderPage
} from "../../src/adapters/desk/ui/primitives.js";
import { DESK_STYLES_PATH, deskCss } from "../../src/adapters/desk/ui/styles.js";
import { createDeskApp } from "../../src/adapters/desk/app.js";
import { createServices, owner } from "../helpers.js";

describe("Desk UI primitives", () => {
  it("renders a full document with stylesheet link and layout chrome", () => {
    const html = renderPage(
      <DeskLayout
        title="Tasks"
        message="Saved"
        navSections={[
          { heading: "DocTypes", items: [{ href: "/desk/Task", label: "Task", active: true }] },
          { heading: "Empty", items: [] }
        ]}
      >
        <Panel title="Open">
          <p>body</p>
        </Panel>
      </DeskLayout>
    );
    expect(html.startsWith("<!doctype html>\n<html lang=\"en\">")).toBe(true);
    expect(html).toContain(`<link rel="stylesheet" href="${DESK_STYLES_PATH}"`);
    expect(html).toContain('<title>Tasks - cf-frappe Desk</title>');
    expect(html).toContain('<a class="nav-link is-active" href="/desk/Task">Task</a>');
    expect(html).not.toContain("Empty");
    expect(html).toContain('<p class="notice" role="status">Saved</p>');
    expect(html).toContain('<section class="panel"><h2>Open</h2><p>body</p></section>');
  });

  it("escapes text children and attribute values by default", () => {
    const html = renderFragment(
      <Panel title={'<img src=x onerror="alert(1)">'}>
        <Notice tone="error">{"<script>bad()</script> & 'quotes'"}</Notice>
      </Panel>
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });

  it("UnsafeRawHtml bypasses escaping only with a documented reason", () => {
    const html = renderFragment(
      <UnsafeRawHtml reason="pre-escaped legacy fragment" html={'<b class="x">hi</b>'} />
    );
    expect(html).toBe('<b class="x">hi</b>');
    expect(() =>
      renderFragment(<UnsafeRawHtml reason="  " html="<b>hi</b>" />)
    ).toThrow(/audit reason/);
  });

  it("renders DataTable rows with data-label cells and an empty placeholder", () => {
    type Row = { name: string; status: string };
    const table = renderFragment(
      <DataTable<Row>
        columns={[
          { key: "name", label: "Name" },
          { key: "status", label: "Status", render: (row) => <strong>{row.status}</strong> }
        ]}
        rows={[{ name: "TASK-1", status: "Open" }]}
      />
    );
    expect(table).toContain('<th scope="col">Name</th>');
    expect(table).toContain('<td data-label="Name">TASK-1</td>');
    expect(table).toContain('<td data-label="Status"><strong>Open</strong></td>');

    const empty = renderFragment(
      <DataTable<Row> columns={[{ key: "name", label: "Name" }]} rows={[]} empty="No rows" />
    );
    expect(empty).toContain('<td class="empty" colspan="1">No rows</td>');
  });

  it("renders form and state primitives with Desk CSS classes", () => {
    const html = renderFragment(
      <>
        <FormRow columns={2}>
          <Field label="Title" hint="Required">
            <input name="title" />
          </Field>
        </FormRow>
        <ActionBar>
          <button class="button primary" type="submit">
            Save
          </button>
        </ActionBar>
        <EmptyState message="Nothing here" />
        <ErrorState message="Boom" />
      </>
    );
    expect(html).toContain('<div class="fields cols-2">');
    expect(html).toContain('<label class="field"><span>Title</span><input name="title"/><small>Required</small></label>');
    expect(html).toContain('<div class="actions">');
    expect(html).toContain('<p class="empty">Nothing here</p>');
    expect(html).toContain('<p class="error" role="alert">Boom</p>');
  });
});

describe("Desk stylesheet asset", () => {
  it("serves the Desk CSS at a dedicated cached route", async () => {
    const services = createServices();
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: async () => owner
    });
    const response = await app.request(DESK_STYLES_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await response.text()).toBe(deskCss());
  });

  it("desk pages link the stylesheet instead of inlining it", async () => {
    const services = createServices();
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: async () => owner
    });
    const response = await app.request("/desk");
    const html = await response.text();
    expect(html).toContain(`<link rel="stylesheet" href="${DESK_STYLES_PATH}">`);
    expect(html).not.toContain("<style>");
  });
});
