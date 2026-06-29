import { userProfileChangedPayload } from "../../src";
import type { UserProfileEventPayload } from "../../src";

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
});

function userProfilePayload(payload: UserProfileEventPayload): UserProfileEventPayload {
  return payload;
}
