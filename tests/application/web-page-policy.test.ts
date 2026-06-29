import { defineWebPage, planWebPageReadAccess, planWebPageRouteLookup, SYSTEM_MANAGER_ROLE } from "../../src";

const AboutPage = defineWebPage({
  name: "About",
  route: "about",
  title: "About",
  sections: [{ body: "Welcome" }]
});

describe("web page policy", () => {
  it("plans Web Page read access from published state and roles", () => {
    const members = defineWebPage({
      ...AboutPage,
      name: "Members",
      route: "members",
      title: "Members",
      roles: ["Member"]
    });

    expect(planWebPageReadAccess({
      actor: { id: "guest", roles: ["Guest"] },
      page: AboutPage
    })).toEqual({ status: "allow" });
    expect(planWebPageReadAccess({
      actor: { id: "member", roles: ["Member"] },
      page: members
    })).toEqual({ status: "allow" });
    expect(planWebPageReadAccess({
      actor: { id: "guest", roles: ["Guest"] },
      page: members
    })).toEqual({ status: "deny", message: "Actor 'guest' cannot read web page 'Members'" });
    expect(planWebPageReadAccess({
      actor: { id: "admin", roles: [SYSTEM_MANAGER_ROLE] },
      page: defineWebPage({ ...AboutPage, published: false })
    })).toEqual({ status: "deny", message: "Actor 'admin' cannot read web page 'About'" });
  });

  it("plans Web Page route lookup with stable not-found errors", () => {
    expect(planWebPageRouteLookup({ pages: [AboutPage], route: "about" })).toEqual({
      status: "found",
      page: AboutPage
    });
    expect(planWebPageRouteLookup({ pages: [AboutPage], route: "missing" })).toEqual({
      status: "not-found",
      message: "Web page route 'missing' was not found",
      code: "WEB_PAGE_NOT_FOUND"
    });
  });
});
