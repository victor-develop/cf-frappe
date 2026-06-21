import { createDeskApp } from "../../src";
import { createServices, data, owner } from "../helpers";

describe("Desk app", () => {
  function makeDesk() {
    const services = createServices(["e1", "e2", "e3", "e4"]);
    const app = createDeskApp({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      reports: services.reports,
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
      data: data({ title: "Report Note", priority: "High", body: "For reporting" })
    });

    const list = await app.request("/desk/reports");
    expect(list.status).toBe(200);
    await expect(list.text()).resolves.toContain("Open Notes");

    const report = await app.request("/desk/reports/Open%20Notes?filter_priority=High");
    expect(report.status).toBe(200);
    const html = await report.text();
    expect(html).toContain("Report Note");
    expect(html).toContain("For reporting");
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
    expect(html).toContain("Create");
  });

  it("renders expectedVersion in edit forms", async () => {
    const { app, services } = makeDesk();
    await services.documents.create({ actor: owner, doctype: "Note", data: data() });

    const response = await app.request("/desk/Note/My%20Note");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('name="expectedVersion" value="1"');
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
