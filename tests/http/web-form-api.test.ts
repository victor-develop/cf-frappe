import {
  createRegistry,
  createResourceApi,
  defineDocType,
  defineWebForm,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  unsafeHeaderActorResolver,
  WebFormService
} from "../../src";
import { now } from "../helpers";

const leadDocType = defineDocType({
  name: "Lead",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "email", type: "text" },
    { name: "score", type: "integer" },
    { name: "accepted", type: "boolean" },
    { name: "details", type: "json" }
  ],
  permissions: [{ roles: ["Guest"], actions: ["create"] }]
});

describe("web form api", () => {
  it("serves metadata and submits web forms through JSON and public HTML routes", async () => {
    const registry = createRegistry({
      doctypes: [leadDocType],
      webForms: [
        defineWebForm({
          name: "Lead Intake",
          label: "Lead Intake",
          doctype: "Lead",
          fields: [
            { field: "title", label: "Name", required: true },
            { field: "email" },
            { field: "score" },
            { field: "accepted" },
            { field: "details" }
          ],
          successMessage: "Thanks for reaching out."
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webForms = new WebFormService({ registry, documents, queries });
    const app = createResourceApi({
      registry,
      documents,
      queries,
      webForms,
      actor: unsafeHeaderActorResolver
    });

    const listed = await app.request("/api/meta/web-forms");
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({ data: [{ name: "Lead Intake", doctype: "Lead" }] });

    const metadata = await app.request("/api/meta/web-forms/Lead%20Intake");
    expect(metadata.status).toBe(200);
    await expect(metadata.json()).resolves.toMatchObject({
      data: {
        form: { name: "Lead Intake" },
        doctype: "Lead",
        fields: expect.arrayContaining([{ field: "title", label: "Name", type: "text", required: true }])
      }
    });

    const jsonSubmit = await app.request("/api/web-form/Lead%20Intake/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { title: "JSON Lead", email: "json@example.com", score: 7, accepted: true } })
    });
    expect(jsonSubmit.status).toBe(201);
    await expect(jsonSubmit.json()).resolves.toMatchObject({
      data: { document: { name: "JSON Lead", data: { score: 7, accepted: true } } }
    });

    const html = await app.request("/web-forms/Lead%20Intake");
    expect(html.status).toBe(200);
    await expect(html.text()).resolves.toContain("<h1>Lead Intake</h1>");

    const formSubmit = await app.request("/web-forms/Lead%20Intake", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        title: "HTML Lead",
        email: "html@example.com",
        score: "9",
        accepted: "1",
        details: "{\"source\":\"html\"}"
      })
    });
    expect(formSubmit.status).toBe(201);
    await expect(formSubmit.text()).resolves.toContain("Thanks for reaching out.");
    await expect(store.get("default", "Lead", "HTML Lead"))
      .resolves.toMatchObject({
        data: {
          title: "HTML Lead",
          score: 9,
          accepted: true,
          details: { source: "html" }
        }
      });
  });
});
