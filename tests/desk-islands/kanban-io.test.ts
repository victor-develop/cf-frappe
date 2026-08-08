import { createKanbanIslandIo, type FetchLike } from "../../src/adapters/desk/islands-src/kanban-io.js";

const config = {
  runUrl: "/api/kanban/Case%20Board/run",
  doctypeMetaUrl: "/api/meta/doctypes/Return%20Request"
};

const runPayload = {
  data: {
    board: { name: "Case Board", doctype: "Return Request", columnField: "case_state" },
    columns: []
  }
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("kanban island io", () => {
  it("loads the board from the run endpoint with same-origin credentials", async () => {
    const calls: { input: string; init: RequestInit | undefined }[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(runPayload);
    };

    const board = await createKanbanIslandIo(config, fetchImpl).loadBoard();

    expect(board.name).toBe("Case Board");
    expect(calls).toEqual([{ input: config.runUrl, init: { credentials: "same-origin" } }]);
  });

  it("throws on a failed board load", async () => {
    const io = createKanbanIslandIo(config, async () => jsonResponse({}, 403));

    await expect(io.loadBoard()).rejects.toThrow("GET /api/kanban/Case%20Board/run failed (HTTP 403)");
  });

  it("derives move rules from the doctype meta endpoint", async () => {
    const io = createKanbanIslandIo(config, async (input) =>
      jsonResponse(
        input === config.doctypeMetaUrl
          ? {
              data: {
                workflows: [
                  { name: "case", stateField: "case_state", transitions: [{ action: "submit", from: "A", to: "B" }] }
                ]
              }
            }
          : runPayload
      )
    );

    await expect(io.loadMoveRules("case_state")).resolves.toEqual({
      kind: "workflow",
      workflow: "case",
      transitions: [{ action: "submit", from: "A", to: "B" }]
    });
  });

  it("posts moves form-encoded and reports success", async () => {
    const calls: { input: string; init: RequestInit | undefined }[] = [];
    const io = createKanbanIslandIo(config, async (input, init) => {
      calls.push({ input, init });
      return new Response("<html></html>", { status: 200 });
    });

    const outcome = await io.postMove("/desk/Return%20Request/RET-1/workflows/case/transition/submit", {
      expectedVersion: "3"
    });

    expect(outcome).toEqual({ ok: true, message: "" });
    expect(calls[0]?.input).toBe("/desk/Return%20Request/RET-1/workflows/case/transition/submit");
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: "expectedVersion=3"
    });
  });

  it("reports a rejected move with the HTTP status", async () => {
    const io = createKanbanIslandIo(config, async () => new Response("conflict", { status: 409 }));

    await expect(io.postMove("/desk/Return%20Request/RET-1", { case_state: "Closed" })).resolves.toEqual({
      ok: false,
      message: "the server rejected the move (HTTP 409)."
    });
  });
});
