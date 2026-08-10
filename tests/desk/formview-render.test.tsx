import { defineDocType } from "../../src/core/schema.js";
import { resolveFormView } from "../../src/core/form-view.js";
import { type DocumentSnapshot } from "../../src/core/types.js";
import { type DocumentTimeline } from "../../src/application/document-history-service.js";
import {
  renderDocumentTimeline,
  renderFormView,
  renderRelatedResources
} from "../../src/adapters/desk/views/formview.js";

const Task = defineDocType({
  name: "Task",
  fields: [
    { name: "title", type: "text" },
    { name: "assignee", type: "link", linkTo: "User" },
    { name: "status", type: "select", options: ["Open", "Done"] }
  ]
});

function snapshot(overrides: Partial<DocumentSnapshot> = {}): DocumentSnapshot {
  return {
    doctype: "Task",
    name: "TASK-1",
    tenantId: "tenant-a",
    version: 4,
    docstatus: "draft",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
    data: { title: "Ship it", status: "Open" },
    ...overrides
  };
}

function timeline(entries: DocumentTimeline["entries"] = []): DocumentTimeline {
  return {
    tenantId: "tenant-a",
    doctype: "Task",
    name: "TASK-1",
    version: 4,
    docstatus: "draft",
    limit: 20,
    beforeSequence: 100,
    entries
  };
}

const timelineEntry: DocumentTimeline["entries"][number] = {
  eventId: "evt-1",
  sequence: 1,
  type: "task.updated.v1",
  kind: "DocumentUpdated",
  actorId: "user-1",
  occurredAt: "2026-08-02T00:00:00Z",
  summary: "Updated",
  changes: [{ field: "title", oldValue: "Draft it", newValue: "Ship it" }],
  payload: { kind: "DocumentUpdated" } as unknown as DocumentTimeline["entries"][number]["payload"],
  metadata: {}
};

describe("Desk related resources", () => {
  it("returns an empty string when there is nothing related", () => {
    expect(renderRelatedResources({ doctype: "Task", doctypes: [], printFormats: [] })).toBe("");
  });

  it("renders a single incoming doctype resource without a document", () => {
    const html = renderRelatedResources({
      doctype: "Task",
      doctypes: [
        {
          kind: "doctype",
          direction: "incoming",
          doctype: "Note",
          doctypeLabel: "Note",
          field: "task",
          fieldLabel: "Task"
        }
      ],
      printFormats: []
    });
    expect(html).toContain("1 resource</p>");
    expect(html).toContain("Incoming via Task");
    expect(html).toContain('href="/desk/Note"');
  });

  it("renders doctype directions and print formats with a document name", () => {
    const html = renderRelatedResources(
      {
        doctype: "Task",
        documentName: "TASK-1",
        doctypes: [
          {
            kind: "doctype",
            direction: "incoming",
            doctype: "Note",
            doctypeLabel: "Note",
            field: "task",
            fieldLabel: "Task"
          },
          {
            kind: "doctype",
            direction: "outgoing",
            doctype: "User",
            doctypeLabel: "User",
            field: "assignee",
            fieldLabel: "Assignee",
            linkedDocumentName: "USER-1"
          },
          {
            kind: "doctype",
            direction: "outgoing",
            doctype: "Project",
            doctypeLabel: "Project",
            field: "project",
            fieldLabel: "Project"
          }
        ],
        printFormats: [
          { kind: "print-format", name: "task-print", label: "Task Print", description: "Standard layout" },
          { kind: "print-format", name: "task-compact", label: "Compact" }
        ]
      },
      { printPdfEnabled: true }
    );
    expect(html).toContain("5 resources</p>");
    expect(html).toContain("filter_task");
    expect(html).toContain('href="/desk/User/USER-1"');
    expect(html).toContain('href="/desk/Project"');
    expect(html).toContain("Standard layout");
    expect(html).toContain('href="/desk/print/task-print/TASK-1/pdf"');
  });

  it("links print formats to inspection pages when no document is present", () => {
    const html = renderRelatedResources({
      doctype: "Task",
      doctypes: [],
      printFormats: [{ kind: "print-format", name: "task-print", label: "Task Print" }]
    });
    expect(html).toContain('href="/desk/printing/formats/task-print"');
    expect(html).not.toContain("/pdf");
  });
});

describe("Desk form view", () => {
  it("renders an update form without a document using fallbacks", () => {
    const html = renderFormView(Task, resolveFormView(Task), { mode: "update" });
    expect(html).toContain('action="/desk/Task/"');
    expect(html).toContain("<h2>Task</h2>");
    expect(html).not.toContain(">Save</button>");
  });

  it("renders duplicate, amend, commands, grouped workflows, and unlabeled print formats", () => {
    const cancelled = snapshot({ docstatus: "cancelled" });
    const html = renderFormView(Task, resolveFormView(Task), {
      mode: "update",
      document: cancelled,
      canUpdate: true,
      canDuplicate: true,
      canAmend: true,
      domainCommands: [{ name: "escalate" }],
      workflowActions: [
        { workflow: "review", workflowLabel: "Review", action: "approve", label: "Approve", to: "Approved" },
        { workflow: "review", workflowLabel: "Review", action: "reject", label: "Reject", to: "Rejected" }
      ],
      printFormats: [{ name: "task-print", doctype: "Task" }],
      printPdfEnabled: false
    });
    expect(html).toContain("/desk/Task/TASK-1/amend");
    expect(html).toContain("/desk/Task/TASK-1/duplicate");
    expect(html).not.toContain("/command/escalate");
    expect(html).toContain("Review workflow actions");
    expect(html).toContain(">Approve</button>");
    expect(html).toContain(">Reject</button>");
    expect(html).toContain(">task-print</a>");
    expect(html).not.toContain("task-print PDF");
  });

  it("renders domain commands for draft documents", () => {
    const html = renderFormView(Task, resolveFormView(Task), {
      mode: "update",
      document: snapshot(),
      canUpdate: true,
      domainCommands: [{ name: "escalate" }]
    });
    expect(html).toContain("/desk/Task/TASK-1/command/escalate");
    expect(html).toContain(">Save</button>");
  });

  it("renders link fields with unknown selected values and duplicate options", () => {
    const html = renderFormView(Task, resolveFormView(Task), {
      mode: "update",
      document: snapshot({ data: { title: "Ship it", assignee: "ghost@example.com", status: "Open" } }),
      canUpdate: true,
      linkOptions: {
        assignee: [
          { value: "a@example.com", label: "A" },
          { value: "a@example.com", label: "A again" },
          { value: "b@example.com", label: "B" }
        ]
      }
    });
    expect(html).toContain('<option value="ghost@example.com" selected>ghost@example.com</option>');
    expect(html).toContain('<option value="a@example.com">A</option>');
    expect(html).not.toContain("A again");
  });

  it("renders child tables covering missing definitions, nested cells, and read-only fieldsets", () => {
    const Line = defineDocType({
      name: "Line",
      fields: [
        { name: "item", type: "text", label: "Item" },
        { name: "kind", type: "select", options: ["A", "B"] },
        { name: "vendor", type: "link", linkTo: "User" },
        { name: "notes", type: "longText" },
        { name: "done", type: "boolean" },
        { name: "secret", type: "text", hidden: true }
      ]
    });
    const Order = defineDocType({
      name: "Order",
      fields: [
        { name: "lines", type: "table", tableOf: "Line" },
        { name: "attachments", type: "table", tableOf: "Blob", readOnly: true },
        { name: "archive", type: "table", tableOf: "Line", readOnly: true }
      ]
    });
    const html = renderFormView(Order, resolveFormView(Order), {
      mode: "update",
      document: snapshot({
        doctype: "Order",
        name: "ORD-1",
        data: {
          lines: [{ item: "Widget", kind: "B", notes: "fragile", done: true }],
          attachments: [{ file: "a.txt" }],
          archive: [{ item: "Old" }]
        }
      }),
      canUpdate: true,
      tableDefinitions: { lines: Line, archive: Line }
    });
    expect(html).toContain('name="lines[0].item"');
    expect(html).toContain('aria-label="Item, row 1"');
    expect(html).toContain('<option value="B" selected>B</option>');
    expect(html).toContain(">fragile</textarea>");
    expect(html).toContain('name="lines[0].done"');
    expect(html).toContain("checked");
    expect(html).toContain('name="lines[1].item"');
    expect(html).toContain('id="field-attachments"');
    expect(html).toContain("readonly");
    expect(html).toContain('<fieldset class="field table-field" disabled');
  });

  it("renders an empty child-table row when a child doctype has no editable fields", () => {
    const Sealed = defineDocType({
      name: "Sealed",
      fields: [{ name: "code", type: "text", readOnly: true }]
    });
    const Box = defineDocType({
      name: "Box",
      fields: [{ name: "items", type: "table", tableOf: "Sealed" }]
    });
    const html = renderFormView(Box, resolveFormView(Box), {
      mode: "update",
      document: snapshot({ doctype: "Box", name: "BOX-1", data: { items: [{ code: "X" }] } }),
      canUpdate: true,
      tableDefinitions: { items: Sealed }
    });
    expect(html).toContain("__cf_frappe_row_index");
  });
});

describe("Desk document timeline", () => {
  it("renders a bare timeline without side panels or comment form", () => {
    const html = renderDocumentTimeline(timeline());
    expect(html).toContain("No events yet.");
    expect(html).not.toContain("Tags");
    expect(html).not.toContain("Followers");
    expect(html).not.toContain("Shares");
    expect(html).not.toContain("Assignments");
    expect(html).not.toContain("Add comment");
  });

  it("renders read-only panels when mutation is not allowed", () => {
    const html = renderDocumentTimeline(timeline([timelineEntry]), {
      tags: { tenantId: "tenant-a", doctype: "Task", name: "TASK-1", version: 4, docstatus: "draft", tags: ["urgent"] },
      followers: {
        tenantId: "tenant-a",
        doctype: "Task",
        name: "TASK-1",
        version: 4,
        docstatus: "draft",
        followers: ["watcher@example.com"]
      },
      shares: {
        tenantId: "tenant-a",
        doctype: "Task",
        name: "TASK-1",
        version: 4,
        grants: [{ userId: "peer@example.com", permissions: ["read", "update"] }],
        delegablePermissions: ["read"]
      },
      assignments: {
        tenantId: "tenant-a",
        doctype: "Task",
        name: "TASK-1",
        version: 4,
        docstatus: "draft",
        assignees: ["owner@example.com"]
      }
    });
    expect(html).toContain(">urgent</span>");
    expect(html).toContain("watcher@example.com");
    expect(html).toContain("peer@example.com");
    expect(html).toContain("owner@example.com");
    expect(html).toContain("Ship it");
    expect(html).not.toContain(">Remove</button>");
    expect(html).not.toContain(">Unassign</button>");
    expect(html).not.toContain(">Revoke</button>");
    expect(html).not.toContain(">Share</button>");
  });

  it("renders mutable panels with add/remove forms and follow states", () => {
    const html = renderDocumentTimeline(timeline([{ ...timelineEntry, changes: [] }]), {
      allowComment: true,
      allowAssign: true,
      allowTag: true,
      allowFollow: true,
      allowShare: true,
      actorId: "me@example.com",
      tags: { tenantId: "tenant-a", doctype: "Task", name: "TASK-1", version: 4, docstatus: "draft", tags: [] },
      followers: {
        tenantId: "tenant-a",
        doctype: "Task",
        name: "TASK-1",
        version: 4,
        docstatus: "draft",
        followers: ["me@example.com", "other@example.com"]
      },
      shares: {
        tenantId: "tenant-a",
        doctype: "Task",
        name: "TASK-1",
        version: 4,
        grants: [],
        delegablePermissions: ["read", "update", "share"]
      },
      assignments: {
        tenantId: "tenant-a",
        doctype: "Task",
        name: "TASK-1",
        version: 4,
        docstatus: "draft",
        assignees: []
      }
    });
    expect(html).toContain("No tags.");
    expect(html).toContain("No shares.");
    expect(html).toContain("No assignees.");
    expect(html).toContain(">Add tag</button>");
    expect(html).toContain(">Assign</button>");
    expect(html).toContain(">Share</button>");
    expect(html).toContain(">Unfollow</button>");
    expect(html).not.toContain(">Follow</button>");
    expect(html).toContain(">Add comment</button>");
  });

  it("offers a follow button when the actor is not following", () => {
    const html = renderDocumentTimeline(timeline(), {
      allowFollow: true,
      actorId: "me@example.com",
      followers: {
        tenantId: "tenant-a",
        doctype: "Task",
        name: "TASK-1",
        version: 4,
        docstatus: "draft",
        followers: []
      }
    });
    expect(html).toContain("No followers.");
    expect(html).toContain(">Follow</button>");
  });
});
