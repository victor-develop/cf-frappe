import {
  defineWebsiteSettings,
  isExpectedWebsiteSettingsAccessMiss,
  isPublishedWebsiteSettingsForActor,
  shouldResolveWebsiteNavigationItem,
  SYSTEM_MANAGER_ROLE,
  visibleWebsiteHomePageRoute,
  websiteNavigationItemResult,
  websiteNavigationStaticHref,
  websitePageHomeHref,
  websiteSettingsResult,
  websiteStaticHomeHref,
  websiteWebFormHref,
  websiteWebViewHref
} from "../../src";
import { guest, owner } from "../helpers";

describe("website settings policy", () => {
  it("allows published settings by role and hides unpublished settings", () => {
    const members = defineWebsiteSettings({
      title: "Members",
      roles: ["User"]
    });
    const draft = defineWebsiteSettings({
      title: "Draft",
      published: false
    });

    expect(isPublishedWebsiteSettingsForActor(guest, members)).toBe(false);
    expect(isPublishedWebsiteSettingsForActor(owner, members)).toBe(true);
    expect(isPublishedWebsiteSettingsForActor({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] }, draft))
      .toBe(false);
  });

  it("resolves visible page home routes and safe static home hrefs", () => {
    const settings = defineWebsiteSettings({
      title: "Starter",
      homePageRoute: "docs/start"
    });
    const staticSettings = defineWebsiteSettings({
      title: "Docs",
      homePageHref: "https://example.com/docs"
    });

    expect(visibleWebsiteHomePageRoute(settings, (route) => route === "docs/start")).toBe("docs/start");
    expect(visibleWebsiteHomePageRoute(settings, () => false)).toBeUndefined();
    expect(websitePageHomeHref(settings, () => true)).toBe("/page/docs/start");
    expect(websitePageHomeHref(settings, () => false)).toBeUndefined();
    expect(websiteStaticHomeHref(staticSettings)).toBe("https://example.com/docs");
  });

  it("gates navigation item resolution by item role and readable page route", () => {
    const item = { name: "members", label: "Members", pageRoute: "members", roles: ["User"] };

    expect(shouldResolveWebsiteNavigationItem(guest, item, () => true)).toBe(false);
    expect(shouldResolveWebsiteNavigationItem(owner, item, (route) => route === "members")).toBe(true);
    expect(shouldResolveWebsiteNavigationItem(owner, item, () => false)).toBe(false);
    expect(shouldResolveWebsiteNavigationItem(guest, { name: "docs", label: "Docs", href: "/docs" }, () => false))
      .toBe(true);
  });

  it("shapes navigation results and framework hrefs", () => {
    const page = { name: "about", label: "About", pageRoute: "about" };
    const webForm = { name: "intake", label: "Intake", webForm: "Lead Intake" };
    const webView = { name: "updates", label: "Updates", webView: "Public Updates" };

    expect(websiteNavigationStaticHref(page)).toBe("/page/about");
    expect(websiteNavigationStaticHref(webForm)).toBe("/web-forms/Lead%20Intake");
    expect(websiteNavigationStaticHref(webView)).toBe("/web/Public%20Updates");
    expect(websiteNavigationItemResult(page, "/page/about")).toEqual([
      { name: "about", label: "About", href: "/page/about" }
    ]);
    expect(websiteNavigationItemResult(page, undefined)).toEqual([]);
  });

  it("shapes Web Form, Web View, and resolved settings results", () => {
    const settings = defineWebsiteSettings({
      title: "Starter",
      description: "Cloudflare-native",
      homePageRoute: "about"
    });

    expect(websiteWebFormHref({ name: "Lead Intake", route: "lead/intake" })).toBe("/web-forms/lead/intake");
    expect(websiteWebFormHref({ name: "Lead Intake" })).toBe("/web-forms/Lead%20Intake");
    expect(websiteWebViewHref({ name: "Public Updates" })).toBe("/web/Public%20Updates");
    expect(websiteSettingsResult({
      settings,
      homePageRoute: "about",
      homePageHref: "/page/about",
      theme: { name: "Starter Theme" },
      navItems: [{ name: "about", label: "About", href: "/page/about" }]
    })).toEqual({
      title: "Starter",
      description: "Cloudflare-native",
      homePageRoute: "about",
      homePageHref: "/page/about",
      theme: { name: "Starter Theme" },
      navItems: [{ name: "about", label: "About", href: "/page/about" }]
    });
  });

  it("classifies expected access misses without swallowing unrelated errors", () => {
    expect(isExpectedWebsiteSettingsAccessMiss({ code: "WEB_PAGE_NOT_FOUND" })).toBe(true);
    expect(isExpectedWebsiteSettingsAccessMiss({ code: "WEB_VIEW_NOT_FOUND" })).toBe(true);
    expect(isExpectedWebsiteSettingsAccessMiss({ code: "PERMISSION_DENIED" })).toBe(true);
    expect(isExpectedWebsiteSettingsAccessMiss({ code: "BAD_REQUEST" })).toBe(false);
    expect(isExpectedWebsiteSettingsAccessMiss(new Error("boom"))).toBe(false);
  });
});
