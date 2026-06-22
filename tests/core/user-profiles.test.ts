import { applyUserProfilePatch, normalizeUserProfilePatch } from "../../src";

describe("user profile model", () => {
  it("normalizes richer preference fields through the profile patch contract", () => {
    const patch = normalizeUserProfilePatch({
      deskTheme: " dark ",
      dateFormat: " yyyy-MM-dd ",
      timeFormat: " HH:mm ",
      numberFormat: " 1,234.56 ",
      weekStart: " Monday ",
      defaultWorkspace: " Support ",
      bio: " Analytical engine notes ",
      userImage: ""
    });

    expect(patch).toEqual({
      bio: "Analytical engine notes",
      dateFormat: "yyyy-MM-dd",
      defaultWorkspace: "Support",
      deskTheme: "dark",
      numberFormat: "1,234.56",
      timeFormat: "HH:mm",
      userImage: null,
      weekStart: "Monday"
    });
    expect(applyUserProfilePatch({ deskTheme: "light", userImage: "old.png" }, patch)).toEqual({
      bio: "Analytical engine notes",
      dateFormat: "yyyy-MM-dd",
      defaultWorkspace: "Support",
      deskTheme: "dark",
      numberFormat: "1,234.56",
      timeFormat: "HH:mm",
      weekStart: "Monday"
    });
  });
});
