import {
  authorizePrintSettingsAdministration,
  ensurePrintSettingsExpectedVersion,
  normalizePrintSettingsPatchInput,
  planPrintSettingsPatchChange,
  resolvePrintSettingsTenant
} from "../../src/application/print-settings-policy.js";
import { SYSTEM_MANAGER_ROLE } from "../../src/core/types.js";
import type { PrintSettingsState } from "../../src/core/print-settings.js";

const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
const owner = { id: "owner@example.com", roles: ["User"], tenantId: "acme" };

describe("print settings policy", () => {
  it("resolves print settings tenants within the actor tenant boundary", () => {
    expect(resolvePrintSettingsTenant({ actor: admin })).toBe("acme");
    expect(resolvePrintSettingsTenant({ actor: { id: "guest@example.com", roles: [] } })).toBe("default");
    expect(() => resolvePrintSettingsTenant({ actor: admin, tenantId: "globex" })).toThrow(
      "Actor 'admin@example.com' cannot manage print settings for tenant 'globex'"
    );
  });

  it("authorizes only configured print settings administrators", () => {
    expect(authorizePrintSettingsAdministration({ actor: admin, adminRoles: [SYSTEM_MANAGER_ROLE] })).toBe("acme");
    expect(
      authorizePrintSettingsAdministration({
        actor: { id: "print@example.com", roles: ["Print Admin"], tenantId: "acme" },
        adminRoles: ["Print Admin"]
      })
    ).toBe("acme");
    expect(() =>
      authorizePrintSettingsAdministration({ actor: owner, adminRoles: [SYSTEM_MANAGER_ROLE] })
    ).toThrow("Actor 'owner@example.com' cannot manage print settings");
  });

  it("normalizes print settings patches and preserves print layout validation errors", () => {
    expect(normalizePrintSettingsPatchInput({})).toEqual({});
    expect(normalizePrintSettingsPatchInput({ defaultLayout: null })).toEqual({ defaultLayout: null });
    expect(
      normalizePrintSettingsPatchInput({
        defaultLayout: {
          pageSize: "A4",
          orientation: "portrait",
          margins: { topMm: 10, rightMm: 10, bottomMm: 10, leftMm: 10 },
          font: { family: "Inter", sizePt: 11 }
        }
      })
    ).toMatchObject({
      defaultLayout: {
        pageSize: "A4",
        orientation: "portrait",
        margins: { topMm: 10 },
        font: { family: "Inter", sizePt: 11 }
      }
    });
    expect(() => normalizePrintSettingsPatchInput({ unknown: true })).toThrow(
      "Unknown print settings field 'unknown'"
    );
    expect(() =>
      normalizePrintSettingsPatchInput({ defaultLayout: { font: { family: "Inter; color:red" } } })
    ).toThrow("Print settings layout font family contains unsupported characters");
  });

  it("plans print settings patch writes only when normalized patch data is present", () => {
    expect(planPrintSettingsPatchChange({})).toEqual({ status: "noop" });
    expect(planPrintSettingsPatchChange({ defaultLayout: null })).toEqual({ status: "write" });
  });

  it("guards expected print settings versions", () => {
    expect(() => ensurePrintSettingsExpectedVersion(state(1), undefined)).not.toThrow();
    expect(() => ensurePrintSettingsExpectedVersion(state(1), 1)).not.toThrow();
    expect(() => ensurePrintSettingsExpectedVersion(state(2), 1)).toThrow(
      "Expected print settings at version 1, found 2"
    );
  });
});

function state(version: number): PrintSettingsState {
  return {
    tenantId: "acme",
    version,
    settings: {}
  };
}
