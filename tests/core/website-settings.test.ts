import {
  createRegistry,
  createRegistryFromApps,
  defineApp,
  defineDocType,
  defineWebForm,
  defineWebPage,
  defineWebView,
  defineWebsiteSettings,
  websiteNavigationItemHref
} from "../../src";

describe("metadata Website Settings", () => {
  const about = defineWebPage({
    name: "About",
    route: "about",
    title: "About",
    sections: [{ body: "Welcome" }]
  });

  it("freezes metadata-defined website settings", () => {
    const settings = defineWebsiteSettings({
      title: "Starter Site",
      homePageRoute: "about",
      navItems: [{ name: "about", label: "About", pageRoute: "about", roles: ["Guest"] }],
      roles: ["Guest"]
    });

    expect(Object.isFrozen(settings)).toBe(true);
    expect(Object.isFrozen(settings.navItems)).toBe(true);
    expect(Object.isFrozen(settings.navItems?.[0])).toBe(true);
    expect(Object.isFrozen(settings.navItems?.[0]?.roles)).toBe(true);
  });

  it("validates singleton settings and referenced web page routes", () => {
    const Lead = defineDocType({ name: "Lead", fields: [{ name: "title", type: "text" }] });
    const BlogPost = defineDocType({
      name: "Blog Post",
      fields: [
        { name: "title", type: "text" },
        { name: "route", type: "text" },
        { name: "published", type: "boolean" }
      ]
    });
    const leadIntake = defineWebForm({
      name: "Lead Intake",
      route: "lead/intake",
      doctype: "Lead",
      fields: [{ field: "title" }]
    });
    const blog = defineWebView({
      name: "Blog",
      doctype: "Blog Post",
      routeField: "route",
      titleField: "title",
      publishedField: "published"
    });
    const settings = defineWebsiteSettings({
      title: "Starter Site",
      homePageRoute: "about",
      navItems: [
        { name: "about", label: "About", pageRoute: "about" },
        { name: "intake", label: "Lead Intake", webForm: "Lead Intake" },
        { name: "blog", label: "Blog", webView: "Blog" },
        { name: "docs", label: "Docs", href: "https://example.com/docs" }
      ]
    });
    const registry = createRegistry({
      doctypes: [Lead, BlogPost],
      webForms: [leadIntake],
      webPages: [about],
      webViews: [blog],
      websiteSettings: settings
    });

    expect(registry.getWebsiteSettings()).toEqual(settings);
    expect(websiteNavigationItemHref({ name: "intake", label: "Lead Intake", webForm: "Lead Intake" }))
      .toBe("/web-forms/Lead%20Intake");
    expect(websiteNavigationItemHref({ name: "blog", label: "Blog", webView: "Blog" }))
      .toBe("/web/Blog");
    expect(createRegistryFromApps([defineApp({
      name: "website",
      doctypes: [Lead, BlogPost],
      webForms: [leadIntake],
      webPages: [about],
      webViews: [blog],
      websiteSettings: settings
    })]).getWebsiteSettings())
      .toEqual(settings);
    expect(() => createRegistry({
      doctypes: [Lead, BlogPost],
      webForms: [leadIntake],
      webPages: [about],
      webViews: [blog],
      websiteSettings: [settings, settings]
    })).toThrow("already registered");
    expect(() => defineWebsiteSettings({ title: "", homePageRoute: "about" })).toThrow("website title is required");
    expect(() =>
      defineWebsiteSettings({
        title: "Bad",
        navItems: [{ name: "bad", label: "Bad", pageRoute: "bad route" }]
      })
    ).toThrow("safe canonical relative path");
    expect(() =>
      defineWebsiteSettings({
        title: "Bad",
        navItems: [{ name: "bad", label: "Bad", href: "javascript:alert(1)" }]
      })
    ).toThrow("safe href");
    expect(() =>
      defineWebsiteSettings({
        title: "Bad",
        navItems: [{ name: "bad", label: "Bad", href: "/api/meta/website-settings" }]
      })
    ).toThrow("safe href");
    expect(() =>
      defineWebsiteSettings({
        title: "Bad",
        navItems: [{ name: "bad", label: "Bad", href: "/desk/Task" }]
      })
    ).toThrow("safe href");
    expect(() =>
      defineWebsiteSettings({
        title: "Bad",
        navItems: [{ name: "bad", label: "Bad", href: "/page/../admin" }]
      })
    ).toThrow("safe href");
    expect(() =>
      defineWebsiteSettings({
        title: "Bad",
        navItems: [{ name: "bad", label: "Bad", href: "/web/a/%2e%2e/%2e%2e/api/resource" }]
      })
    ).toThrow("safe href");
    expect(() =>
      defineWebsiteSettings({
        title: "Bad",
        navItems: [{ name: "bad", label: "Bad", href: "/page/about\\x" }]
      })
    ).toThrow("safe href");
    expect(() =>
      defineWebsiteSettings({
        title: "Bad",
        navItems: [{ name: "bad", label: "Bad", pageRoute: "about", href: "/page/about" }]
      })
    ).toThrow("exactly one of pageRoute, webForm, webView, or href");
    expect(() =>
      defineWebsiteSettings({
        title: "Bad",
        navItems: [{ name: "bad", label: "Bad", webForm: " " }]
      })
    ).toThrow("Web Form is required");
    expect(() =>
      defineWebsiteSettings({
        title: "Bad",
        navItems: [{ name: "bad", label: "Bad", webView: " " }]
      })
    ).toThrow("Web View is required");
    expect(() =>
      defineWebsiteSettings({
        title: "Bad",
        navItems: [
          { name: "about", label: "About", pageRoute: "about" },
          { name: "about", label: "Duplicate", pageRoute: "about" }
        ]
      })
    ).toThrow("duplicate navigation item 'about'");
    expect(() => createRegistry({ webPages: [about], websiteSettings: defineWebsiteSettings({ title: "Bad", homePageRoute: "missing" }) }))
      .toThrow("unknown Web Page route 'missing'");
    expect(() =>
      createRegistry({
        doctypes: [Lead],
        webPages: [about],
        websiteSettings: defineWebsiteSettings({
          title: "Bad",
          navItems: [{ name: "missing", label: "Missing", webForm: "Missing Form" }]
        })
      })
    ).toThrow("unknown Web Form 'Missing Form'");
    expect(() =>
      createRegistry({
        doctypes: [Lead],
        webPages: [about],
        websiteSettings: defineWebsiteSettings({
          title: "Bad",
          navItems: [{ name: "missing", label: "Missing", webView: "Missing View" }]
        })
      })
    ).toThrow("unknown Web View 'Missing View'");
  });
});
