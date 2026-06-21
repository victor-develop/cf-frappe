import {
  createRegistry,
  defineDocType,
  deterministicIds,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService
} from "../src";
import type { Actor, DocumentData, ModelRegistry } from "../src";

export const now = "2026-01-01T00:00:00.000Z";

export const owner: Actor = {
  id: "owner@example.com",
  roles: ["User"],
  tenantId: "acme"
};

export const manager: Actor = {
  id: "manager@example.com",
  roles: ["Task Manager"],
  tenantId: "acme"
};

export const guest: Actor = {
  id: "guest",
  roles: ["Guest"],
  tenantId: "acme"
};

export const noteDocType = defineDocType({
  name: "Note",
  module: "Tests",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true, min: 3 },
    { name: "body", type: "longText" },
    { name: "priority", type: "select", options: ["Low", "Medium", "High"], defaultValue: "Medium" },
    { name: "count", type: "integer", defaultValue: 0 },
    { name: "workflow_state", type: "select", options: ["Open", "Closed"], defaultValue: "Open" },
    { name: "created_by", type: "text", readOnly: true, defaultValue: ({ actor }) => actor.id }
  ],
  workflow: {
    initialState: "Open",
    states: ["Open", "Closed"],
    transitions: [{ action: "close", from: "Open", to: "Closed", roles: ["User"] }]
  },
  permissions: [
    { roles: ["Guest"], actions: ["read"] },
    {
      roles: ["User"],
      actions: ["read", "create", "update", "transition"],
      when: ({ actor, document }) => !document || document.data.created_by === actor.id
    },
    { roles: ["Task Manager"], actions: ["read", "create", "update", "delete", "transition"] }
  ],
  commands: [
    {
      name: "archive",
      eventType: "NoteArchived",
      buildPatch: () => ({ workflow_state: "Closed" })
    },
    {
      name: "rewriteBody",
      eventType: "NoteBodyRewritten",
      fields: ["body"]
    }
  ]
});

export function createTestRegistry(): ModelRegistry {
  return createRegistry({
    doctypes: [noteDocType],
    hooks: {
      Note: [
        {
          beforeValidate: ({ data }) => ({
            title: typeof data.title === "string" ? data.title.trim() : data.title
          }),
          validate: ({ data }) =>
            data.priority === "High" && !data.body
              ? [{ field: "body", code: "high_priority_body", message: "High priority notes need a body" }]
              : []
        }
      ]
    }
  });
}

export function createServices(ids: readonly string[] = ["evt1", "evt2", "evt3", "evt4"]) {
  const registry = createTestRegistry();
  const store = new InMemoryDocumentStore();
  const documents = new DocumentService({
    registry,
    store,
    clock: fixedClock(now),
    ids: deterministicIds(ids)
  });
  const queries = new QueryService({ registry, projections: store });
  return { registry, store, events: store, projections: store, documents, queries };
}

export function data(overrides: DocumentData = {}): DocumentData {
  return { title: "My Note", body: "Body", ...overrides };
}
