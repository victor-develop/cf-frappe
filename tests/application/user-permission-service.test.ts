import { SYSTEM_MANAGER_ROLE, UserPermissionService, userPermissionsStream } from "../../src";
import { createServices, owner } from "../helpers";

const admin = {
  id: "admin@example.com",
  roles: [SYSTEM_MANAGER_ROLE],
  tenantId: "acme"
};

describe("UserPermissionService", () => {
  it("grants and revokes linked-record user permissions as idempotent events", async () => {
    const { events } = createServices(["unused"]);
    const userPermissions = new UserPermissionService({
      events,
      ids: deterministicPermissionIds(["grant-1", "revoke-1"]),
      clock: { now: () => "2026-01-02T00:00:00.000Z" }
    });

    const granted = await userPermissions.allow({
      actor: admin,
      userId: owner.id,
      targetDoctype: "Project",
      targetName: "Apollo",
      applicableDoctypes: ["Task", "Issue"]
    });
    const duplicateGrant = await userPermissions.allow({
      actor: admin,
      userId: owner.id,
      targetDoctype: "Project",
      targetName: "Apollo",
      applicableDoctypes: ["Issue", "Task"],
      expectedVersion: 1
    });
    const revoked = await userPermissions.revoke({
      actor: admin,
      userId: owner.id,
      targetDoctype: "Project",
      targetName: "Apollo",
      applicableDoctypes: ["Task", "Issue"],
      expectedVersion: 1
    });
    const absentRevoke = await userPermissions.revoke({
      actor: admin,
      userId: owner.id,
      targetDoctype: "Project",
      targetName: "Apollo",
      applicableDoctypes: ["Task", "Issue"],
      expectedVersion: 2
    });

    expect(granted).toMatchObject({
      tenantId: "acme",
      userId: owner.id,
      version: 1,
      grants: [{ targetDoctype: "Project", targetName: "Apollo", applicableDoctypes: ["Issue", "Task"] }]
    });
    expect(duplicateGrant.version).toBe(1);
    expect(revoked).toMatchObject({ version: 2, grants: [] });
    expect(absentRevoke.version).toBe(2);
    await expect(userPermissions.permissionsFor(owner, "acme")).resolves.toEqual([]);
    await expect(events.readStream(userPermissionsStream("acme", owner.id))).resolves.toMatchObject([
      {
        id: "grant-1",
        type: "UserPermissionAllowed",
        payload: {
          kind: "UserPermissionAllowed",
          userId: owner.id,
          targetDoctype: "Project",
          targetName: "Apollo",
          applicableDoctypes: ["Issue", "Task"]
        }
      },
      {
        id: "revoke-1",
        type: "UserPermissionRevoked",
        payload: {
          kind: "UserPermissionRevoked",
          userId: owner.id,
          targetDoctype: "Project",
          targetName: "Apollo",
          applicableDoctypes: ["Issue", "Task"]
        }
      }
    ]);
  });

  it("requires system-manager authority and current optimistic versions", async () => {
    const { events } = createServices(["unused"]);
    const userPermissions = new UserPermissionService({
      events,
      ids: deterministicPermissionIds(["grant-1"]),
      clock: { now: () => "2026-01-02T00:00:00.000Z" }
    });

    await expect(
      userPermissions.allow({
        actor: owner,
        userId: "restricted@example.com",
        targetDoctype: "Project",
        targetName: "Apollo"
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      userPermissions.allow({
        actor: admin,
        userId: "restricted@example.com",
        tenantId: "globex",
        targetDoctype: "Project",
        targetName: "Apollo"
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      userPermissions.allow({
        actor: admin,
        userId: "restricted@example.com",
        targetDoctype: "Project",
        targetName: "Apollo",
        expectedVersion: 1
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
    await expect(
      userPermissions.allow({
        actor: admin,
        userId: "restricted@example.com",
        targetDoctype: " ",
        targetName: "Apollo"
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

function deterministicPermissionIds(values: readonly string[]) {
  let index = 0;
  return {
    next() {
      const value = values[index++];
      if (value === undefined) {
        throw new Error("No deterministic user permission id left");
      }
      return value;
    }
  };
}
