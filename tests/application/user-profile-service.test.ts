import {
  InMemoryEventStore,
  SYSTEM_MANAGER_ROLE,
  UserAccountService,
  UserProfileService,
  deterministicIds,
  fixedClock,
  userProfilesStream,
  type PasswordHasher
} from "../../src";
import { owner } from "../helpers";
import type { DocumentEventPayload, UserProfileEventPayload } from "../../src";

const admin = {
  id: "admin@example.com",
  roles: [SYSTEM_MANAGER_ROLE],
  tenantId: "acme"
};

describe("UserProfileService", () => {
  it("registers user profile payloads through the domain event extension map", () => {
    const payload = userProfilePayload({
      kind: "UserProfileChanged",
      userId: owner.id,
      profile: { fullName: "Ada Lovelace" }
    });

    expect(payload.profile.fullName).toBe("Ada Lovelace");
  });

  it("stores admin and self profile changes in a separate event stream", async () => {
    const events = new InMemoryEventStore();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      ids: deterministicIds(["account-1"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    const profiles = new UserProfileService({
      events,
      ids: deterministicIds(["profile-1", "profile-2"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    await userAccounts.create({
      actor: admin,
      userId: owner.id,
      email: "owner@example.com",
      password: "secret-123",
      roles: ["User"]
    });

    const first = await profiles.change({
      actor: admin,
      userId: owner.id,
      profile: {
        firstName: "  Ada ",
        lastName: " Lovelace ",
        fullName: " Ada Lovelace ",
        username: " ada ",
        language: "en",
        timeZone: "Europe/London",
        deskTheme: " Dark ",
        dateFormat: " yyyy-MM-dd ",
        timeFormat: " HH:mm ",
        numberFormat: " 1,234.56 ",
        weekStart: " Monday ",
        defaultWorkspace: " Support ",
        userImage: "https://example.com/ada.png",
        phone: " +44 20 1234 ",
        mobileNo: "+44 7000",
        location: "London",
        bio: "First programmer"
      }
    });
    const second = await profiles.change({
      actor: owner,
      userId: owner.id,
      profile: {
        deskTheme: "",
        phone: "",
        bio: "Analytical engine notes"
      },
      expectedVersion: 1
    });

    expect(first).toEqual({
      tenantId: "acme",
      userId: owner.id,
      version: 1,
      profile: {
        firstName: "Ada",
        lastName: "Lovelace",
        fullName: "Ada Lovelace",
        username: "ada",
        language: "en",
        timeZone: "Europe/London",
        deskTheme: "Dark",
        dateFormat: "yyyy-MM-dd",
        timeFormat: "HH:mm",
        numberFormat: "1,234.56",
        weekStart: "Monday",
        defaultWorkspace: "Support",
        userImage: "https://example.com/ada.png",
        phone: "+44 20 1234",
        mobileNo: "+44 7000",
        location: "London",
        bio: "First programmer"
      },
      updatedAt: "2026-01-02T00:00:00.000Z"
    });
    expect(second).toMatchObject({
      version: 2,
      profile: {
        firstName: "Ada",
        lastName: "Lovelace",
        fullName: "Ada Lovelace",
        username: "ada",
        language: "en",
        timeZone: "Europe/London",
        dateFormat: "yyyy-MM-dd",
        timeFormat: "HH:mm",
        numberFormat: "1,234.56",
        weekStart: "Monday",
        defaultWorkspace: "Support",
        userImage: "https://example.com/ada.png",
        mobileNo: "+44 7000",
        location: "London",
        bio: "Analytical engine notes"
      }
    });
    expect(second.profile.deskTheme).toBeUndefined();
    expect(second.profile.phone).toBeUndefined();
    await expect(profiles.get(owner, owner.id)).resolves.toEqual(second);
    await expect(events.readStream(userProfilesStream("acme", owner.id))).resolves.toMatchObject([
      {
        id: "evt_profile-1",
        type: "UserProfileChanged",
        doctype: "__UserProfiles",
        documentName: owner.id,
        actorId: admin.id,
        payload: {
          kind: "UserProfileChanged",
          userId: owner.id,
          profile: {
            firstName: "Ada",
            phone: "+44 20 1234"
          }
        }
      },
      {
        id: "evt_profile-2",
        actorId: owner.id,
        payload: {
          kind: "UserProfileChanged",
          userId: owner.id,
          profile: {
            phone: null,
            bio: "Analytical engine notes"
          }
        }
      }
    ]);
  });

  it("requires account existence, profile authority, tenant scope, and current profile versions", async () => {
    const events = new InMemoryEventStore();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      ids: deterministicIds(["account-1"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    const profiles = new UserProfileService({
      events,
      ids: deterministicIds(["profile-1"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    await userAccounts.create({
      actor: admin,
      userId: owner.id,
      password: "secret-123",
      roles: ["User"]
    });

    await expect(
      profiles.change({
        actor: { id: "other@example.com", roles: ["User"], tenantId: "acme" },
        userId: owner.id,
        profile: { fullName: "Other" }
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      profiles.change({
        actor: admin,
        tenantId: "globex",
        userId: owner.id,
        profile: { fullName: "Ada" }
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      profiles.change({
        actor: admin,
        userId: "missing@example.com",
        profile: { fullName: "Missing" }
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(
      profiles.change({
        actor: admin,
        userId: owner.id,
        profile: { fullName: "Ada" },
        expectedVersion: 1
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });

    await expect(
      profiles.change({
        actor: admin,
        userId: owner.id,
        profile: { unknown: "ignored" }
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("keeps profile versions independent from account security mutations", async () => {
    const events = new InMemoryEventStore();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      ids: deterministicIds(["account-1", "password-1", "roles-1"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    const profiles = new UserProfileService({
      events,
      ids: deterministicIds(["profile-1", "profile-2"]),
      clock: fixedClock("2026-01-02T00:00:00.000Z")
    });
    await userAccounts.create({
      actor: admin,
      userId: owner.id,
      password: "secret-123",
      roles: ["User"]
    });
    await userAccounts.changePassword({
      actor: admin,
      userId: owner.id,
      password: "secret-456",
      expectedVersion: 1
    });
    await userAccounts.changeRoles({
      actor: admin,
      userId: owner.id,
      roles: ["Task Manager", "User"],
      expectedVersion: 2
    });

    const first = await profiles.change({
      actor: admin,
      userId: owner.id,
      profile: { fullName: "Ada Lovelace" },
      expectedVersion: 0
    });
    const second = await profiles.change({
      actor: owner,
      userId: owner.id,
      profile: { bio: "Analytical engine notes" },
      expectedVersion: 1
    });

    expect(first).toMatchObject({ version: 1, profile: { fullName: "Ada Lovelace" } });
    expect(second).toMatchObject({
      version: 2,
      profile: {
        fullName: "Ada Lovelace",
        bio: "Analytical engine notes"
      }
    });
  });
});

function userProfilePayload(
  payload: Extract<DocumentEventPayload, { readonly kind: "UserProfileChanged" }>
): UserProfileEventPayload {
  return payload;
}

function deterministicPasswords(): PasswordHasher {
  return {
    async hash(password) {
      return `hash:${password}`;
    },
    async verify(password, encodedHash) {
      return encodedHash === `hash:${password}`;
    }
  };
}
