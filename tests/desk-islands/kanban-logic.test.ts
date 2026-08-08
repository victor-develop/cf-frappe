import {
  adjacentColumnValue,
  applyOptimisticMove,
  boardFromRunPayload,
  cancelAnnouncement,
  columnLabel,
  dropAnnouncement,
  failureAnnouncement,
  grabAnnouncement,
  isSameOriginPath,
  moveRulesFromDoctypeMeta,
  parseKanbanMountConfig,
  planKanbanMove,
  targetAnnouncement,
  type IslandKanbanBoard,
  type IslandKanbanCard
} from "../../src/adapters/desk/islands-src/kanban-logic.js";

function attributeSource(attributes: Record<string, string>) {
  return {
    getAttribute: (name: string) => attributes[name] ?? null
  };
}

const card: IslandKanbanCard = {
  name: "RET-1",
  title: "Return one",
  doctype: "Return Request",
  docstatus: "draft",
  version: 3,
  updatedAt: "2026-08-01T00:00:00.000Z"
};

const board: IslandKanbanBoard = {
  name: "Case Board",
  doctype: "Return Request",
  columnField: "case_state",
  columns: [
    { value: "Draft", label: "Draft", total: 1, hasMore: false, cards: [card] },
    { value: "Submitted", label: "Submitted", total: 0, hasMore: false, cards: [] },
    { value: "Closed", label: "Done", total: 0, hasMore: false, cards: [] }
  ]
};

describe("kanban island mount config", () => {
  it("parses same-origin bootstrap URLs", () => {
    const config = parseKanbanMountConfig(
      attributeSource({
        "data-island-run-url": "/api/kanban/Case%20Board/run",
        "data-island-doctype-meta-url": "/api/meta/doctypes/Return%20Request"
      })
    );

    expect(config).toEqual({
      runUrl: "/api/kanban/Case%20Board/run",
      doctypeMetaUrl: "/api/meta/doctypes/Return%20Request"
    });
  });

  it.each(["", "https://evil.example/run", "//evil.example/run", "/api\\evil", "relative/path"])(
    "rejects unsafe run URL %j",
    (runUrl) => {
      expect(() =>
        parseKanbanMountConfig(
          attributeSource({
            "data-island-run-url": runUrl,
            "data-island-doctype-meta-url": "/api/meta/doctypes/Return%20Request"
          })
        )
      ).toThrow(/same-origin absolute path/);
    }
  );

  it("rejects a missing doctype meta URL", () => {
    expect(() =>
      parseKanbanMountConfig(attributeSource({ "data-island-run-url": "/api/kanban/x/run" }))
    ).toThrow(/data-island-doctype-meta-url/);
  });

  it("classifies same-origin paths", () => {
    expect(isSameOriginPath("/api/x")).toBe(true);
    expect(isSameOriginPath("//host/x")).toBe(false);
    expect(isSameOriginPath("api/x")).toBe(false);
  });
});

describe("kanban island run payload decoding", () => {
  it("decodes a run result envelope", () => {
    const decoded = boardFromRunPayload({
      data: {
        board: { name: "Case Board", doctype: "Return Request", columnField: "case_state" },
        columns: [
          {
            value: "Draft",
            label: "Drafts",
            total: 2,
            hasMore: true,
            cards: [
              {
                name: "RET-1",
                title: "Return one",
                doctype: "Return Request",
                docstatus: "draft",
                version: 3,
                updatedAt: "2026-08-01T00:00:00.000Z",
                data: { priority: "High" }
              }
            ]
          }
        ]
      }
    });

    expect(decoded.name).toBe("Case Board");
    expect(decoded.columns).toHaveLength(1);
    expect(decoded.columns[0]).toMatchObject({ value: "Draft", label: "Drafts", total: 2, hasMore: true });
    expect(decoded.columns[0]?.cards[0]).toEqual({
      name: "RET-1",
      title: "Return one",
      doctype: "Return Request",
      docstatus: "draft",
      version: 3,
      updatedAt: "2026-08-01T00:00:00.000Z",
      priority: "High"
    });
  });

  it("defaults optional column and card fields", () => {
    const decoded = boardFromRunPayload({
      board: { name: "B", doctype: "Note", columnField: "state" },
      columns: [
        {
          value: "Open",
          cards: [{ name: "N-1", title: "Note", doctype: "Note" }]
        }
      ]
    });

    expect(decoded.columns[0]).toMatchObject({ label: "Open", total: 0, hasMore: false });
    expect(decoded.columns[0]?.cards[0]).toMatchObject({ docstatus: "", version: 0, updatedAt: "" });
    expect(decoded.columns[0]?.cards[0]?.priority).toBeUndefined();
  });

  it.each([
    [null, "payload"],
    [{ data: { board: null, columns: [] } }, "board"],
    [{ data: { board: { name: "B", doctype: "N", columnField: "s" }, columns: {} } }, "columns"],
    [{ data: { board: { name: "", doctype: "N", columnField: "s" }, columns: [] } }, "board.name"],
    [
      { data: { board: { name: "B", doctype: "N", columnField: "s" }, columns: [{ value: "", cards: [] }] } },
      "column.value"
    ],
    [
      { data: { board: { name: "B", doctype: "N", columnField: "s" }, columns: [{ value: "Open", cards: [null] }] } },
      "card"
    ]
  ])("rejects malformed payload %#", (payload, label) => {
    expect(() => boardFromRunPayload(payload)).toThrow(`invalid '${label}'`);
  });
});

describe("kanban island move rules", () => {
  const meta = {
    data: {
      name: "Return Request",
      workflows: [
        { name: "logistics", stateField: "logistics_state", transitions: [] },
        {
          name: "case",
          stateField: "case_state",
          transitions: [
            { action: "submit", from: "Draft", to: "Submitted" },
            { action: "broken", from: 1, to: "Submitted" },
            "junk"
          ]
        }
      ]
    }
  };

  it("selects the workflow owning the column field and drops malformed transitions", () => {
    expect(moveRulesFromDoctypeMeta(meta, "case_state")).toEqual({
      kind: "workflow",
      workflow: "case",
      transitions: [{ action: "submit", from: "Draft", to: "Submitted" }]
    });
  });

  it("falls back to a plain field update when no workflow owns the field", () => {
    expect(moveRulesFromDoctypeMeta(meta, "priority")).toEqual({ kind: "field" });
    expect(moveRulesFromDoctypeMeta({ data: {} }, "case_state")).toEqual({ kind: "field" });
    expect(moveRulesFromDoctypeMeta({ data: { workflows: [null, { stateField: "case_state" }] } }, "case_state")).toEqual({
      kind: "field"
    });
  });

  it("treats a workflow without a transitions array as having none", () => {
    expect(
      moveRulesFromDoctypeMeta({ data: { workflows: [{ name: "case", stateField: "case_state" }] } }, "case_state")
    ).toEqual({ kind: "workflow", workflow: "case", transitions: [] });
  });
});

describe("kanban island move planning", () => {
  it("plans a workflow transition POST against the Desk form endpoint", () => {
    const plan = planKanbanMove({
      board,
      rules: { kind: "workflow", workflow: "case", transitions: [{ action: "submit", from: "Draft", to: "Submitted" }] },
      card,
      from: "Draft",
      to: "Submitted"
    });

    expect(plan).toEqual({
      ok: true,
      url: "/desk/Return%20Request/RET-1/workflows/case/transition/submit",
      body: { expectedVersion: "3" }
    });
  });

  it("plans a field update POST when no workflow owns the column", () => {
    const plan = planKanbanMove({ board, rules: { kind: "field" }, card, from: "Draft", to: "Closed" });

    expect(plan).toEqual({
      ok: true,
      url: "/desk/Return%20Request/RET-1",
      body: { case_state: "Closed", expectedVersion: "3" }
    });
  });

  it("rejects a move to the same column", () => {
    const plan = planKanbanMove({ board, rules: { kind: "field" }, card, from: "Draft", to: "Draft" });

    expect(plan).toEqual({ ok: false, message: "Return one is already in Draft." });
  });

  it("rejects a move with no matching workflow transition, using column labels", () => {
    const plan = planKanbanMove({
      board,
      rules: { kind: "workflow", workflow: "case", transitions: [{ action: "submit", from: "Draft", to: "Submitted" }] },
      card,
      from: "Draft",
      to: "Closed"
    });

    expect(plan).toEqual({ ok: false, message: "No workflow transition from Draft to Done." });
  });
});

describe("kanban island optimistic moves", () => {
  it("moves the card and its count between columns", () => {
    const next = applyOptimisticMove(board, "RET-1", "Draft", "Submitted");

    expect(next.columns[0]).toMatchObject({ total: 0, cards: [] });
    expect(next.columns[1]).toMatchObject({ total: 1 });
    expect(next.columns[1]?.cards[0]?.name).toBe("RET-1");
    expect(next.columns[2]).toBe(board.columns[2]);
  });

  it("returns the board unchanged for unknown cards, columns, or same-column moves", () => {
    expect(applyOptimisticMove(board, "missing", "Draft", "Submitted")).toBe(board);
    expect(applyOptimisticMove(board, "RET-1", "Nope", "Submitted")).toBe(board);
    expect(applyOptimisticMove(board, "RET-1", "Draft", "Draft")).toBe(board);
  });

  it("never drives a column total negative", () => {
    const zeroed: IslandKanbanBoard = {
      ...board,
      columns: [{ value: "Draft", label: "Draft", total: 0, hasMore: false, cards: [card] }, ...board.columns.slice(1)]
    };

    expect(applyOptimisticMove(zeroed, "RET-1", "Draft", "Submitted").columns[0]?.total).toBe(0);
  });
});

describe("kanban island keyboard targeting", () => {
  it("cycles forward and backward with wrap-around", () => {
    expect(adjacentColumnValue(board, "Draft", 1)).toBe("Submitted");
    expect(adjacentColumnValue(board, "Draft", -1)).toBe("Closed");
    expect(adjacentColumnValue(board, "Closed", 1)).toBe("Draft");
  });

  it("starts from the first column for unknown values and handles empty boards", () => {
    expect(adjacentColumnValue(board, "Nope", 1)).toBe("Submitted");
    expect(adjacentColumnValue({ ...board, columns: [] }, "Draft", 1)).toBe("Draft");
  });
});

describe("kanban island announcements", () => {
  it("labels columns with fallback to the raw value", () => {
    expect(columnLabel(board, "Closed")).toBe("Done");
    expect(columnLabel(board, "Unknown")).toBe("Unknown");
  });

  it("describes each interaction step", () => {
    expect(grabAnnouncement(board, card, "Draft")).toContain("Picked up Return one from Draft.");
    expect(targetAnnouncement(board, card, "Submitted")).toBe("Return one targeting Submitted. Press Enter to drop.");
    expect(dropAnnouncement(board, card, "Closed")).toBe("Moved Return one to Done.");
    expect(cancelAnnouncement(card)).toBe("Cancelled moving Return one.");
    expect(failureAnnouncement(card, "boom")).toBe("Could not move Return one: boom");
  });
});
