import {
  applyDocumentToKanbanColumns,
  defineKanban,
  initialKanbanColumnStates,
  kanbanCard,
  kanbanCardLimit,
  kanbanColumnValue,
  kanbanRunResult,
  planKanbanReadAccess,
  type DocumentSnapshot
} from "../../src";

const board = defineKanban({
  name: "Notes Board",
  doctype: "Note",
  columnField: "workflow_state",
  titleField: "title",
  columns: [
    { value: "Open", label: "Open", indicator: "blue" },
    { value: "Closed", label: "Closed", indicator: "green" }
  ]
});

describe("kanban policy", () => {
  it("uses configured card limits or the default limit", () => {
    expect(kanbanCardLimit(undefined)).toBe(50);
    expect(kanbanCardLimit(1)).toBe(1);
    expect(kanbanCardLimit(200)).toBe(200);
  });

  it("initializes immutable column states from board columns", () => {
    expect(initialKanbanColumnStates(board.columns!)).toEqual([
      {
        column: { value: "Open", label: "Open", indicator: "blue" },
        total: 0,
        cards: []
      },
      {
        column: { value: "Closed", label: "Closed", indicator: "green" },
        total: 0,
        cards: []
      }
    ]);
  });

  it("projects matching documents into bounded column card lists", () => {
    const start = initialKanbanColumnStates(board.columns!);
    const withFirst = applyDocumentToKanbanColumns(board, start, document("Open", "First Open"), 1);
    const withSecond = applyDocumentToKanbanColumns(board, withFirst, document("Open", "Second Open", "NOTE-002"), 1);
    const withClosed = applyDocumentToKanbanColumns(board, withSecond, document("Closed", "Closed Note", "NOTE-003"), 1);

    expect(kanbanRunResult(board, withClosed).columns).toEqual([
      {
        value: "Open",
        label: "Open",
        indicator: "blue",
        total: 2,
        hasMore: true,
        cards: [expect.objectContaining({ name: "NOTE-001", title: "First Open" })]
      },
      {
        value: "Closed",
        label: "Closed",
        indicator: "green",
        total: 1,
        hasMore: false,
        cards: [expect.objectContaining({ name: "NOTE-003", title: "Closed Note" })]
      }
    ]);
  });

  it("ignores documents whose column value is not defined on the board", () => {
    const start = initialKanbanColumnStates(board.columns!);
    const projected = applyDocumentToKanbanColumns(board, start, document("Blocked", "Blocked Note"), 2);

    expect(projected).toBe(start);
  });

  it("normalizes column values from scalar data only", () => {
    expect(kanbanColumnValue("Open")).toBe("Open");
    expect(kanbanColumnValue(7)).toBe("7");
    expect(kanbanColumnValue(false)).toBe("false");
    expect(kanbanColumnValue(undefined)).toBe("");
    expect(kanbanColumnValue(null)).toBe("");
    expect(kanbanColumnValue({ nested: true })).toBe("");
  });

  it("projects card snapshots with scalar title fallback", () => {
    expect(kanbanCard(board, document("Open", "Visible Note"))).toMatchObject({
      name: "NOTE-001",
      title: "Visible Note",
      doctype: "Note",
      docstatus: "draft",
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: { workflow_state: "Open", title: "Visible Note" }
    });
    expect(kanbanCard(board, document("Open", { nested: true }))).toMatchObject({
      name: "NOTE-001",
      title: "NOTE-001"
    });
  });

  it("falls back to column values as labels when labels are omitted", () => {
    const unlabeled = defineKanban({
      name: "Simple Board",
      doctype: "Note",
      columnField: "workflow_state",
      columns: [{ value: "Open" }]
    });
    const states = applyDocumentToKanbanColumns(
      unlabeled,
      initialKanbanColumnStates(unlabeled.columns!),
      document("Open", "Open Note"),
      10
    );

    expect(kanbanRunResult(unlabeled, states).columns).toEqual([
      {
        value: "Open",
        label: "Open",
        total: 1,
        hasMore: false,
        cards: [expect.objectContaining({ title: "NOTE-001" })]
      }
    ]);
  });

  it("plans kanban read access from board roles and DocType readability", () => {
    const restricted = defineKanban({
      ...board,
      roles: ["Board Manager"]
    });

    expect(
      planKanbanReadAccess({
        actor: { id: "manager", roles: ["Board Manager"] },
        board: restricted,
        doctypeReadable: true
      })
    ).toEqual({ status: "allow" });
    expect(
      planKanbanReadAccess({
        actor: { id: "manager", roles: ["Board Manager"] },
        board: restricted,
        doctypeReadable: false
      })
    ).toEqual({ status: "deny", message: "Actor 'manager' cannot read kanban 'Notes Board'" });
    expect(
      planKanbanReadAccess({
        actor: { id: "guest", roles: ["Guest"] },
        board: restricted,
        doctypeReadable: true
      })
    ).toEqual({ status: "deny", message: "Actor 'guest' cannot read kanban 'Notes Board'" });
  });
});

function document(workflowState: unknown, title: unknown, name = "NOTE-001"): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Note",
    name,
    version: 1,
    docstatus: "draft",
    data: {
      workflow_state: workflowState,
      title
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  } as DocumentSnapshot;
}
