/**
 * Content-addressed names for the desk island assets.
 *
 * Kept apart from `build-desk-client.mjs` so it can be tested without running a
 * build: that script performs its work at import time.
 *
 * esbuild's `[hash]` is not a content hash — it also takes the module paths in.
 * Not because a symlinked `node_modules` reaches different files: it reaches the
 * same ones. esbuild resolves symlinks to their realpath, and that realpath
 * falls outside `absWorkingDir`, so the metafile input key for react-dom turns
 * from
 *
 *     node_modules/react-dom/index.js
 *
 * into
 *
 *     ../../../../../../../Users/…/cf-frappe/node_modules/react-dom/index.js
 *
 * and it is that string which feeds the hash. Identical bytes, different name —
 * so `npm run build:client` emitted names the committed bundle did not have, and
 * `check:client-fresh` failed on a file the author never touched (issue #56).
 *
 * `preserveSymlinks: true` also fixes it, in one line, and was measured doing so.
 * It is not what this does, for two reasons: it breaks a pnpm-style layout (where
 * every dependency is a symlink into a content-addressed store) and can pull in
 * two copies of React; and hashing from content is what `build-desk-client.mjs`
 * already claimed to do, so this makes the claim true rather than propping it up.
 * These helpers rehash from content alone, leaving esbuild's hash as a link-time
 * unique id.
 */

import { createHash } from "node:crypto";
import { basename } from "node:path";

/** esbuild's own `[hash]` suffix, used here only as a link-time unique id. */
export const ESBUILD_HASH_SUFFIX = /-[0-9A-Z]{6,12}\.js$/;

/** The `sha256-16` digest the asset names and the bundle hash both use. */
export function assetDigest(content) {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

/**
 * `<base>-<sha256-16 of content>.js`, where the base is esbuild's name with its
 * own hash stripped.
 *
 * Two shapes throw rather than being coerced, because being silent about either
 * puts back something worse than a failed build:
 *
 * - **A name with no esbuild hash to strip.** Keeping it would produce
 *   `kanban-J4HKU4UN-<digest>.js` and quietly reintroduce the path sensitivity
 *   this exists to remove.
 * - **A non-`.js` output.** These names are served as JavaScript, so renaming a
 *   stylesheet to `.js` would hand the worker a CSS body under
 *   `application/javascript`. Supporting one means more than widening the regex:
 *   esbuild hangs a CSS sibling off `metafile.outputs[].cssBundle` rather than
 *   listing it in `imports`, so {@link topologicalIslandOrder} would not order
 *   it and its references would go unrewritten.
 */
export function contentHashedName(builtName, content) {
  if (!builtName.endsWith(".js")) {
    throw new Error(
      `island output '${builtName}' is not JavaScript; these names are served as JS. ` +
        "Supporting another output type needs an extension-preserving name here AND " +
        "cssBundle-aware ordering in topologicalIslandOrder — see scripts/island-asset-names.mjs"
    );
  }
  const base = builtName.replace(ESBUILD_HASH_SUFFIX, "");
  if (base === builtName) {
    throw new Error(
      `island output '${builtName}' does not carry an esbuild [hash] suffix; ` +
        "update ESBUILD_HASH_SUFFIX in scripts/island-asset-names.mjs"
    );
  }
  return `${base}-${assetDigest(content)}.js`;
}

/**
 * Island outputs ordered dependencies-first, so each chunk is renamed only
 * after everything it imports already has its final name — a referrer is then
 * hashed over the content it will actually ship with.
 */
export function topologicalIslandOrder(metafile, files) {
  const dependencies = new Map();
  for (const [outputPath, meta] of Object.entries(metafile.outputs)) {
    const name = basename(outputPath);
    if (!files.has(name)) {
      continue;
    }
    dependencies.set(
      name,
      (meta.imports ?? []).map((entry) => basename(entry.path)).filter((imported) => files.has(imported))
    );
  }

  const ordered = [];
  const done = new Set();
  const visiting = new Set();
  const visit = (name) => {
    if (done.has(name)) {
      return;
    }
    if (visiting.has(name)) {
      throw new Error(`island chunk import cycle through '${name}'`);
    }
    visiting.add(name);
    for (const imported of dependencies.get(name) ?? []) {
      visit(imported);
    }
    visiting.delete(name);
    done.add(name);
    ordered.push(name);
  };
  for (const name of [...dependencies.keys()].sort()) {
    visit(name);
  }
  if (ordered.length !== files.size) {
    // The caller renames and writes only what this returns, so an output esbuild
    // produced but did not list in the metafile would vanish from both dist/ and
    // the served asset map. The previous code iterated outputFiles directly and
    // could not lose one; keep that property, loudly.
    const missing = [...files.keys()].filter((name) => !done.has(name));
    throw new Error(
      `island outputs absent from the esbuild metafile: ${missing.join(", ")}. ` +
        "These would be dropped silently rather than renamed and served."
    );
  }
  return ordered;
}
