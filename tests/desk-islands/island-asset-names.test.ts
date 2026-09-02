import { describe, expect, it } from "vitest";
import {
  DESK_ISLAND_ASSETS,
  DESK_ISLAND_ENTRIES,
  DESK_ISLAND_LOADER_ASSET
} from "../../src/adapters/desk/islands-bundle.generated.js";
// @ts-expect-error -- plain .mjs build helper, no types
import { assetDigest, contentHashedName, topologicalIslandOrder } from "../../scripts/island-asset-names.mjs";

describe("island asset names", () => {
  it("names every committed asset by its own content", () => {
    // The guard that matters. esbuild's `[hash]` also takes module paths in, so
    // it gave the same bytes a different name when `node_modules` was a symlink
    // — `npm run build:client` then emitted names the committed bundle did not
    // have, and `check:client-fresh` failed on a file the author never touched
    // (#56). Reverting to esbuild's hash would leave committed names that do
    // not match their own content, which is what this catches.
    for (const [name, content] of Object.entries(DESK_ISLAND_ASSETS)) {
      const base = name.replace(/-[0-9a-f]{16}\.js$/, "");
      expect(name, `asset '${name}' is not named by its content`).toBe(`${base}-${assetDigest(content)}.js`);
    }
  });

  it("covers the loader and every declared island entry", () => {
    // Otherwise the assertion above passes over an empty or partial map.
    expect(Object.keys(DESK_ISLAND_ASSETS).length).toBeGreaterThanOrEqual(2);
    expect(DESK_ISLAND_ASSETS).toHaveProperty(DESK_ISLAND_LOADER_ASSET);
    for (const entry of Object.values(DESK_ISLAND_ENTRIES)) {
      expect(DESK_ISLAND_ASSETS).toHaveProperty(entry);
    }
  });

  it("resolves every internal reference between committed assets", () => {
    // The one invariant the rename machinery can actually break: miss a file, or
    // rewrite a reference in the wrong order, and a chunk ships importing a name
    // nothing serves. The loader would then 404 at runtime, which no other test
    // here would notice.
    const dangling: string[] = [];
    for (const [name, content] of Object.entries(DESK_ISLAND_ASSETS)) {
      for (const match of content.matchAll(/from\s*"\.\/([^"]+)"/g)) {
        const referenced = match[1]!;
        if (!Object.hasOwn(DESK_ISLAND_ASSETS, referenced)) {
          dangling.push(`${name} -> ${referenced}`);
        }
      }
    }

    expect(dangling).toEqual([]);
    // And the reference graph is not vacuously empty: the island entries import
    // the shared vendor chunk, so there is something here to resolve.
    const references = Object.values(DESK_ISLAND_ASSETS).flatMap((content) => [
      ...content.matchAll(/from\s*"\.\/([^"]+)"/g)
    ]);
    expect(references.length).toBeGreaterThan(0);
  });

  it("refuses to name a non-JavaScript output", () => {
    // These names are served as JavaScript, so a stylesheet renamed to `.js`
    // would go out as `application/javascript` with a CSS body. Widening the
    // hash regex alone is not enough: esbuild hangs a CSS sibling off
    // `cssBundle`, not `imports`, so it would also skip the ordering pass.
    expect(() => contentHashedName("kanban-GOEJIA55.css", "body{color:red}")).toThrow("is not JavaScript");
  });

  it("refuses to drop an output the metafile does not list", () => {
    // The caller renames and writes only what the ordering returns, so a
    // silently omitted output would vanish from both dist/ and the served map.
    const files = new Map([["a-AAAAAAAA.js", ""], ["ghost-GGGGGGGG.js", ""]]);
    const metafile = { outputs: { "islands/a-AAAAAAAA.js": { imports: [] } } };

    expect(() => topologicalIslandOrder(metafile, files)).toThrow("ghost-GGGGGGGG.js");
  });

  it("names a chunk from content alone, not from where it was built", () => {
    expect(contentHashedName("kanban-J4HKU4UN.js", "same bytes")).toBe(
      contentHashedName("kanban-7VXSNT22.js", "same bytes")
    );
    expect(contentHashedName("kanban-J4HKU4UN.js", "other bytes")).not.toBe(
      contentHashedName("kanban-J4HKU4UN.js", "same bytes")
    );
  });

  it("refuses a name it cannot strip an esbuild hash from", () => {
    // Stripping silently would yield `kanban-J4HKU4UN-<digest>.js` and put the
    // path sensitivity straight back, so a changed esbuild naming scheme has to
    // fail the build rather than pass through.
    expect(() => contentHashedName("kanban.js", "bytes")).toThrow("does not carry an esbuild [hash] suffix");
  });

  it("orders chunks so importers are renamed after what they import", () => {
    const files = new Map([
      ["entry-AAAAAAAA.js", ""],
      ["shared-BBBBBBBB.js", ""],
      ["deep-CCCCCCCC.js", ""]
    ]);
    const metafile = {
      outputs: {
        "islands/entry-AAAAAAAA.js": { imports: [{ path: "islands/shared-BBBBBBBB.js" }] },
        "islands/shared-BBBBBBBB.js": { imports: [{ path: "islands/deep-CCCCCCCC.js" }] },
        "islands/deep-CCCCCCCC.js": { imports: [{ path: "node_modules/react/index.js" }] }
      }
    };

    expect(topologicalIslandOrder(metafile, files)).toEqual([
      "deep-CCCCCCCC.js",
      "shared-BBBBBBBB.js",
      "entry-AAAAAAAA.js"
    ]);
  });

  it("reports an import cycle instead of looping", () => {
    const files = new Map([["a-AAAAAAAA.js", ""], ["b-BBBBBBBB.js", ""]]);
    const metafile = {
      outputs: {
        "islands/a-AAAAAAAA.js": { imports: [{ path: "islands/b-BBBBBBBB.js" }] },
        "islands/b-BBBBBBBB.js": { imports: [{ path: "islands/a-AAAAAAAA.js" }] }
      }
    };

    expect(() => topologicalIslandOrder(metafile, files)).toThrow("import cycle");
  });
});
