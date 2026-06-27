import { createRegistry, defineWebPage, WebPageService } from "../../src";
import { guest, owner } from "../helpers";

describe("WebPageService", () => {
  it("lists and resolves published pages by name and route", () => {
    const registry = createRegistry({
      webPages: [
        defineWebPage({
          name: "About",
          route: "about",
          title: "About",
          sections: [{ body: "Welcome" }]
        }),
        defineWebPage({
          name: "Draft",
          route: "draft",
          title: "Draft",
          published: false,
          sections: [{ body: "Hidden" }]
        })
      ]
    });
    const pages = new WebPageService({ registry });

    expect(pages.listWebPages(guest).map((page) => page.name)).toEqual(["About"]);
    expect(pages.getWebPage(guest, "About")).toMatchObject({ title: "About" });
    expect(pages.getWebPageByRoute(guest, "about")).toMatchObject({ name: "About" });
    expect(() => pages.getWebPage(guest, "Draft")).toThrow(expect.objectContaining({ code: "PERMISSION_DENIED" }));
    expect(() => pages.getWebPageByRoute(guest, "draft")).toThrow(expect.objectContaining({ code: "WEB_PAGE_NOT_FOUND" }));
  });

  it("hides pages when role filters fail", () => {
    const registry = createRegistry({
      webPages: [
        defineWebPage({
          name: "Members",
          route: "members",
          title: "Members",
          roles: ["User"],
          sections: [{ body: "Private" }]
        })
      ]
    });
    const pages = new WebPageService({ registry });

    expect(pages.listWebPages(guest)).toEqual([]);
    expect(() => pages.getWebPage(guest, "Members")).toThrow(expect.objectContaining({ code: "PERMISSION_DENIED" }));
    expect(pages.getWebPage(owner, "Members")).toMatchObject({ title: "Members" });
  });
});
