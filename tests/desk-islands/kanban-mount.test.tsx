/** @jsxImportSource react */
import { act } from "react";
import { KANBAN_MOVE_EVENT, islandEvent } from "../../src/adapters/desk/islands-src/events.js";
import mountKanbanIsland from "../../src/adapters/desk/islands-src/islands/kanban.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const runPayload = {
  data: {
    board: { name: "Case Board", doctype: "Return Request", columnField: "case_state" },
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
            data: {}
          }
        ]
      },
      { value: "Submitted", label: "Submitted", total: 0, hasMore: false, cards: [] }
    ]
  }
};

const metaPayload = { data: { workflows: [] } };

function mountElementFixture(): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-cf-frappe-island", "kanban");
  element.setAttribute("data-island-run-url", "/api/kanban/Case%20Board/run");
  element.setAttribute("data-island-doctype-meta-url", "/api/meta/doctypes/Return%20Request");
  const fallback = document.createElement("div");
  fallback.setAttribute("data-island-fallback", "");
  fallback.textContent = "server board";
  element.appendChild(fallback);
  document.body.appendChild(element);
  return element;
}

describe("kanban island mount entry", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts a client-only React root, hides the fallback, and marks the island ready", async () => {
    const element = mountElementFixture();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      new Response(JSON.stringify(String(input).includes("/api/meta/") ? metaPayload : runPayload), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      mountKanbanIsland(element);
    });
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledWith("/api/kanban/Case%20Board/run", expect.anything());
    expect(fetchMock).toHaveBeenCalledWith("/api/meta/doctypes/Return%20Request", expect.anything());
    expect(element.hasAttribute("data-island-ready")).toBe(true);
    const fallback = element.querySelector<HTMLElement>("[data-island-fallback]");
    expect(fallback?.hidden).toBe(true);
    expect(element.querySelector(".kanban-island-host .kanban-column")).not.toBeNull();

    vi.unstubAllGlobals();
  });

  it("marks the island ready even when the mount has no SSR fallback child", async () => {
    const element = mountElementFixture();
    element.querySelector("[data-island-fallback]")?.remove();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        new Response(JSON.stringify(String(input).includes("/api/meta/") ? metaPayload : runPayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );

    await act(async () => {
      mountKanbanIsland(element);
    });
    await act(async () => {});

    expect(element.hasAttribute("data-island-ready")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("dispatches the typed move event on the mount element after a successful move", async () => {
    const element = mountElementFixture();
    const seen: unknown[] = [];
    element.addEventListener(KANBAN_MOVE_EVENT, (event) => {
      seen.push((event as CustomEvent).detail);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST") {
          return new Response("<html></html>", { status: 200 });
        }
        return new Response(JSON.stringify(url.includes("/api/meta/") ? metaPayload : runPayload), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    await act(async () => {
      mountKanbanIsland(element);
    });
    await act(async () => {});
    const grabButton = () =>
      element.querySelector<HTMLElement>('[data-card-name="RET-1"] button.kanban-card-move');
    expect(grabButton()).not.toBeNull();
    // With no workflow in the meta this board uses plain field updates, so
    // the neighbouring column is a valid keyboard drop target. Click grabs
    // (native Enter/Space on the button also arrive as clicks), the arrow
    // retargets, the second click drops.
    await act(async () => {
      grabButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      grabButton()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    });
    await act(async () => {
      grabButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(seen).toEqual([
      { board: "Case Board", doctype: "Return Request", card: "RET-1", from: "Draft", to: "Submitted" }
    ]);

    vi.unstubAllGlobals();
  });

  it("throws on unsafe bootstrap attributes before creating a root", () => {
    const element = mountElementFixture();
    element.setAttribute("data-island-run-url", "https://evil.example/run");

    expect(() => {
      mountKanbanIsland(element);
    }).toThrow(/same-origin absolute path/);
    expect(element.querySelector(".kanban-island-host")).toBeNull();
  });
});

describe("typed island events", () => {
  it("creates bubbling, composed CustomEvents that page code can observe", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const seen: unknown[] = [];
    document.body.addEventListener(KANBAN_MOVE_EVENT, (event) => {
      seen.push((event as CustomEvent).detail);
    });

    const detail = { board: "B", doctype: "D", card: "C", from: "A", to: "Z" };
    element.dispatchEvent(islandEvent(KANBAN_MOVE_EVENT, detail));

    expect(seen).toEqual([detail]);
  });
});
