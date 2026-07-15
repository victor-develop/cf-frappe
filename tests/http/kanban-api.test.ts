import {
  createResourceApi,
  defineKanban,
  KanbanService,
  unsafeHeaderActorResolver
} from "../../src";
import { createServices, data, owner } from "../helpers";

describe("kanban api", () => {
  const userHeaders = {
    "content-type": "application/json",
    "x-cf-frappe-user": "owner@example.com",
    "x-cf-frappe-roles": "User",
    "x-cf-frappe-tenant": "acme"
  };

  it("serves metadata kanban boards and executed columns", async () => {
    const services = createServices(["e1", "e2", "e3"]);
    services.registry.registerKanban(
      defineKanban({
        name: "Notes Board",
        label: "Notes Board",
        roles: ["User"],
        doctype: "Note",
        columnField: "workflow_state",
        titleField: "title",
        columns: [{ value: "Open" }, { value: "Closed" }]
      })
    );
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "HTTP Open", priority: "High", workflow_state: "Open", count: 1 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "HTTP Closed", priority: "High", count: 2 })
    });
    await services.documents.transition({ actor: owner, doctype: "Note", name: "HTTP Closed", action: "close" });
    const kanbans = new KanbanService({ registry: services.registry, queries: services.queries });
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      kanbans,
      actor: unsafeHeaderActorResolver
    });

    const listed = await app.request("/api/meta/kanbans", { headers: userHeaders });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      data: [{ name: "Notes Board", doctype: "Note", columnField: "workflow_state" }]
    });

    const single = await app.request("/api/meta/kanbans/Notes%20Board", { headers: userHeaders });
    expect(single.status).toBe(200);
    await expect(single.json()).resolves.toMatchObject({ data: { name: "Notes Board" } });

    const run = await app.request("/api/kanban/Notes%20Board/run", { headers: userHeaders });
    expect(run.status).toBe(200);
    await expect(run.json()).resolves.toMatchObject({
      data: {
        board: { name: "Notes Board" },
        columns: [
          { value: "Open", total: 1, cards: [{ title: "HTTP Open" }] },
          { value: "Closed", total: 1, cards: [{ title: "HTTP Closed" }] }
        ]
      }
    });
  });
});
