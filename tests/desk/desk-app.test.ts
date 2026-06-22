import {
  CHILD_TABLE_ROW_INDEX_FIELD,
  createDeskApp,
  createRegistry,
  defineDocType,
  deterministicIds,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService
} from "../../src";
import { createChildTableServices, createLinkedServices, createServices, data, now, owner } from "../helpers";

describe("Desk app", () => {
  function makeDesk() {
    const services = createServices(["e1", "e2", "e3", "e4"]);
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      prints: services.prints,
      queries: services.queries,
      reports: services.reports,
      timeline: services.history,
      savedFilters: services.savedFilters,
      actor: () => owner
    });
    return { app, services };
  }

  function makeLinkedDesk() {
    const services = createLinkedServices(["p1", "p2", "t1"]);
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: () => owner
    });
    return { app, services };
  }

  function makeChildTableDesk() {
    const services = createChildTableServices(["product-1", "product-2", "invoice-1", "invoice-2"]);
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: () => owner
    });
    return { app, services };
  }

  it("renders a metadata-driven home page", async () => {
    const { app } = makeDesk();

    const response = await app.request("/desk");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("cf-frappe Desk");
    expect(html).toContain("/desk/Note");
    expect(html).toContain("/desk/reports/Open%20Notes");
    expect(html).toContain("DocType");
  });

  it("renders report list and report result pages", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Report Note", priority: "High", body: "For reporting", count: 7 })
    });

    const list = await app.request("/desk/reports");
    expect(list.status).toBe(200);
    await expect(list.text()).resolves.toContain("Open Notes");

    const report = await app.request("/desk/reports/Open%20Notes?filter_priority=High");
    expect(report.status).toBe(200);
    const html = await report.text();
    expect(html).toContain("Report Note");
    expect(html).toContain("For reporting");
    expect(html).toContain("Total Count");
    expect(html).toContain("By Priority");
    expect(html).toContain("Notes by Priority");
    expect(html).toContain("chart-svg chart-bar");
    expect(html).toContain("/desk/reports/Open%20Notes/export.csv?filter_priority=High");

    const csv = await app.request("/desk/reports/Open%20Notes/export.csv?filter_priority=High");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="Open-Notes.csv"');
    expect(csv.headers.get("x-cf-frappe-export-total")).toBe("1");
    expect(csv.headers.get("x-cf-frappe-exported")).toBe("1");
    expect(csv.headers.get("x-cf-frappe-export-truncated")).toBe("false");
    await expect(csv.text()).resolves.toBe("Title,Priority,Body\nReport Note,High,For reporting");
  });

  it("renders list and create form pages", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const list = await app.request("/desk/Note");
    expect(list.status).toBe(200);
    await expect(list.text()).resolves.toContain("My Note");

    const form = await app.request("/desk/Note/new");
    expect(form.status).toBe(200);
    const html = await form.text();
    expect(html).toContain('name="title"');
    expect(html).toContain('name="body"');
    expect(html).toContain("<h3>Summary</h3>");
    expect(html).toContain("<h3>Details</h3>");
    expect(html.indexOf('name="title"')).toBeLessThan(html.indexOf('name="body"'));
    expect(html).toContain('class="fields cols-1"');
    expect(html).toContain('class="fields cols-2"');
    expect(html).toContain("Create");
  });

  it("renders metadata-driven list filters", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk High", priority: "High", body: "Hidden body" })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Low", priority: "Low", body: "Routine" })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Closed High", priority: "High", workflow_state: "Closed", body: "Closed" })
    });

    const response = await app.request("/desk/Note?filter_priority=High");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Desk High");
    expect(html).not.toContain("Desk Low");
    expect(html).not.toContain("Desk Closed High");
    expect(html).not.toContain("Hidden body");
    expect(html).toContain("<th>title</th><th>priority</th><th>workflow_state</th>");
    expect(html).toContain('name="filter_title__contains"');
    expect(html).toContain('name="filter_priority"');
    expect(html).toContain('<option value="High" selected>High</option>');
    expect(html).toContain('<option value="Open" selected>Open</option>');
    expect(html).toContain("/desk/Note?default_filters=0");

    const closed = await app.request("/desk/Note?filter_priority=High&filter_workflow_state=Closed");
    expect(closed.status).toBe(200);
    const closedHtml = await closed.text();
    expect(closedHtml).toContain("Desk Closed High");
    expect(closedHtml).not.toContain("Desk High");
    expect(closedHtml).toContain('<option value="Closed" selected>Closed</option>');
  });

  it("saves, applies, and deletes Desk list filters", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Saved High", priority: "High", body: "High" })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Saved Low", priority: "Low", body: "Low" })
    });

    const saved = await app.request("/desk/Note/saved-filters", {
      method: "POST",
      body: new URLSearchParams({ saved_filter_label: "High notes", filter_priority: "High" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(saved.status).toBe(303);
    const location = saved.headers.get("location") ?? "";
    expect(location).toContain("/desk/Note?saved_filter=");

    const list = await app.request(location);
    expect(list.status).toBe(200);
    const html = await list.text();
    expect(html).toContain("High notes");
    expect(html).toContain("Desk Saved High");
    expect(html).not.toContain("Desk Saved Low");
    expect(html).toContain("/desk/Note/saved-filters/");
    expect(html).toContain("/delete");

    const id = new URL(`http://localhost${location}`).searchParams.get("saved_filter");
    const deleted = await app.request(`/desk/Note/saved-filters/${id}/delete`, { method: "POST" });

    expect(deleted.status).toBe(303);
    await expect(services.savedFilters.list(owner, "Note")).resolves.toEqual([]);
  });

  it("renders expectedVersion in edit forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const response = await app.request("/desk/Note/My%20Note");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('name="expectedVersion" value="1"');
    expect(html).toContain("/desk/print/Note%20Standard/My%20Note");
  });

  it("renders document timeline entries on edit forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });
    await services.documents.update({ actor: owner, doctype: "Note", name: "My Note", patch: { body: "Edited" } });

    const response = await app.request("/desk/Note/My%20Note");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<h2 id="document-timeline">Timeline</h2>');
    expect(html).toContain("Created document");
    expect(html).toContain("Updated body");
    expect(html).toContain("NoteUpdated");
    expect(html).toContain("timeline-changes");
    expect(html).toContain("<span>body</span>");
    expect(html).toContain("<span>Body</span>");
    expect(html).toContain("<span>Edited</span>");
    expect(html).toContain('formaction="/desk/Note/My%20Note/comments"');
    expect(html).toContain('name="comment_text"');
  });

  it("adds comments from generated edit forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const response = await app.request("/desk/Note/My%20Note/comments", {
      method: "POST",
      body: new URLSearchParams({ comment_text: "Desk note", expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/desk/Note/My%20Note");
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({ version: 2 });

    const edit = await app.request("/desk/Note/My%20Note");
    expect(edit.status).toBe(200);
    await expect(edit.text()).resolves.toContain("Commented: Desk note");
  });

  it("renders and submits assignment controls from generated edit forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const initial = await app.request("/desk/Note/My%20Note");
    expect(initial.status).toBe(200);
    const initialHtml = await initial.text();
    expect(initialHtml).toContain('<h3 id="document-assignments">Assignments</h3>');
    expect(initialHtml).toContain('formaction="/desk/Note/My%20Note/assignments"');
    expect(initialHtml).toContain('name="assignee"');

    const assigned = await app.request("/desk/Note/My%20Note/assignments", {
      method: "POST",
      body: new URLSearchParams({ assignee: "support@example.com", expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(assigned.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({ version: 2 });

    const withAssignee = await app.request("/desk/Note/My%20Note");
    expect(withAssignee.status).toBe(200);
    const assignedHtml = await withAssignee.text();
    expect(assignedHtml).toContain("support@example.com");
    expect(assignedHtml).toContain('formaction="/desk/Note/My%20Note/assignments/support%40example.com/remove"');

    const unassigned = await app.request("/desk/Note/My%20Note/assignments/support%40example.com/remove", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "2" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(unassigned.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({ version: 3 });
  });

  it("submits and cancels documents from generated edit forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const draft = await app.request("/desk/Note/My%20Note");
    expect(draft.status).toBe(200);
    const draftHtml = await draft.text();
    expect(draftHtml).toContain('formaction="/desk/Note/My%20Note/submit"');
    expect(draftHtml).not.toContain('formaction="/desk/Note/My%20Note/cancel"');

    const submitted = await app.request("/desk/Note/My%20Note/submit", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(submitted.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({
      docstatus: "submitted",
      version: 2
    });

    const submittedForm = await app.request("/desk/Note/My%20Note");
    expect(submittedForm.status).toBe(200);
    const submittedHtml = await submittedForm.text();
    expect(submittedHtml).toContain("submitted");
    expect(submittedHtml).toContain('formaction="/desk/Note/My%20Note/cancel"');
    expect(submittedHtml).not.toContain(">Save</button>");
    expect(submittedHtml).not.toContain("/command/archive");

    const cancelled = await app.request("/desk/Note/My%20Note/cancel", {
      method: "POST",
      body: new URLSearchParams({ expectedVersion: "2" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(cancelled.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({
      docstatus: "cancelled",
      version: 3
    });
  });

  it("renders printable documents from Desk", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Desk Print", priority: "High", body: "Print body" })
    });

    const response = await app.request("/desk/print/Note%20Standard/Desk%20Print");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Desk Print");
    expect(html).toContain("Print body");
  });

  it("creates documents from generated forms", async () => {
    const { app, services } = makeDesk();

    const response = await app.request("/desk/Note", {
      method: "POST",
      body: new URLSearchParams({ title: "Desk Note", body: "From form" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/desk/Note/Desk%20Note");
    await expect(services.queries.getDocument(owner, "Note", "Desk Note")).resolves.toMatchObject({
      data: { body: "From form", created_by: owner.id }
    });
    await expect(services.events.readStream("acme:Note:Desk%20Note")).resolves.toMatchObject([
      { metadata: { method: "POST", url: "http://localhost/desk/Note" } }
    ]);
  });

  it("renders link fields as target-backed select options", async () => {
    const { app, services } = makeLinkedDesk();
    await services.documents.create({ actor: owner, doctype: "Project", data: { title: "Apollo" } });
    await services.documents.create({ actor: owner, doctype: "Project", data: { title: "Zeus" } });

    const form = await app.request("/desk/Task/new");

    expect(form.status).toBe(200);
    const html = await form.text();
    expect(html).toContain('name="project"');
    expect(html).toContain('<option value="Apollo">Apollo</option>');
    expect(html).toContain('<option value="Zeus">Zeus</option>');

    await services.documents.create({
      actor: owner,
      doctype: "Task",
      data: { title: "Launch", project: "Apollo" }
    });

    const edit = await app.request("/desk/Task/Launch");
    expect(edit.status).toBe(200);
    await expect(edit.text()).resolves.toContain('<option value="Apollo" selected>Apollo</option>');
  });

  it("renders and parses child table fields from generated forms", async () => {
    const { app, services } = makeChildTableDesk();
    await services.documents.create({ actor: owner, doctype: "Product", data: { sku: "SKU-1", title: "Widget" } });

    const form = await app.request("/desk/Sales%20Invoice/new");

    expect(form.status).toBe(200);
    const html = await form.text();
    expect(html).toContain("<legend>items *</legend>");
    expect(html).toContain('name="items[0].product"');
    expect(html).toContain('<option value="SKU-1">Widget</option>');
    expect(html).toContain('name="items[0].quantity"');
    expect(html).not.toContain("/desk/Sales%20Invoice%20Item");

    const created = await app.request("/desk/Sales%20Invoice", {
      method: "POST",
      body: new URLSearchParams({
        title: "INV-DESK",
        "items[0].product": "SKU-1",
        "items[0].quantity": "2",
        "items[0].rate": "10",
        "items[1].product": "",
        "items[1].quantity": ""
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/desk/Sales%20Invoice/INV-DESK");
    await expect(services.queries.getDocument(owner, "Sales Invoice", "INV-DESK")).resolves.toMatchObject({
      data: {
        items: [{ product: "SKU-1", quantity: 2, rate: 10 }]
      }
    });

    const edit = await app.request("/desk/Sales%20Invoice/INV-DESK");
    expect(edit.status).toBe(200);
    const editHtml = await edit.text();
    expect(editHtml).toContain('name="items[0].product"');
    expect(editHtml).toContain('<option value="SKU-1" selected>Widget</option>');
    expect(editHtml).toContain(`name="items[0].${CHILD_TABLE_ROW_INDEX_FIELD}" value="0"`);
    expect(editHtml).toContain('name="items[1].product"');
  });

  it("keeps read-only child values with the correct Desk row after deleting an earlier row", async () => {
    const { app, services } = makeChildTableDesk();
    await services.documents.create({ actor: owner, doctype: "Product", data: { sku: "SKU-1", title: "Widget" } });
    await services.documents.create({ actor: owner, doctype: "Product", data: { sku: "SKU-2", title: "Gadget" } });
    await services.documents.create({
      actor: owner,
      doctype: "Sales Invoice",
      data: {
        title: "INV-DESK",
        items: [
          { product: "SKU-1", quantity: 1, line_id: "line-1" },
          { product: "SKU-2", quantity: 2, rate: 20, line_id: "line-2" }
        ]
      }
    });

    const edit = await app.request("/desk/Sales%20Invoice/INV-DESK");
    expect(edit.status).toBe(200);
    const editHtml = await edit.text();
    expect(editHtml).toContain(`name="items[0].${CHILD_TABLE_ROW_INDEX_FIELD}" value="0"`);
    expect(editHtml).toContain(`name="items[1].${CHILD_TABLE_ROW_INDEX_FIELD}" value="1"`);

    const updated = await app.request("/desk/Sales%20Invoice/INV-DESK", {
      method: "POST",
      body: new URLSearchParams({
        title: "INV-DESK",
        expectedVersion: "1",
        [`items[0].${CHILD_TABLE_ROW_INDEX_FIELD}`]: "0",
        "items[0].product": "",
        "items[0].quantity": "",
        [`items[1].${CHILD_TABLE_ROW_INDEX_FIELD}`]: "1",
        "items[1].product": "SKU-2",
        "items[1].quantity": "3",
        "items[1].rate": "20"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(updated.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Sales Invoice", "INV-DESK")).resolves.toMatchObject({
      data: {
        items: [{ product: "SKU-2", quantity: 3, rate: 20, line_id: "line-2" }]
      },
      version: 2
    });
    const stream = await services.events.readStream("acme:Sales%20Invoice:INV-DESK");
    expect(JSON.stringify(stream)).not.toContain(CHILD_TABLE_ROW_INDEX_FIELD);
  });

  it("does not submit omitted form-view boolean fields as unchecked", async () => {
    const Flag = defineDocType({
      name: "Flag",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "enabled", type: "boolean", defaultValue: true }
      ],
      formView: {
        sections: [{ fields: ["title"] }]
      },
      permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
    });
    const registry = createRegistry({ doctypes: [Flag] });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({
      registry,
      store,
      clock: fixedClock(now),
      ids: deterministicIds(["flag-1", "flag-2"])
    });
    const queries = new QueryService({ registry, projections: store });
    const app = createDeskApp({
      registry,
      documents,
      queries,
      actor: () => owner
    });

    const created = await app.request("/desk/Flag", {
      method: "POST",
      body: new URLSearchParams({ title: "Feature Flag" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(created.status).toBe(303);
    await expect(queries.getDocument(owner, "Flag", "Feature Flag")).resolves.toMatchObject({
      data: { enabled: true }
    });

    const updated = await app.request("/desk/Flag/Feature%20Flag", {
      method: "POST",
      body: new URLSearchParams({ title: "Feature Flag", expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(updated.status).toBe(303);
    await expect(queries.getDocument(owner, "Flag", "Feature Flag")).resolves.toMatchObject({
      data: { enabled: true },
      version: 2
    });
  });

  it("ignores read-only fields submitted on create", async () => {
    const { app, services } = makeDesk();

    const response = await app.request("/desk/Note", {
      method: "POST",
      body: new URLSearchParams({ title: "Desk Note", body: "From form", created_by: "attacker" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "Desk Note")).resolves.toMatchObject({
      data: { created_by: owner.id }
    });
  });

  it("updates documents and executes model commands from generated forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const update = await app.request("/desk/Note/My%20Note", {
      method: "POST",
      body: new URLSearchParams({ title: "My Note", body: "Edited", expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(update.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({
      data: { body: "Edited" }
    });

    const command = await app.request("/desk/Note/My%20Note/command/archive", {
      method: "POST",
      body: new URLSearchParams({ title: "My Note", body: "Edited", expectedVersion: "2" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    expect(command.status).toBe(303);
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({
      data: { workflow_state: "Closed" }
    });
    await expect(services.events.readStream("acme:Note:My%20Note")).resolves.toMatchObject([
      expect.anything(),
      { metadata: { method: "POST", url: "http://localhost/desk/Note/My%20Note" } },
      { metadata: { method: "POST", url: "http://localhost/desk/Note/My%20Note/command/archive" } }
    ]);
  });

  it("rejects stale generated form posts instead of appending over newer events", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });
    await services.documents.update({ actor: owner, doctype: "Note", name: "My Note", patch: { body: "Newer" } });

    const stale = await app.request("/desk/Note/My%20Note", {
      method: "POST",
      body: new URLSearchParams({ title: "My Note", body: "Stale", expectedVersion: "1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(stale.status).toBe(409);
    const html = await stale.text();
    expect(html).toContain("Expected version 1, found 2");
    await expect(services.queries.getDocument(owner, "Note", "My Note")).resolves.toMatchObject({
      data: { body: "Newer" }
    });
  });

  it("renders validation errors next to the generated form", async () => {
    const { app } = makeDesk();

    const response = await app.request("/desk/Note", {
      method: "POST",
      body: new URLSearchParams({ title: "No" }),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(422);
    const html = await response.text();
    expect(html).toContain("Validation failed");
    expect(html).toContain('role="alert"');
  });

  it("uses the Desk error boundary for GET failures", async () => {
    const { app } = makeDesk();

    const response = await app.request("/desk/Missing");

    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain("DocType &#39;Missing&#39; is not registered");
    expect(html).toContain("cf-frappe Desk");
  });
});
