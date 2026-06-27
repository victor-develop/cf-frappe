import { createRegistry, createRegistryFromApps, defineApp, defineWebPage, defineWebsiteSettings } from "../../src";

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
    const settings = defineWebsiteSettings({
      title: "Starter Site",
      homePageRoute: "about",
      navItems: [
        { name: "about", label: "About", pageRoute: "about" },
        { name: "docs", label: "Docs", href: "https://example.com/docs" }
      ]
    });
    const registry = createRegistry({ webPages: [about], websiteSettings: settings });

    expect(registry.getWebsiteSettings()).toEqual(settings);
    expect(createRegistryFromApps([defineApp({ name: "website", webPages: [about], websiteSettings: settings })]).getWebsiteSettings())
      .toEqual(settings);
    expect(() => createRegistry({ webPages: [about], websiteSettings: [settings, settings] })).toThrow("already registered");
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
    ).toThrow("exactly one of pageRoute or href");
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
  });
});
