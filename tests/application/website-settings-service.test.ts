import {
  createRegistry,
  defineWebPage,
  defineWebsiteSettings,
  defineWebsiteTheme,
  WebPageService,
  WebsiteSettingsService,
  WebsiteThemeService
} from "../../src";
import { guest, owner } from "../helpers";

describe("WebsiteSettingsService", () => {
  it("resolves visible website settings, home page, and navigation items", () => {
    const registry = createRegistry({
      webPages: [
        defineWebPage({
          name: "About",
          route: "about",
          title: "About",
          sections: [{ body: "Welcome" }]
        }),
        defineWebPage({
          name: "Members",
          route: "members",
          title: "Members",
          roles: ["User"],
          sections: [{ body: "Private" }]
        })
      ],
      websiteThemes: [defineWebsiteTheme({ name: "Starter Theme", tokens: { primaryColor: "#2563eb" } })],
      websiteSettings: defineWebsiteSettings({
        title: "Starter Site",
        description: "Cloudflare-native starter",
        homePageRoute: "about",
        theme: "Starter Theme",
        navItems: [
          { name: "about", label: "About", pageRoute: "about" },
          { name: "members", label: "Members", pageRoute: "members" },
          { name: "docs", label: "Docs", href: "https://example.com/docs" }
        ]
      })
    });
    const webPages = new WebPageService({ registry });
    const websiteThemes = new WebsiteThemeService({ registry });
    const website = new WebsiteSettingsService({ registry, webPages, websiteThemes });

    expect(website.getHomePageRoute(guest)).toBe("about");
    expect(website.getWebsiteSettings(guest)).toEqual({
      title: "Starter Site",
      description: "Cloudflare-native starter",
      homePageRoute: "about",
      theme: { name: "Starter Theme", tokens: { primaryColor: "#2563eb" } },
      navItems: [
        { name: "about", label: "About", href: "/page/about" },
        { name: "docs", label: "Docs", href: "https://example.com/docs" }
      ]
    });
    expect(website.getWebsiteSettings(owner).navItems.map((item) => item.name)).toEqual(["about", "members", "docs"]);
  });

  it("denies unpublished or role-filtered settings", () => {
    const page = defineWebPage({ name: "About", route: "about", title: "About", sections: [{ body: "Welcome" }] });
    const restricted = createRegistry({
      webPages: [page],
      websiteSettings: defineWebsiteSettings({
        title: "Private Site",
        homePageRoute: "about",
        roles: ["User"]
      })
    });
    const unpublished = createRegistry({
      webPages: [page],
      websiteSettings: defineWebsiteSettings({
        title: "Draft Site",
        homePageRoute: "about",
        published: false
      })
    });

    expect(() => new WebsiteSettingsService({ registry: restricted, webPages: new WebPageService({ registry: restricted }) }).getWebsiteSettings(guest))
      .toThrow(expect.objectContaining({ code: "PERMISSION_DENIED" }));
    expect(() => new WebsiteSettingsService({ registry: unpublished, webPages: new WebPageService({ registry: unpublished }) }).getWebsiteSettings(owner))
      .toThrow(expect.objectContaining({ code: "PERMISSION_DENIED" }));
  });
});
