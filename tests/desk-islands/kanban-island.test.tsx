/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { KanbanMoveEventDetail } from "../../src/adapters/desk/islands-src/events.js";
import type { KanbanIslandIo, KanbanMoveOutcome } from "../../src/adapters/desk/islands-src/kanban-io.js";
import { KanbanIsland } from "../../src/adapters/desk/islands-src/islands/kanban-island.js";
import type {
  IslandKanbanBoard,
  KanbanMoveRules
} from "../../src/adapters/desk/islands-src/kanban-logic.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseBoard: IslandKanbanBoard = {
  name: "Case Board",
  doctype: "Return Request",
  columnField: "case_state",
  columns: [
    {
      value: "Draft",
      label: "Draft",
      total: 1,
      hasMore: false,
      cards: [
        {
          name: "RET-1",
          title: "Return one",
          doctype: "Return Request",
          docstatus: "draft",
          version: 3,
          updatedAt: "2026-08-01T00:00:00.000Z",
          priority: "High"
        }
      ]
    },
    { value: "Submitted", label: "Submitted", total: 0, hasMore: true, cards: [] },
    { value: "Closed", label: "Closed", total: 0, hasMore: false, cards: [] }
  ]
};

const workflowRules: KanbanMoveRules = {
  kind: "workflow",
  workflow: "case",
  transitions: [{ action: "submit", from: "Draft", to: "Submitted" }]
};

interface IoStub extends KanbanIslandIo {
  readonly loadBoard: ReturnType<typeof vi.fn<() => Promise<IslandKanbanBoard>>>;
  readonly loadMoveRules: ReturnType<typeof vi.fn<(field: string) => Promise<KanbanMoveRules>>>;
  readonly postMove: ReturnType<
    typeof vi.fn<(url: string, body: Readonly<Record<string, string>>) => Promise<KanbanMoveOutcome>>
  >;
}

function stubIo(overrides: Partial<IoStub> = {}): IoStub {
  return {
    loadBoard: vi.fn(async () => baseBoard),
    loadMoveRules: vi.fn(async () => workflowRules),
    postMove: vi.fn(async () => ({ ok: true, message: "" })),
    ...overrides
  } as IoStub;
}

let roots: Root[] = [];

async function renderIsland(
  io: KanbanIslandIo,
  hooks: { onReady?: () => void; emitMove?: (detail: KanbanMoveEventDetail) => void } = {}
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <KanbanIsland io={io} onReady={hooks.onReady ?? vi.fn()} emitMove={hooks.emitMove ?? vi.fn()} />
    );
  });
  return container;
}

function cardElement(container: HTMLElement, name = "RET-1"): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-card-name="${name}"]`);
  if (element === null) {
    throw new Error(`card ${name} not rendered`);
  }
  return element;
}

async function pressKey(element: HTMLElement, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function announcementText(container: HTMLElement): string {
  return container.querySelector(".kanban-live")?.textContent ?? "";
}

interface FakeDataTransfer {
  readonly store: Record<string, string>;
  types: string[];
  effectAllowed: string;
  dropEffect: string;
  setData(type: string, value: string): void;
  getData(type: string): string;
}

function fakeDataTransfer(): FakeDataTransfer {
  return {
    store: {},
    types: [],
    effectAllowed: "",
    dropEffect: "",
    setData(type, value) {
      this.store[type] = value;
      this.types = Object.keys(this.store);
    },
    getData(type) {
      return this.store[type] ?? "";
    }
  };
}

async function dispatchDragEvent(
  element: HTMLElement,
  type: string,
  dataTransfer: FakeDataTransfer
): Promise<void> {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  await act(async () => {
    element.dispatchEvent(event);
  });
}

describe("KanbanIsland", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    roots = [];
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots) {
        root.unmount();
      }
    });
  });

  it("renders columns and cards from the run endpoint and signals readiness once", async () => {
    const onReady = vi.fn();
    const io = stubIo();
    const container = await renderIsland(io, { onReady });

    expect(io.loadMoveRules).toHaveBeenCalledWith("case_state");
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll(".kanban-column")).toHaveLength(3);
    expect(cardElement(container).getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain("Return one");
    expect(container.textContent).toContain("High");
    expect(container.textContent).toContain("More cards hidden by board limit.");
    expect(container.textContent).toContain("No cards.");

    await pressKey(cardElement(container), "Enter");
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("keeps the SSR fallback (renders nothing) when bootstrap data fails to load", async () => {
    const onReady = vi.fn();
    const io = stubIo({
      loadBoard: vi.fn(async () => {
        throw new Error("denied");
      })
    });
    const container = await renderIsland(io, { onReady });

    expect(container.querySelectorAll(".kanban-column")).toHaveLength(0);
    expect(onReady).not.toHaveBeenCalled();
  });

  it("moves a card with the keyboard through the workflow transition endpoint", async () => {
    const emitMove = vi.fn();
    const fresh: IslandKanbanBoard = {
      ...baseBoard,
      columns: [
        { ...baseBoard.columns[0]!, total: 0, cards: [] },
        { ...baseBoard.columns[1]!, total: 1, cards: [{ ...baseBoard.columns[0]!.cards[0]!, version: 4 }] },
        baseBoard.columns[2]!
      ]
    };
    const io = stubIo();
    io.loadBoard.mockResolvedValueOnce(baseBoard).mockResolvedValue(fresh);
    const container = await renderIsland(io, { emitMove });
    const card = cardElement(container);

    await pressKey(card, "Enter");
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(announcementText(container)).toContain("Picked up Return one from Draft.");

    await pressKey(card, "ArrowRight");
    expect(announcementText(container)).toContain("Return one targeting Submitted.");
    expect(container.querySelectorAll(".kanban-column-target")).toHaveLength(1);
    expect(container.textContent).toContain("Drop target: Submitted");

    await pressKey(card, "Enter");
    expect(io.postMove).toHaveBeenCalledWith("/desk/Return%20Request/RET-1/workflows/case/transition/submit", {
      expectedVersion: "3"
    });
    expect(emitMove).toHaveBeenCalledWith({
      board: "Case Board",
      doctype: "Return Request",
      card: "RET-1",
      from: "Draft",
      to: "Submitted"
    });
    expect(announcementText(container)).toBe("Moved Return one to Submitted.");
    expect(io.loadBoard).toHaveBeenCalledTimes(2);
    expect(cardElement(container).getAttribute("data-card-column")).toBe("Submitted");
    expect(container.textContent).toContain("v4");
  });

  it("cycles the keyboard target left with wrap-around and cancels with Escape", async () => {
    const io = stubIo();
    const container = await renderIsland(io);
    const card = cardElement(container);

    await pressKey(card, " ");
    await pressKey(card, "ArrowLeft");
    expect(announcementText(container)).toContain("Return one targeting Closed.");

    await pressKey(card, "Escape");
    expect(announcementText(container)).toBe("Cancelled moving Return one.");
    expect(card.getAttribute("aria-pressed")).toBe("false");
    expect(io.postMove).not.toHaveBeenCalled();
  });

  it("treats dropping a grabbed card on its own column as a cancel", async () => {
    const io = stubIo();
    const container = await renderIsland(io);
    const card = cardElement(container);

    await pressKey(card, "Enter");
    await pressKey(card, "Enter");

    expect(announcementText(container)).toBe("Cancelled moving Return one.");
    expect(io.postMove).not.toHaveBeenCalled();
  });

  it("ignores arrows and other keys when the card is not grabbed", async () => {
    const io = stubIo();
    const container = await renderIsland(io);
    const card = cardElement(container);

    await pressKey(card, "ArrowRight");
    await pressKey(card, "Escape");
    expect(announcementText(container)).toBe("");

    await pressKey(card, "Enter");
    await pressKey(card, "a");
    expect(announcementText(container)).toContain("Picked up Return one from Draft.");
  });

  it("announces a blocked move when no workflow transition matches, without posting", async () => {
    const io = stubIo();
    const container = await renderIsland(io);
    const card = cardElement(container);

    await pressKey(card, "Enter");
    await pressKey(card, "ArrowLeft");
    await pressKey(card, "Enter");

    expect(io.postMove).not.toHaveBeenCalled();
    expect(announcementText(container)).toBe(
      "Could not move Return one: No workflow transition from Draft to Closed."
    );
    expect(cardElement(container).getAttribute("data-card-column")).toBe("Draft");
  });

  it("rolls back the optimistic move and announces the failure when the server rejects it", async () => {
    const io = stubIo({
      postMove: vi.fn(async () => ({ ok: false, message: "the server rejected the move (HTTP 409)." }))
    });
    const container = await renderIsland(io);
    const card = cardElement(container);

    await pressKey(card, "Enter");
    await pressKey(card, "ArrowRight");
    await pressKey(card, "Enter");

    expect(io.postMove).toHaveBeenCalledTimes(1);
    expect(cardElement(container).getAttribute("data-card-column")).toBe("Draft");
    expect(announcementText(container)).toBe(
      "Could not move Return one: the server rejected the move (HTTP 409)."
    );
    expect(io.loadBoard).toHaveBeenCalledTimes(1);
  });

  it("keeps the optimistic state when the post succeeds but the reconcile fetch fails", async () => {
    const io = stubIo();
    io.loadBoard.mockResolvedValueOnce(baseBoard).mockRejectedValue(new Error("offline"));
    const container = await renderIsland(io);
    const card = cardElement(container);

    await pressKey(card, "Enter");
    await pressKey(card, "ArrowRight");
    await pressKey(card, "Enter");

    expect(announcementText(container)).toBe("Moved Return one to Submitted.");
    expect(cardElement(container).getAttribute("data-card-column")).toBe("Submitted");
  });

  it("supports pointer drag-and-drop between columns", async () => {
    const io = stubIo();
    const container = await renderIsland(io);
    const card = cardElement(container);
    const transfer = fakeDataTransfer();

    await dispatchDragEvent(card, "dragstart", transfer);
    expect(transfer.getData("application/x-cf-frappe-kanban")).toBe(
      JSON.stringify({ card: "RET-1", from: "Draft" })
    );
    expect(transfer.effectAllowed).toBe("move");

    const submitted = container.querySelector<HTMLElement>('[data-column-value="Submitted"]');
    expect(submitted).not.toBeNull();
    await dispatchDragEvent(submitted!, "dragover", transfer);
    expect(submitted!.className).toContain("kanban-column-target");

    await dispatchDragEvent(submitted!, "dragleave", transfer);
    expect(submitted!.className).not.toContain("kanban-column-target");

    await dispatchDragEvent(submitted!, "dragover", transfer);
    await dispatchDragEvent(submitted!, "drop", transfer);
    expect(io.postMove).toHaveBeenCalledWith("/desk/Return%20Request/RET-1/workflows/case/transition/submit", {
      expectedVersion: "3"
    });
  });

  it("ignores foreign, empty, and malformed drag payloads", async () => {
    const io = stubIo();
    const container = await renderIsland(io);
    const submitted = container.querySelector<HTMLElement>('[data-column-value="Submitted"]')!;

    const foreign = fakeDataTransfer();
    foreign.setData("text/plain", "hello");
    await dispatchDragEvent(submitted, "dragover", foreign);
    expect(submitted.className).not.toContain("kanban-column-target");
    await dispatchDragEvent(submitted, "drop", foreign);

    const malformed = fakeDataTransfer();
    malformed.setData("application/x-cf-frappe-kanban", "{not json");
    await dispatchDragEvent(submitted, "drop", malformed);

    const wrongShape = fakeDataTransfer();
    wrongShape.setData("application/x-cf-frappe-kanban", JSON.stringify({ card: 1, from: "Draft" }));
    await dispatchDragEvent(submitted, "drop", wrongShape);

    expect(io.postMove).not.toHaveBeenCalled();
  });

  it("ignores a drop whose card is no longer in the source column", async () => {
    const io = stubIo();
    const container = await renderIsland(io);
    const submitted = container.querySelector<HTMLElement>('[data-column-value="Submitted"]')!;

    const transfer = fakeDataTransfer();
    transfer.setData("application/x-cf-frappe-kanban", JSON.stringify({ card: "gone", from: "Draft" }));
    await dispatchDragEvent(submitted, "dragover", transfer);
    await dispatchDragEvent(submitted, "drop", transfer);

    expect(io.postMove).not.toHaveBeenCalled();
  });
});
