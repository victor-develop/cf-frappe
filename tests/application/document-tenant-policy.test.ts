import { describe, expect, it } from "vitest";

import { resolveTenant } from "../../src";

describe("document tenant policy", () => {
  it("prefers an explicit command tenant over the actor tenant", () => {
    expect(resolveTenant({ id: "owner@example.com", roles: ["User"], tenantId: "actor_tenant" }, "command_tenant"))
      .toBe("command_tenant");
  });

  it("uses the actor tenant when the command does not specify one", () => {
    expect(resolveTenant({ id: "owner@example.com", roles: ["User"], tenantId: "actor_tenant" })).toBe("actor_tenant");
  });

  it("falls back to the default tenant for tenantless actors and commands", () => {
    expect(resolveTenant({ id: "owner@example.com", roles: ["User"] })).toBe("default");
  });
});
