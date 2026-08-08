/**
 * Desk island loader (framework-free).
 *
 * Scans a DOM subtree for `[data-cf-frappe-island]` mounts and dynamically
 * imports ONLY islands declared in the build-time manifest. Unknown island
 * names are skipped, never fetched — the manifest is the allowlist, so
 * markup can never make the loader download arbitrary modules.
 *
 * This module is pure and dependency-injected (manifest + importer) so it is
 * unit-testable without a bundler. The tiny `loader-main.ts` entry wires it
 * to the real `import()` and the manifest injected by the build.
 */

/** Attribute that declares an island mount and names the island. */
export const ISLAND_MOUNT_ATTRIBUTE = "data-cf-frappe-island";

/** Attribute stamped on a mount once the loader has claimed it. */
export const ISLAND_MOUNTED_ATTRIBUTE = "data-cf-frappe-island-mounted";

/** Shape every island entry module must export. */
export interface IslandModule {
  readonly default?: (element: HTMLElement) => void;
}

/** Injected dynamic-import implementation (`file` is a manifest value). */
export type IslandImporter = (file: string) => Promise<IslandModule>;

/** Island name -> hashed chunk file name (the build-time allowlist). */
export type IslandManifest = Readonly<Record<string, string>>;

export interface IslandLoadReport {
  /** Island names that were imported and mounted. */
  readonly mounted: readonly string[];
  /** Island names (or "") found in the DOM but not declared in the manifest. */
  readonly skipped: readonly string[];
  /** Islands whose import or mount threw; the page keeps its SSR fallback. */
  readonly failed: readonly string[];
}

/** All island mounts in the subtree, in document order. */
export function discoverIslandMounts(root: ParentNode): readonly HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[${ISLAND_MOUNT_ATTRIBUTE}]`)];
}

/**
 * Mounts every declared island found under `root`. Never throws: a failing
 * island keeps its server-rendered fallback and is listed in `failed`.
 */
export async function loadIslands(
  root: ParentNode,
  manifest: IslandManifest,
  importer: IslandImporter
): Promise<IslandLoadReport> {
  const mounted: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const element of discoverIslandMounts(root)) {
    const name = element.getAttribute(ISLAND_MOUNT_ATTRIBUTE) ?? "";
    if (element.hasAttribute(ISLAND_MOUNTED_ATTRIBUTE)) {
      continue;
    }
    const file = name !== "" && Object.hasOwn(manifest, name) ? manifest[name] : undefined;
    if (file === undefined) {
      skipped.push(name);
      continue;
    }
    element.setAttribute(ISLAND_MOUNTED_ATTRIBUTE, "");
    try {
      const module = await importer(file);
      if (typeof module.default !== "function") {
        throw new Error(`island '${name}' has no default mount export`);
      }
      module.default(element);
      mounted.push(name);
    } catch {
      element.removeAttribute(ISLAND_MOUNTED_ATTRIBUTE);
      failed.push(name);
    }
  }
  return { mounted, skipped, failed };
}
