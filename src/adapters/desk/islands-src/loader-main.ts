/**
 * Loader entry point. The build (scripts/build-desk-client.mjs) injects the
 * island manifest via `define` after the island chunks are built, so the
 * loader can only ever import the hashed chunks it was built with.
 */
import { loadIslands, type IslandManifest, type IslandModule } from "./loader.js";

declare const __DESK_ISLAND_MANIFEST__: IslandManifest;

function importIsland(file: string): Promise<IslandModule> {
  return import(new URL(file, import.meta.url).href) as Promise<IslandModule>;
}

function boot(): void {
  void loadIslands(document, __DESK_ISLAND_MANIFEST__, importIsland);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
