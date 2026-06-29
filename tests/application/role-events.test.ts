import {
  foldRoleCatalog,
  isRoleEvent,
  isRolePayloadKind,
  roleCreatedPayload,
  roleDescriptionChangedPayload,
  roleDisabledPayload,
  roleEnabledPayload,
  roleEventType,
  ROLE_PAYLOAD_KINDS,
  roleStatusChangedPayload
} from "../../src";
import type { DomainEvent, RoleEventPayload } from "../../src";

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

  it("builds role status payloads from enabled state", () => {
    expect(rolePayload(roleStatusChangedPayload({ role: "Support Lead", enabled: true }))).toEqual({
      kind: "RoleEnabled",
      role: "Support Lead"
    });
    expect(rolePayload(roleStatusChangedPayload({ role: "Support Lead", enabled: false }))).toEqual({
      kind: "RoleDisabled",
      role: "Support Lead"
    });
  });

  it("derives role event types from payload identity", () => {
    expect(roleEventType(roleCreatedPayload({ role: "Support Lead", enabled: true }))).toBe("RoleCreated");
    expect(roleEventType(roleStatusChangedPayload({ role: "Support Lead", enabled: false }))).toBe("RoleDisabled");
  });

  it("exposes the bounded role payload kind set", () => {
    expect(ROLE_PAYLOAD_KINDS).toEqual([
      "RoleCreated",
      "RoleDescriptionChanged",
      "RoleEnabled",
      "RoleDisabled"
    ]);
  });

  it("narrows role events by payload kind when event type names are custom", () => {
    const created = {
      ...event(roleCreatedPayload({ role: "Support Lead", enabled: true })),
      type: "SupportRoleProvisioned"
    };

    expect(isRolePayloadKind("RoleCreated")).toBe(true);
    expect(isRolePayloadKind("DocumentDeleted")).toBe(false);
    expect(isRoleEvent(created)).toBe(true);
    expect(isRoleEvent(event({ kind: "DocumentDeleted" }))).toBe(false);
  });

  it("folds role catalog state by payload kind when event type names are custom", () => {
    const misleadingUnrelated = event({ kind: "DocumentDeleted" }, "RoleCreated");
    const customTypedRole = {
      ...event(roleCreatedPayload({ role: "Support Lead", enabled: true }), "SupportRoleProvisioned"),
      sequence: 2
    };

    const state = foldRoleCatalog("acme", [misleadingUnrelated, customTypedRole]);

    expect(state.version).toBe(2);
    expect(state.roles).toMatchObject([
      {
        name: "Support Lead",
        enabled: true,
        version: 2
      }
    ]);
  });
});

function rolePayload(payload: RoleEventPayload): RoleEventPayload {
  return payload;
}

function event(payload: DomainEvent["payload"], type: string = payload.kind): DomainEvent {
  return {
    id: "evt_role",
    tenantId: "acme",
    stream: "acme:__Roles",
    sequence: 1,
    type,
    doctype: "__Roles",
    documentName: "catalog",
    actorId: "admin@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload,
    metadata: {}
  };
}
