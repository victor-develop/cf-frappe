import {
  roleCreatedPayload,
  roleDescriptionChangedPayload,
  roleDisabledPayload,
  roleEnabledPayload
} from "../../src";
import type { RoleEventPayload } from "../../src";

describe("role events", () => {
  it("builds role creation payloads with optional descriptions", () => {
    expect(rolePayload(roleCreatedPayload({
      role: "Support Lead",
      enabled: true,
      description: "Handles escalations"
    }))).toEqual({
      kind: "RoleCreated",
      role: "Support Lead",
      enabled: true,
      description: "Handles escalations"
    });
    expect(rolePayload(roleCreatedPayload({
      role: "Support",
      enabled: false
    }))).toEqual({
      kind: "RoleCreated",
      role: "Support",
      enabled: false
    });
  });

  it("builds role description change payloads without leaking undefined descriptions", () => {
    expect(rolePayload(roleDescriptionChangedPayload({
      role: "Support Lead",
      description: "Owns escalations"
    }))).toEqual({
      kind: "RoleDescriptionChanged",
      role: "Support Lead",
      description: "Owns escalations"
    });
    expect(rolePayload(roleDescriptionChangedPayload({ role: "Support Lead" }))).toEqual({
      kind: "RoleDescriptionChanged",
      role: "Support Lead"
    });
  });

  it("builds role status payloads", () => {
    expect(rolePayload(roleEnabledPayload({ role: "Support Lead" }))).toEqual({
      kind: "RoleEnabled",
      role: "Support Lead"
    });
    expect(rolePayload(roleDisabledPayload({ role: "Support Lead" }))).toEqual({
      kind: "RoleDisabled",
      role: "Support Lead"
    });
  });
});

function rolePayload(payload: RoleEventPayload): RoleEventPayload {
  return payload;
}
