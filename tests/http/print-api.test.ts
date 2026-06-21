import { createResourceApi, unsafeHeaderActorResolver } from "../../src";
import { createServices, data, owner } from "../helpers";

describe("print api", () => {
  const userHeaders = {
    "x-cf-frappe-user": "owner@example.com",
    "x-cf-frappe-roles": "User",
    "x-cf-frappe-tenant": "acme"
  };

  function makeApp() {
    const services = createServices(["e1"]);
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      prints: services.prints,
      queries: services.queries,
      reports: services.reports,
      actor: unsafeHeaderActorResolver
    });
    return { app, services };
  }

  it("lists print format metadata", async () => {
    const { app } = makeApp();

    const response = await app.request("/api/meta/print-formats?doctype=Note", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ name: "Note Standard", doctype: "Note" }]
    });
  });

  it("renders a printable document as HTML", async () => {
    const { app, services } = makeApp();
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Printable", priority: "High", body: "<script>alert('x')</script>" })
    });

    const response = await app.request("/api/print/Note%20Standard/Printable", { headers: userHeaders });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Printable");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
  });
});
