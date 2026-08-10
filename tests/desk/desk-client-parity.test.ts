/**
 * Behavior-parity checklist for the flip from the legacy generated-string desk client
 * (src/adapters/desk/client.ts, removed by this change — reference copy:
 * `git show <flip-commit>~1:src/adapters/desk/client.ts`) to the built typed bundle
 * (src/adapters/desk/client-src/ -> client-bundle.generated.ts).
 *
 * Every `window.cfFrappe` API group and every `data-cf-frappe-*` hydration selector the
 * legacy script shipped is asserted against the served bundle. The full behavioral
 * suite in desk-client.test.ts (124 tests written against the legacy string) runs
 * unchanged against the bundle; this file guards the API surface inventory itself so a
 * dropped module or selector fails loudly with its name.
 */

import { DESK_CLIENT_BUNDLE } from "../../src/adapters/desk/client-bundle.generated";

/** Top-level `window.cfFrappe` keys frozen by the legacy client (verbatim inventory). */
const LEGACY_TOP_LEVEL_KEYS = [
  "accounts",
  "assignmentRules",
  "audit",
  "auth",
  "calendar",
  "collaboration",
  "context",
  "customFields",
  "dashboard",
  "dataPatches",
  "desk",
  "fieldProperties",
  "files",
  "form",
  "history",
  "jobs",
  "kanban",
  "linkOptions",
  "meta",
  "msgprint",
  "notificationRules",
  "notifications",
  "print",
  "profiles",
  "realtime",
  "report",
  "reportBuilder",
  "request",
  "resource",
  "roles",
  "search",
  "throw",
  "ui",
  "userPermissions",
  "webForm",
  "webPage",
  "webView",
  "websiteSettings",
  "websiteTheme",
  "workflows"
] as const;

/** Sub-key inventories for the namespace groups the flip composed from ported modules. */
const LEGACY_GROUP_KEYS: Readonly<Record<string, readonly string[]>> = {
  collaboration: ["fieldEditMessage", "mergePlan", "sendFieldEdit", "sendSharedDraft", "sharedDraftMessage"],
  files: [
    "abortMultipartUpload",
    "bulkDelete",
    "bulkUpdateMetadata",
    "completeDirectUpload",
    "completeMultipartUpload",
    "contentUrl",
    "delete",
    "generateRendition",
    "list",
    "prepareDirectUpload",
    "prepareMultipartUpload",
    "previewUrl",
    "renditionContentUrl",
    "transformUrl",
    "updateMetadata",
    "upload",
    "uploadDirect",
    "uploadMultipart",
    "uploadMultipartPart"
  ],
  form: ["current", "on", "trigger"],
  realtime: [
    "connect",
    "doctype",
    "doctypeUrl",
    "document",
    "documentUrl",
    "presence",
    "presenceDoctype",
    "presenceDocument",
    "presenceTenant",
    "presenceUrl",
    "presenceUser",
    "subscribe",
    "subscribeDoctype",
    "subscribeDocument",
    "subscribeTenant",
    "subscribeUser",
    "tenant",
    "tenantUrl",
    "url",
    "user",
    "userUrl"
  ]
};

/**
 * Every `data-cf-frappe-*` attribute the legacy client selected or wrote during
 * hydration (upload forms, compound filter builder, report formula builder, form
 * binding/merge, presence panels, realtime document updates).
 */
const LEGACY_DATA_ATTRIBUTES = [
  "data-cf-frappe-add-filter",
  "data-cf-frappe-add-filter-group",
  "data-cf-frappe-apply-shared-draft",
  "data-cf-frappe-compound-filter-builder",
  "data-cf-frappe-document-update",
  "data-cf-frappe-field-edits",
  "data-cf-frappe-filter-field",
  "data-cf-frappe-filter-group",
  "data-cf-frappe-filter-group-template",
  "data-cf-frappe-filter-items",
  "data-cf-frappe-filter-match",
  "data-cf-frappe-filter-operator",
  "data-cf-frappe-filter-row",
  "data-cf-frappe-filter-row-template",
  "data-cf-frappe-filter-rows",
  "data-cf-frappe-filter-value",
  "data-cf-frappe-formula-kind",
  "data-cf-frappe-formula-nested",
  "data-cf-frappe-formula-operand",
  "data-cf-frappe-merge-save",
  "data-cf-frappe-presence",
  "data-cf-frappe-presence-count",
  "data-cf-frappe-presence-list",
  "data-cf-frappe-remove-filter",
  "data-cf-frappe-remove-filter-group",
  "data-cf-frappe-report-formula-builder",
  "data-cf-frappe-runtime",
  "data-cf-frappe-shared-draft"
] as const;

/** Non-data-attribute hydration selectors from the legacy upload slice. */
const LEGACY_UPLOAD_SELECTORS = [
  "form.file-upload[data-max-file-bytes]",
  "form.attachment-upload[data-max-file-bytes]"
] as const;

interface ParityWindow {
  cfFrappe?: Record<string, unknown>;
  location: { href: string };
}

function evaluateBundleNamespace(): Record<string, unknown> {
  const fakeWindow: ParityWindow = { location: { href: "https://app.example/desk" } };
  const fakeDocument = {
    readyState: "complete",
    addEventListener: () => undefined,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  // Evaluates the repo's own generated bundle constant (no external input) to
  // introspect the installed namespace — mirrors evaluateDeskClient in
  // desk-client.test.ts.
  new Function("window", "document", DESK_CLIENT_BUNDLE)(fakeWindow, fakeDocument);
  if (!fakeWindow.cfFrappe) {
    throw new Error("bundle did not install window.cfFrappe");
  }
  return fakeWindow.cfFrappe;
}

describe("Desk client bundle parity with the legacy generated script", () => {
  it("exposes every legacy top-level window.cfFrappe API group", () => {
    const namespace = evaluateBundleNamespace();
    const missing = LEGACY_TOP_LEVEL_KEYS.filter((key) => !(key in namespace));
    expect(missing).toEqual([]);
    expect(Object.isFrozen(namespace)).toBe(true);
  });

  it("exposes every legacy sub-key of the module-composed API groups", () => {
    const namespace = evaluateBundleNamespace();
    for (const [group, keys] of Object.entries(LEGACY_GROUP_KEYS)) {
      const target = namespace[group] as Record<string, unknown> | undefined;
      expect(target, `cfFrappe.${group}`).toBeDefined();
      const missing = keys.filter((key) => !(key in (target as Record<string, unknown>)));
      expect(missing, `cfFrappe.${group} missing keys`).toEqual([]);
    }
  });

  it("ships every legacy data-cf-frappe-* hydration attribute", () => {
    const missing = LEGACY_DATA_ATTRIBUTES.filter((attribute) => !DESK_CLIENT_BUNDLE.includes(attribute));
    expect(missing).toEqual([]);
  });

  it("ships the legacy upload-form hydration selectors", () => {
    const missing = LEGACY_UPLOAD_SELECTORS.filter((selector) => !DESK_CLIENT_BUNDLE.includes(selector));
    expect(missing).toEqual([]);
  });

  it("registers all five legacy ready() hydrators in legacy boot order", () => {
    const names = ["form-binding", "file-upload-forms", "compound-filter-builder", "report-formula-builder", "presence-panels"];
    const positions = names.map((name) => DESK_CLIENT_BUNDLE.indexOf(`"${name}"`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
  });

  it("stays React-free: the enhancement layer every desk page downloads ships zero React bytes", () => {
    // React belongs exclusively to lazily loaded island chunks
    // (islands-bundle.generated.ts). If this fails, a client-src module
    // pulled in react/react-dom and the framework boundary broke.
    expect(DESK_CLIENT_BUNDLE).not.toMatch(/react/i);
  });
});
