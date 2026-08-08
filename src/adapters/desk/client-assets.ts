/**
 * Desk client bundle asset paths.
 *
 * The typed client (src/adapters/desk/client-src/, bundled by
 * scripts/build-desk-client.mjs into client-bundle.generated.ts) is served at two paths:
 *
 * - {@link DESK_CLIENT_BUNDLE_PATH}: content-hashed, immutable-cached. This is the path
 *   Desk pages reference from `renderClientScripts` — a new bundle gets a new URL, so
 *   browsers never serve a stale runtime.
 * - {@link DESK_CLIENT_SCRIPT_PATH}: the stable `/desk/client.js` alias (legacy contract
 *   for external/model client scripts that hardcode the path), cached briefly.
 *
 * Both serve the identical bundle text; the `data-cf-frappe-runtime="desk"` bootstrap
 * attributes live on the script tag, not the URL, so the runtime resolves its page
 * context regardless of which path loaded it.
 */

import { DESK_CLIENT_BUNDLE_HASH } from "./client-bundle.generated.js";

export const DESK_CLIENT_SCRIPT_PATH = "/desk/client.js";

export const DESK_CLIENT_BUNDLE_PATH = `/desk/assets/desk-client-${DESK_CLIENT_BUNDLE_HASH}.js`;
