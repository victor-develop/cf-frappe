import { can, SYSTEM_MANAGER_ROLE } from "../../src";
import { guest, manager, noteDocType, owner } from "../helpers";

describe("permissions", () => {
  it("allows matching role and action", () => {
    expect(can(guest, noteDocType, "read")).toBe(true);
  });

  it("denies actions missing from the matching role", () => {
    expect(can(guest, noteDocType, "create")).toBe(false);
  });

  it("honors predicate rules with document data", () => {
    const mine = {
      tenantId: "acme",
      doctype: "Note",
      name: "one",
      version: 1,
      docstatus: "draft" as const,
      data: { title: "One", created_by: owner.id },
      createdAt: "now",
      updatedAt: "now"
    };
    const other = { ...mine, name: "two", data: { title: "Two", created_by: "other" } };

    expect(can(owner, noteDocType, "update", mine)).toBe(true);
    expect(can(owner, noteDocType, "update", other)).toBe(false);
  });

  it("lets System Manager bypass explicit rules", () => {
    expect(can({ id: "root", roles: [SYSTEM_MANAGER_ROLE] }, noteDocType, "delete")).toBe(true);
  });

  it("lets a separate manager role delete", () => {
    expect(can(manager, noteDocType, "delete")).toBe(true);
  });
});
