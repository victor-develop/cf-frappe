/**
 * GENERATED IMPORT LIST — behavior modules self-register here.
 *
 * Each ported behavior module registers its hydrators and namespace contributions at
 * import time (`registerHydrator` / `registerNamespaceContribution` from `./boot.js`),
 * so `main.ts` only needs to import this file before calling `boot()`.
 *
 * Import order preserves the legacy boot sequence:
 *   ready(currentFormBinding); ready(hydrateFileUploadForms);
 *   ready(hydrateCompoundFilterBuilders); ready(hydrateReportFormulaBuilders);
 *   ready(hydratePresencePanels);
 *
 * `realtime.js` contributes `cfFrappe.realtime` at import time; the
 * `cfFrappe.collaboration` extension is composed below from the realtime message
 * builders plus the merge-planning module (matching the legacy single frozen
 * collaboration object: fieldEditMessage/sendFieldEdit/sendSharedDraft/
 * sharedDraftMessage from realtime + mergePlan from merge).
 */

import "./forms.js";
import "./uploads.js";
import "./filter-builder.js";
import "./formula-builder.js";
import "./presence.js";
import { registerNamespaceContribution } from "./boot.js";
import { collaborationMessageApi } from "./realtime.js";
import { documentMergePlan } from "./merge.js";

registerNamespaceContribution(() => ({
  collaboration: {
    ...collaborationMessageApi,
    mergePlan: documentMergePlan
  }
}));
