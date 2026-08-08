/**
 * Server-side (Hono JSX) primitives for React island mounts.
 *
 * Contract (issue #19, decisions 4-11):
 * - Islands mount client-only via `createRoot` at boundaries declared with
 *   {@link IslandMount}; Hono JSX owns all server HTML (no React SSR).
 * - Mount props carry ONLY identifiers and permission-aware API URLs —
 *   never document snapshots. `IslandMount` enforces this shape at render
 *   time so a page cannot accidentally embed data blobs.
 * - Only pages that declare an island emit {@link IslandLoaderScript}; every
 *   other page ships zero React bytes.
 */
import type { Child, FC } from "hono/jsx";
import { DESK_ISLAND_ENTRIES, DESK_ISLAND_LOADER_ASSET } from "../islands-bundle.generated.js";

/** URL prefix the Desk app serves hashed island assets under. */
export const DESK_ISLAND_ASSET_BASE_PATH = "/desk/islands";

/** Names of islands declared in the build manifest. */
export type DeskIslandName = keyof typeof DESK_ISLAND_ENTRIES;

/** Absolute path for a hashed island asset file. */
export function islandAssetPath(file: string): string {
  return `${DESK_ISLAND_ASSET_BASE_PATH}/${encodeURIComponent(file)}`;
}

/** Absolute path of the island loader module script. */
export function islandLoaderScriptPath(): string {
  return islandAssetPath(DESK_ISLAND_LOADER_ASSET);
}

const MOUNT_PROP_KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MOUNT_PROP_VALUE_MAX_LENGTH = 1024;

export type IslandMountProps = {
  readonly name: DeskIslandName;
  /**
   * Bootstrap attributes rendered as `data-island-<key>`. Values must be
   * short identifiers or same-origin URLs; JSON blobs are rejected so
   * document snapshots can never ride along in the HTML.
   */
  readonly props: Readonly<Record<string, string>>;
  /** Server-rendered no-JS fallback, wrapped in `[data-island-fallback]`. */
  readonly children?: Child;
};

/**
 * Declared island boundary. Renders the mount element the loader scans for,
 * with the SSR fallback inside; the island hides the fallback once live.
 */
export const IslandMount: FC<IslandMountProps> = ({ name, props, children }) => {
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!MOUNT_PROP_KEY_PATTERN.test(key)) {
      throw new Error(`IslandMount prop key '${key}' must be kebab-case`);
    }
    if (value.length > MOUNT_PROP_VALUE_MAX_LENGTH || value.trimStart().startsWith("{") || value.trimStart().startsWith("[")) {
      throw new Error(
        `IslandMount prop '${key}' must be a short identifier or URL, not embedded data (islands bootstrap from IDs and permission-aware API URLs only)`
      );
    }
    attributes[`data-island-${key}`] = value;
  }
  return (
    <div data-cf-frappe-island={name} {...attributes}>
      <div data-island-fallback="">{children}</div>
    </div>
  );
};

/**
 * The island loader `<script type="module">`. Emit this ONLY from pages that
 * render at least one {@link IslandMount}; non-island pages must not download
 * the loader or React.
 */
export const IslandLoaderScript: FC = () => <script type="module" src={islandLoaderScriptPath()}></script>;
