import {
  createRegistry,
  defineDocType,
  definePrintFormat,
  defineReport,
  deterministicIds,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  PrintService,
  QueryService,
  ReportService
} from "../src";
import type { Actor, DocumentData, DomainEvent, ModelRegistry } from "../src";
import type { AfterCommitContext } from "../src";

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

export const openNotesReport = defineReport({
  name: "Open Notes",
  label: "Open Notes",
  module: "Tests",
  description: "Notes grouped for operational follow-up.",
  doctype: "Note",
  columns: [
    { name: "title", label: "Title", type: "text" },
    { name: "priority", label: "Priority", type: "select" },
    { name: "body", label: "Body", type: "longText" }
  ],
  filters: [
    { name: "priority", label: "Priority", field: "priority", type: "select" },
    { name: "title", label: "Title", field: "title", type: "text", operator: "contains" }
  ],
  roles: ["User", "Task Manager"]
});

export const notePrintFormat = definePrintFormat({
  name: "Note Standard",
  label: "Standard",
  module: "Tests",
  description: "Printable note summary.",
  doctype: "Note",
  sections: [
    {
      heading: "Details",
      fields: [
        { field: "title", label: "Title" },
        { field: "priority", label: "Priority" },
        { field: "body", label: "Body" }
      ]
    }
  ],
  roles: ["User", "Task Manager"]
});

export function createTestRegistry(): ModelRegistry {
  return createRegistry({
    doctypes: [noteDocType],
    printFormats: [notePrintFormat],
    reports: [openNotesReport],
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

export function createServices(
  ids: readonly string[] = ["evt1", "evt2", "evt3", "evt4"],
  options: {
    readonly afterCommit?: (context: AfterCommitContext) => void | Promise<void>;
    readonly onHookError?: (error: unknown, event: DomainEvent) => void | Promise<void>;
  } = {}
) {
  const registry = createTestRegistry();
  const store = new InMemoryDocumentStore();
  const documents = new DocumentService({
    registry,
    store,
    clock: fixedClock(now),
    ids: deterministicIds(ids),
    ...(options.afterCommit === undefined ? {} : { afterCommit: options.afterCommit }),
    ...(options.onHookError === undefined ? {} : { onHookError: options.onHookError })
  });
  const queries = new QueryService({ registry, projections: store });
  const prints = new PrintService({ registry, queries });
  const reports = new ReportService({ registry, queries });
  return { registry, store, events: store, projections: store, documents, prints, queries, reports };
}

export function data(overrides: DocumentData = {}): DocumentData {
  return { title: "My Note", body: "Body", ...overrides };
}
