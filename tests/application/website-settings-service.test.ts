import {
  createRegistry,
  defineDocType,
  defineWebForm,
  defineWebPage,
  defineWebView,
  defineWebsiteSettings,
  defineWebsiteTheme,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  WebFormService,
  WebPageService,
  WebViewService,
  WebsiteSettingsService,
  WebsiteThemeService
} from "../../src";
import { guest, now, owner } from "../helpers";

describe("WebsiteSettingsService", () => {
  it("resolves visible website settings, home page, and navigation items", async () => {
    const leadDocType = defineDocType({
      name: "Lead",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "route", type: "text" },
        { name: "published", type: "boolean" }
      ],
      permissions: [
        { roles: ["Guest"], actions: ["read"] },
        { roles: ["User"], actions: ["read"] },
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
      webViews: [
        defineWebView({
          name: "Public Updates",
          doctype: "Lead",
          routeField: "route",
          titleField: "title",
          publishedField: "published"
        }),
        defineWebView({
          name: "Member Updates",
          doctype: "Lead",
          routeField: "route",
          titleField: "title",
          publishedField: "published",
          roles: ["User"]
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
          { name: "public-updates", label: "Public Updates", webView: "Public Updates" },
          { name: "member-updates", label: "Member Updates", webView: "Member Updates" },
          { name: "docs", label: "Docs", href: "https://example.com/docs" }
        ]
      })
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webForms = new WebFormService({ registry, documents, queries });
    const webPages = new WebPageService({ registry });
    const webViews = new WebViewService({ registry, queries });
    const websiteThemes = new WebsiteThemeService({ registry });
    const website = new WebsiteSettingsService({ registry, webPages, webForms, webViews, websiteThemes });

    expect(website.getHomePageRoute(guest)).toBe("about");
    await expect(website.getHomePageHref(guest)).resolves.toBe("/page/about");
    await expect(website.getWebsiteSettings(guest)).resolves.toEqual({
      title: "Starter Site",
      description: "Cloudflare-native starter",
      homePageRoute: "about",
      homePageHref: "/page/about",
      theme: { name: "Starter Theme", tokens: { primaryColor: "#2563eb" } },
      navItems: [
        { name: "about", label: "About", href: "/page/about" },
        { name: "public-intake", label: "Public Intake", href: "/web-forms/public/intake" },
        { name: "public-updates", label: "Public Updates", href: "/web/Public%20Updates" },
        { name: "docs", label: "Docs", href: "https://example.com/docs" }
      ]
    });
    await expect(website.getWebsiteSettings(owner).then((settings) => settings.navItems.map((item) => item.name)))
      .resolves.toEqual([
        "about",
        "members",
        "public-intake",
        "member-intake",
        "public-updates",
        "member-updates",
        "docs"
      ]);
  });

  it("resolves Web Form, Web View, and safe-link home pages through the same access boundaries", async () => {
    const Lead = defineDocType({
      name: "Lead",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "route", type: "text" },
        { name: "published", type: "boolean" }
      ],
      permissions: [
        { roles: ["Guest"], actions: ["read", "create"] },
        { roles: ["User"], actions: ["read", "create"] }
      ]
    });
    const base = {
      doctypes: [Lead],
      webPages: [defineWebPage({ name: "About", route: "about", title: "About", sections: [{ body: "Welcome" }] })],
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
      webViews: [
        defineWebView({
          name: "Updates",
          doctype: "Lead",
          routeField: "route",
          titleField: "title",
          publishedField: "published"
        })
      ]
    } as const;

    const publicForm = websiteFor(createRegistry({
      ...base,
      websiteSettings: defineWebsiteSettings({ title: "Starter Site", homePageWebForm: "Public Intake" })
    }));
    await expect(publicForm.getHomePageHref(guest)).resolves.toBe("/web-forms/public/intake");

    const memberForm = websiteFor(createRegistry({
      ...base,
      websiteSettings: defineWebsiteSettings({ title: "Starter Site", homePageWebForm: "Member Intake" })
    }));
    await expect(memberForm.getHomePageHref(guest)).rejects.toMatchObject({ code: "WEBSITE_SETTINGS_NOT_FOUND" });
    await expect(memberForm.getHomePageHref(owner)).resolves.toBe("/web-forms/member/intake");

    const webView = websiteFor(createRegistry({
      ...base,
      websiteSettings: defineWebsiteSettings({ title: "Starter Site", homePageWebView: "Updates" })
    }));
    await expect(webView.getHomePageHref(guest)).resolves.toBe("/web/Updates");

    const safeLink = websiteFor(createRegistry({
      ...base,
      websiteSettings: defineWebsiteSettings({ title: "Starter Site", homePageHref: "https://example.com/docs" })
    }));
    await expect(safeLink.getHomePageHref(guest)).resolves.toBe("https://example.com/docs");
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

function websiteFor(registry: ReturnType<typeof createRegistry>): WebsiteSettingsService {
  const store = new InMemoryDocumentStore();
  const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
  const queries = new QueryService({ registry, projections: store });
  const webPages = new WebPageService({ registry });
  return new WebsiteSettingsService({
    registry,
    webPages,
    webForms: new WebFormService({ registry, documents, queries }),
    webViews: new WebViewService({ registry, queries })
  });
}
