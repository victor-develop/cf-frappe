import { createResourceApi, unsafeHeaderActorResolver } from "../../src";
import { createServices, data } from "../helpers";

describe("report api", () => {
  const userHeaders = {
    "x-cf-frappe-user": "owner@example.com",
    "x-cf-frappe-roles": "User",
    "x-cf-frappe-tenant": "acme"
  };

  function makeApp() {
    const services = createServices(["e1", "e2"]);
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      reports: services.reports,
      actor: unsafeHeaderActorResolver
    });
    return { app, services };
  }

  it("lists report metadata", async () => {
    const { app } = makeApp();

    const response = await app.request("/api/meta/reports", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ name: "Open Notes", doctype: "Note" }]
    });
  });

  it("runs a report with query-string filters", async () => {
    const { app, services } = makeApp();
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "Low Note", priority: "Low" }) });
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "High Note", priority: "High", body: "Needs care" }) });

    const response = await app.request("/api/report/Open%20Notes/run?filter_priority=High", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rows: [{ title: "High Note", priority: "High", body: "Needs care" }],
      total: 1
    });
  });

  it("hides reports from actors without report roles", async () => {
    const { app } = makeApp();

    const response = await app.request("/api/meta/reports", {
      headers: { ...userHeaders, "x-cf-frappe-user": "guest", "x-cf-frappe-roles": "Guest" }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [] });
  });
});
