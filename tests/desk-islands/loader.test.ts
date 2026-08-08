import {
  discoverIslandMounts,
  ISLAND_MOUNT_ATTRIBUTE,
  ISLAND_MOUNTED_ATTRIBUTE,
  loadIslands,
  type IslandModule
} from "../../src/adapters/desk/islands-src/loader.js";

function mountElement(name: string | undefined): HTMLElement {
  const element = document.createElement("div");
  if (name !== undefined) {
    element.setAttribute(ISLAND_MOUNT_ATTRIBUTE, name);
  }
  document.body.appendChild(element);
  return element;
}

describe("desk island loader", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("discovers island mounts in document order", () => {
    const first = mountElement("kanban");
    const second = mountElement("other");
    mountElement(undefined);

    expect(discoverIslandMounts(document)).toEqual([first, second]);
  });

  it("imports and mounts only islands declared in the manifest", async () => {
    const kanban = mountElement("kanban");
    mountElement("undeclared");
    mountElement("");
    const imported: string[] = [];
    const mountedOn: HTMLElement[] = [];

    const report = await loadIslands(document, { kanban: "kanban-abc.js" }, async (file) => {
      imported.push(file);
      return {
        default: (element) => {
          mountedOn.push(element);
        }
      };
    });

    expect(imported).toEqual(["kanban-abc.js"]);
    expect(mountedOn).toEqual([kanban]);
    expect(report).toEqual({ mounted: ["kanban"], skipped: ["undeclared", ""], failed: [] });
    expect(kanban.hasAttribute(ISLAND_MOUNTED_ATTRIBUTE)).toBe(true);
  });

  it("never imports a mount that is already claimed", async () => {
    const element = mountElement("kanban");
    element.setAttribute(ISLAND_MOUNTED_ATTRIBUTE, "");
    const importer = vi.fn<(file: string) => Promise<IslandModule>>();

    const report = await loadIslands(document, { kanban: "kanban-abc.js" }, importer);

    expect(importer).not.toHaveBeenCalled();
    expect(report).toEqual({ mounted: [], skipped: [], failed: [] });
  });

  it("records a failed island and releases the claim so the SSR fallback stays usable", async () => {
    const element = mountElement("kanban");

    const report = await loadIslands(document, { kanban: "kanban-abc.js" }, async () => {
      throw new Error("network");
    });

    expect(report).toEqual({ mounted: [], skipped: [], failed: ["kanban"] });
    expect(element.hasAttribute(ISLAND_MOUNTED_ATTRIBUTE)).toBe(false);
  });

  it("treats a module without a default mount export as a failure", async () => {
    mountElement("kanban");

    const report = await loadIslands(document, { kanban: "kanban-abc.js" }, async () => ({}));

    expect(report.failed).toEqual(["kanban"]);
  });

  it("skips a mount whose island attribute disappeared between discovery and load", async () => {
    const element = mountElement("kanban");
    const detachedRoot: Pick<ParentNode, "querySelectorAll"> = {
      querySelectorAll: (() => {
        element.removeAttribute(ISLAND_MOUNT_ATTRIBUTE);
        return [element] as unknown as ReturnType<ParentNode["querySelectorAll"]>;
      }) as ParentNode["querySelectorAll"]
    };
    const importer = vi.fn<(file: string) => Promise<IslandModule>>();

    const report = await loadIslands(detachedRoot as ParentNode, { kanban: "kanban-abc.js" }, importer);

    expect(importer).not.toHaveBeenCalled();
    expect(report.skipped).toEqual([""]);
  });

  it("does not treat inherited object properties as declared islands", async () => {
    mountElement("toString");
    const importer = vi.fn<(file: string) => Promise<IslandModule>>();

    const report = await loadIslands(document, {}, importer);

    expect(importer).not.toHaveBeenCalled();
    expect(report.skipped).toEqual(["toString"]);
  });
});
