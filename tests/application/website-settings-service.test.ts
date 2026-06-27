import {
  createRegistry,
  defineDocType,
  defineWebForm,
  defineWebPage,
  defineWebsiteSettings,
  defineWebsiteTheme,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  WebFormService,
  WebPageService,
  WebsiteSettingsService,
  WebsiteThemeService
} from "../../src";
import { guest, now, owner } from "../helpers";

describe("WebsiteSettingsService", () => {
  it("resolves visible website settings, home page, and navigation items", async () => {
    const leadDocType = defineDocType({
      name: "Lead",
      naming: { kind: "field", field: "title" },
      fields: [{ name: "title", type: "text", required: true }],
      permissions: [
        { roles: ["Guest"], actions: ["create"] },
        { roles: ["User"], actions: ["create"] }
      ]
    });
    const registry = createRegistry({
      doctypes: [leadDocType],
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
      webForms: [
        defineWebForm({
          name: "Public Intake",
          route: "public/intake",
          doctype: "Lead",
          fields: [{ field: "title" }]
        }),
        defineWebForm({
          name: "Member Intake",
          route: "member/intake",
          loginRequired: true,
          doctype: "Lead",
          fields: [{ field: "title" }]
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
          { name: "public-intake", label: "Public Intake", webForm: "Public Intake" },
          { name: "member-intake", label: "Member Intake", webForm: "Member Intake" },
          { name: "docs", label: "Docs", href: "https://example.com/docs" }
        ]
      })
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webForms = new WebFormService({ registry, documents, queries });
    const webPages = new WebPageService({ registry });
    const websiteThemes = new WebsiteThemeService({ registry });
    const website = new WebsiteSettingsService({ registry, webPages, webForms, websiteThemes });

    expect(website.getHomePageRoute(guest)).toBe("about");
    await expect(website.getWebsiteSettings(guest)).resolves.toEqual({
      title: "Starter Site",
      description: "Cloudflare-native starter",
      homePageRoute: "about",
      theme: { name: "Starter Theme", tokens: { primaryColor: "#2563eb" } },
      navItems: [
        { name: "about", label: "About", href: "/page/about" },
        { name: "public-intake", label: "Public Intake", href: "/web-forms/public/intake" },
        { name: "docs", label: "Docs", href: "https://example.com/docs" }
      ]
    });
    await expect(website.getWebsiteSettings(owner).then((settings) => settings.navItems.map((item) => item.name)))
      .resolves.toEqual(["about", "members", "public-intake", "member-intake", "docs"]);
  });

  it("denies unpublished or role-filtered settings", async () => {
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

    await expect(new WebsiteSettingsService({ registry: restricted, webPages: new WebPageService({ registry: restricted }) }).getWebsiteSettings(guest))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(new WebsiteSettingsService({ registry: unpublished, webPages: new WebPageService({ registry: unpublished }) }).getWebsiteSettings(owner))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
