import {
  createRegistry,
  defineKanban,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  KanbanService,
  QueryService
} from "../../src";
import { data, noteDocType, now, owner } from "../helpers";

describe("KanbanService", () => {
  it("runs metadata kanban boards through permissioned document queries", async () => {
    const registry = createRegistry({
      doctypes: [noteDocType],
      kanbans: [
        defineKanban({
          name: "Notes Board",
          label: "Notes Board",
          roles: ["User"],
          doctype: "Note",
          columnField: "workflow_state",
          titleField: "title",
          filters: [{ field: "priority", value: "High" }],
          filterExpression: {
            kind: "group",
            match: "any",
            filters: [
              { field: "title", operator: "contains", value: "Visible" },
              { field: "title", operator: "contains", value: "Escalation" }
            ]
          },
          columns: [
            { value: "Open", label: "Open", indicator: "blue" },
            { value: "Closed", label: "Closed", indicator: "green" }
          ],
          maxCardsPerColumn: 1
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const kanbans = new KanbanService({ registry, queries });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Visible Open A", priority: "High", workflow_state: "Open", count: 1 })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Visible Open B", priority: "High", workflow_state: "Open", count: 2 })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Visible Closed", priority: "High", workflow_state: "Closed", count: 3 })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Filtered Low", priority: "Low", workflow_state: "Open", count: 4 })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Filtered Expression", priority: "High", workflow_state: "Open", count: 6 })
    });
    await documents.create({
      actor: { ...owner, id: "other@example.com" },
      doctype: "Note",
      data: data({ title: "Hidden Other", priority: "High", workflow_state: "Open", count: 5 })
    });

    await expect(kanbans.listKanbans(owner)).resolves.toMatchObject([{ name: "Notes Board" }]);
    await expect(kanbans.runKanban(owner, "Notes Board")).resolves.toMatchObject({
      board: { name: "Notes Board" },
      columns: [
        {
          value: "Open",
          label: "Open",
          total: 2,
          hasMore: true,
          cards: [{ title: expect.stringMatching(/^Visible Open/), data: { workflow_state: "Open" } }]
        },
        {
          value: "Closed",
          label: "Closed",
          total: 1,
          hasMore: false,
          cards: [{ title: "Visible Closed", data: { workflow_state: "Closed" } }]
        }
      ]
    });
  });
});
