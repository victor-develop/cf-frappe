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
  formView: {
    sections: [
      { heading: "Summary", columns: 1, fields: ["title", "priority"] },
      { heading: "Details", columns: 2, fields: ["body", "count", "workflow_state"] }
    ]
  },
  listView: {
    columns: ["title", "priority", "workflow_state"],
    filterFields: ["title", "priority", "workflow_state"],
    filters: [{ field: "workflow_state", value: "Open" }],
    pageSize: 25
  },
  workflow: {
    initialState: "Open",
    states: ["Open", "Closed"],
    transitions: [{ action: "close", from: "Open", to: "Closed", roles: ["User"] }]
  },
  permissions: [
    { roles: ["Guest"], actions: ["read"] },
    {
      roles: ["User"],
      actions: ["read", "create", "update", "submit", "cancel", "transition"],
      when: ({ actor, document }) => !document || document.data.created_by === actor.id
    },
    { roles: ["Task Manager"], actions: ["read", "create", "update", "delete", "submit", "cancel", "transition"] }
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

export const projectDocType = defineDocType({
  name: "Project",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "created_by", type: "text", readOnly: true, defaultValue: ({ actor }) => actor.id }
  ],
  permissions: [
    {
      roles: ["User"],
      actions: ["read", "create", "update", "delete"],
      when: ({ actor, document }) => !document || document.data.created_by === actor.id
    }
  ]
});

export const taskDocType = defineDocType({
  name: "Task",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "project", type: "link", linkTo: "Project", required: true },
    { name: "description", type: "longText" }
  ],
  formView: {
    sections: [{ heading: "Task", columns: 1, fields: ["title", "project", "description"] }]
  },
  listView: {
    columns: ["title", "project"],
    filterFields: ["title", "project"]
  },
  permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }],
  commands: [
    {
      name: "move",
      eventType: "TaskMoved",
      fields: ["project"]
    }
  ]
});

export const productDocType = defineDocType({
  name: "Product",
  naming: { kind: "field", field: "sku" },
  fields: [
    { name: "sku", type: "text", required: true },
    { name: "title", type: "text" }
  ],
  permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
});

export const salesInvoiceItemDocType = defineDocType({
  name: "Sales Invoice Item",
  fields: [
    { name: "product", type: "link", linkTo: "Product", required: true },
    { name: "quantity", type: "integer", required: true, min: 1 },
    { name: "rate", type: "number", min: 0 },
    { name: "line_id", type: "text", readOnly: true }
  ]
});

export const salesInvoiceDocType = defineDocType({
  name: "Sales Invoice",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "items", type: "table", tableOf: "Sales Invoice Item", required: true },
    { name: "remarks", type: "longText" }
  ],
  formView: {
    sections: [{ heading: "Invoice", columns: 1, fields: ["title", "items", "remarks"] }]
  },
  listView: {
    columns: ["title"],
    filterFields: ["title"]
  },
  permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }],
  commands: [
    {
      name: "replaceItems",
      eventType: "SalesInvoiceItemsReplaced",
      fields: ["items"]
    },
    {
      name: "customReplaceItems",
      eventType: "SalesInvoiceCustomItemsReplaced",
      buildPatch: ({ input }) => (input.items === undefined ? {} : { items: input.items })
    }
  ]
});

export const supportTicketDocType = defineDocType({
  name: "Support Ticket",
  naming: { kind: "series", pattern: "TICK-.####" },
  fields: [
    { name: "subject", type: "text", required: true },
    { name: "description", type: "longText" }
  ],
  permissions: [{ roles: ["User"], actions: ["read", "create", "update", "submit", "cancel"] }]
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

export function createLinkedServices(ids: readonly string[] = ["evt1", "evt2", "evt3", "evt4"]) {
  const registry = createRegistry({ doctypes: [projectDocType, taskDocType] });
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

export function createChildTableServices(ids: readonly string[] = ["evt1", "evt2", "evt3", "evt4"]) {
  const registry = createRegistry({
    doctypes: [productDocType, salesInvoiceItemDocType, salesInvoiceDocType]
  });
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

export function createSeriesServices(ids: readonly string[] = ["evt1", "evt2", "evt3", "evt4"]) {
  const registry = createRegistry({ doctypes: [supportTicketDocType] });
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
