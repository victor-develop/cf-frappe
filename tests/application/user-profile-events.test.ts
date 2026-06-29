import {
  foldUserProfile,
  isUserProfileEvent,
  isUserProfilePayloadKind,
  userProfileChangedPayload,
  userProfileEventType,
  USER_PROFILE_PAYLOAD_KINDS
} from "../../src";
import type { DomainEvent, UserProfileEventPayload } from "../../src";

describe("user profile events", () => {
  it("builds user profile change payloads", () => {
    expect(userProfilePayload(userProfileChangedPayload({
      userId: "ada@example.com",
      profile: {
        fullName: "Ada Lovelace",
        phone: null
      }
    }))).toEqual({
      kind: "UserProfileChanged",
      userId: "ada@example.com",
      profile: {
        fullName: "Ada Lovelace",
        phone: null
      }
    });
  });

  it("derives user profile event types from payload identity", () => {
    expect(userProfileEventType(userProfileChangedPayload({
      userId: "ada@example.com",
      profile: { fullName: "Ada Lovelace" }
    }))).toBe("UserProfileChanged");
  });

  it("exposes the bounded user profile payload kind set", () => {
    expect(USER_PROFILE_PAYLOAD_KINDS).toEqual(["UserProfileChanged"]);
  });

  it("narrows user profile events by payload kind when event type names are custom", () => {
    const changed = {
      ...event(userProfileChangedPayload({
        userId: "ada@example.com",
        profile: { fullName: "Ada Lovelace" }
      })),
      type: "DeskProfileUpdated"
    };

    expect(isUserProfilePayloadKind("UserProfileChanged")).toBe(true);
    expect(isUserProfilePayloadKind("DocumentDeleted")).toBe(false);
    expect(isUserProfileEvent(changed)).toBe(true);
    expect(isUserProfileEvent(event({ kind: "DocumentDeleted" }))).toBe(false);
  });

  it("folds user profile state by payload kind when event type names are custom", () => {
    const misleadingUnrelated = event({ kind: "DocumentDeleted" }, "UserProfileChanged");
    const customTypedChange = {
      ...event(userProfileChangedPayload({
        userId: "ada@example.com",
        profile: {
          fullName: "Ada Lovelace"
        }
      }), "DeskProfileUpdated"),
      sequence: 2
    };

    const state = foldUserProfile("acme", "ada@example.com", [misleadingUnrelated, customTypedChange]);

    expect(state.version).toBe(2);
    expect(state.profile).toEqual({
      fullName: "Ada Lovelace"
    });
  });
});

function userProfilePayload(payload: UserProfileEventPayload): UserProfileEventPayload {
  return payload;
}

function event(payload: DomainEvent["payload"], type: string = payload.kind): DomainEvent {
  return {
    id: "evt_profile",
    tenantId: "acme",
    stream: "acme:__UserProfiles:ada@example.com",
    sequence: 1,
    type,
    doctype: "__UserProfiles",
    documentName: "ada@example.com",
    actorId: "ada@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload,
    metadata: {}
  };
}
