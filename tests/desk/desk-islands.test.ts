import {
  createDeskApp,
  createRegistry,
  defineKanban,
  deterministicIds,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  KanbanService,
  QueryService
} from "../../src";
import {
  DESK_ISLAND_ASSETS,
  DESK_ISLAND_ENTRIES,
  DESK_ISLAND_LOADER_ASSET
} from "../../src/adapters/desk/islands-bundle.generated";
import { IslandMount, islandLoaderScriptPath } from "../../src/adapters/desk/ui/islands";
import { renderFragment } from "../../src/adapters/desk/ui/primitives";
import { data, noteDocType, now, owner } from "../helpers";

function makeApp() {
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
        columns: [
          { value: "Open", label: "Open" },
          { value: "Closed", label: "Closed" }
        ]
      })
    ]
  });
  const store = new InMemoryDocumentStore();
  const documents = new DocumentService({
    registry,
    store,
    clock: fixedClock(now),
    ids: deterministicIds(["island-1"])
  });
  const queries = new QueryService({ registry, projections: store });
  const kanbans = new KanbanService({ registry, queries });
  const app = createDeskApp({ registry, documents, queries, kanbans, actor: () => owner });
  return { app, documents };
}

describe("IslandMount", () => {
  it("renders escaped bootstrap attributes and the SSR fallback wrapper", () => {
    const html = renderFragment(
      IslandMount({
        name: "kanban",
        props: { board: 'A"B', "run-url": "/api/kanban/A%22B/run" },
        children: "fallback"
      }) as { toString(): string }
    );

    expect(html).toContain('data-cf-frappe-island="kanban"');
    expect(html).toContain('data-island-board="A&quot;B"');
    expect(html).toContain('data-island-run-url="/api/kanban/A%22B/run"');
    expect(html).toContain('<div data-island-fallback="">fallback</div>');
  });

  it("rejects non-kebab-case prop keys", () => {
    expect(() =>
      renderFragment(
        IslandMount({ name: "kanban", props: { RunUrl: "/api/x" } }) as { toString(): string }
      )
    ).toThrow(/kebab-case/);
  });

  it("rejects embedded data blobs so islands can only bootstrap from IDs and URLs", () => {
    expect(() =>
      renderFragment(
        IslandMount({ name: "kanban", props: { board: '{"cards":[]}' } }) as { toString(): string }
      )
    ).toThrow(/IDs and permission-aware API URLs/);
    expect(() =>
      renderFragment(
        IslandMount({ name: "kanban", props: { board: `[${"x".repeat(4)}]` } }) as { toString(): string }
      )
    ).toThrow(/IDs and permission-aware API URLs/);
    expect(() =>
      renderFragment(
        IslandMount({ name: "kanban", props: { board: "x".repeat(1025) } }) as { toString(): string }
      )
    ).toThrow(/IDs and permission-aware API URLs/);
  });
});

describe("Desk island infrastructure", () => {
  it("serves hashed island assets with immutable caching", async () => {
    const { app } = makeApp();

    const loader = await app.request(islandLoaderScriptPath());
    expect(loader.status).toBe(200);
    expect(loader.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    expect(loader.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    await expect(loader.text()).resolves.toBe(DESK_ISLAND_ASSETS[DESK_ISLAND_LOADER_ASSET]);

    const kanbanEntry = await app.request(`/desk/islands/${DESK_ISLAND_ENTRIES.kanban}`);
    expect(kanbanEntry.status).toBe(200);
  });

  it("rejects unknown island assets and prototype-key probes", async () => {
    const { app } = makeApp();

    expect((await app.request("/desk/islands/not-a-real-file.js")).status).toBe(404);
    expect((await app.request("/desk/islands/toString")).status).toBe(404);
    expect((await app.request("/desk/islands/__proto__")).status).toBe(404);
  });

  it("keeps react and react-dom inside a shared vendor chunk that island entries import", () => {
    const entryFile = DESK_ISLAND_ENTRIES.kanban;
    const entrySource = DESK_ISLAND_ASSETS[entryFile] ?? "";
    const vendorChunks = Object.keys(DESK_ISLAND_ASSETS).filter((file) => file.startsWith("vendor-chunk-"));

    expect(vendorChunks.length).toBeGreaterThan(0);
    expect(vendorChunks.some((file) => entrySource.includes(file))).toBe(true);
    // React's production runtime lives in the shared chunk, not the island entry.
    const vendorSource = vendorChunks.map((file) => DESK_ISLAND_ASSETS[file]).join("");
    expect(vendorSource).toContain("react-dom");
    expect(entrySource).not.toContain("react.production");
  });

  it("emits the island mount and loader ONLY on the kanban board page", async () => {
    const { app, documents } = makeApp();
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Island Note", workflow_state: "Open", count: 1 })
    });

    const board = await app.request("/desk/kanbans/Notes%20Board");
    expect(board.status).toBe(200);
    const boardHtml = await board.text();
    expect(boardHtml).toContain('data-cf-frappe-island="kanban"');
    expect(boardHtml).toContain('data-island-run-url="/api/kanban/Notes%20Board/run"');
    expect(boardHtml).toContain('data-island-doctype-meta-url="/api/meta/doctypes/Note"');
    expect(boardHtml).toContain(`<script type="module" src="${islandLoaderScriptPath()}"></script>`);
    // No-JS fallback stays server-rendered inside the mount.
    expect(boardHtml).toContain("data-island-fallback");
    expect(boardHtml).toContain("kanban-column");
    expect(boardHtml).toContain("Island Note");
  });

  it("ships zero island or React bytes on non-island pages (bundle isolation)", async () => {
    const { app, documents } = makeApp();
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Island Note", workflow_state: "Open", count: 1 })
    });

    for (const path of [
      "/desk",
      "/desk/kanbans",
      "/desk/Note",
      "/desk/Note/Island%20Note",
      "/desk/Note/new"
    ]) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html, `${path} must not reference island assets`).not.toContain("/desk/islands/");
      expect(html, `${path} must not declare island mounts`).not.toContain("data-cf-frappe-island");
      expect(html, `${path} must not load React`).not.toMatch(/<script[^>]+react/i);
    }
  });
});
