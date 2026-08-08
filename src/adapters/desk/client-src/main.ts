/**
 * Desk client entry point.
 *
 * Import order matters: `hydrators.js` (the generated import list) must run first so
 * every behavior module registers its hydrators and namespace contributions before
 * `boot()` assembles and freezes `window.cfFrappe`.
 */

import "./hydrators.js";
import { boot } from "./boot.js";

boot();
