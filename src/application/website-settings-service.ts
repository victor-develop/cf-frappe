import { notFound, permissionDenied } from "../core/errors.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor } from "../core/types.js";
import type { WebsiteNavigationItemDefinition, WebsiteSettingsDefinition } from "../core/website-settings.js";
import type { WebFormService } from "./web-form-service.js";
import type { WebPageService } from "./web-page-service.js";
import type { WebViewService } from "./web-view-service.js";
import type { WebsiteThemeService } from "./website-theme-service.js";
import {
  isExpectedWebsiteSettingsAccessMiss,
  planWebsiteSettingsReadAccess,
  shouldResolveWebsiteNavigationItem,
  visibleWebsiteHomePageRoute,
  websiteNavigationItemResult,
  websiteNavigationStaticHref,
  websitePageHomeHref,
  websiteSettingsResult,
  websiteStaticHomeHref,
  websiteWebFormHref,
  websiteWebViewHref,
  type ResolvedWebsiteSettings,
  type WebsiteNavigationItem
} from "./website-settings-policy.js";

export type { ResolvedWebsiteSettings, WebsiteNavigationItem } from "./website-settings-policy.js";

export interface WebsiteSettingsServiceOptions {
  readonly registry: ModelRegistry;
  readonly webPages: Pick<WebPageService, "getWebPageByRoute">;
  readonly webForms?: Pick<WebFormService, "getWebForm">;
  readonly webViews?: Pick<WebViewService, "getWebView">;
  readonly websiteThemes?: Pick<WebsiteThemeService, "getWebsiteTheme">;
}

export class WebsiteSettingsService {
  private readonly registry: ModelRegistry;
  private readonly webPages: Pick<WebPageService, "getWebPageByRoute">;
  private readonly webForms: Pick<WebFormService, "getWebForm"> | undefined;
  private readonly webViews: Pick<WebViewService, "getWebView"> | undefined;
  private readonly websiteThemes: Pick<WebsiteThemeService, "getWebsiteTheme"> | undefined;

  constructor(options: WebsiteSettingsServiceOptions) {
    this.registry = options.registry;
    this.webPages = options.webPages;
    this.webForms = options.webForms;
    this.webViews = options.webViews;
    this.websiteThemes = options.websiteThemes;
  }

  async getWebsiteSettings(actor: Actor): Promise<ResolvedWebsiteSettings> {
    const settings = this.readSettings(actor);
    const homePageHref = await this.homePageHref(actor, settings);
    const navItems = await Promise.all((settings.navItems ?? []).map((item) => this.resolveNavigationItem(actor, item)));
    const homePageRoute = visibleWebsiteHomePageRoute(settings, (route) => this.canReadPageRoute(actor, route));
    return websiteSettingsResult({
      settings,
      ...(homePageRoute === undefined ? {} : { homePageRoute }),
      ...(homePageHref === undefined ? {} : { homePageHref }),
      ...(settings.theme === undefined || this.websiteThemes === undefined
        ? {}
        : { theme: this.websiteThemes.getWebsiteTheme(settings.theme) }),
      navItems: navItems.flat()
    });
  }

  async getHomePageHref(actor: Actor): Promise<string> {
    const settings = this.readSettings(actor);
    const href = await this.homePageHref(actor, settings);
    if (href === undefined) {
      throw notFound("Website home page was not found", "WEBSITE_SETTINGS_NOT_FOUND");
    }
    return href;
  }

  getHomePageRoute(actor: Actor): string {
    const settings = this.readSettings(actor);
    const route = visibleWebsiteHomePageRoute(settings, (candidate) => this.canReadPageRoute(actor, candidate));
    if (route === undefined) {
      throw notFound("Website home page was not found", "WEBSITE_SETTINGS_NOT_FOUND");
    }
    return route;
  }

  private async homePageHref(actor: Actor, settings: WebsiteSettingsDefinition): Promise<string | undefined> {
    if (settings.homePageRoute !== undefined) {
      return websitePageHomeHref(settings, (route) => this.canReadPageRoute(actor, route));
    }
    if (settings.homePageWebForm !== undefined) {
      return this.webFormHref(actor, settings.homePageWebForm);
    }
    if (settings.homePageWebView !== undefined) {
      return this.webViewHref(actor, settings.homePageWebView);
    }
    return websiteStaticHomeHref(settings);
  }

  private readSettings(actor: Actor): WebsiteSettingsDefinition {
    const settings = this.registry.getWebsiteSettings();
    const decision = planWebsiteSettingsReadAccess({ actor, settings });
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
    }
    return settings;
  }

  private async resolveNavigationItem(
    actor: Actor,
    item: WebsiteNavigationItemDefinition
  ): Promise<readonly WebsiteNavigationItem[]> {
    if (!shouldResolveWebsiteNavigationItem(actor, item, (route) => this.canReadPageRoute(actor, route))) {
      return [];
    }
    const href = await this.navigationItemHref(actor, item);
    return websiteNavigationItemResult(item, href);
  }

  private async navigationItemHref(actor: Actor, item: WebsiteNavigationItemDefinition): Promise<string | undefined> {
    if (item.webForm !== undefined) {
      return this.webFormHref(actor, item.webForm);
    }
    if (item.webView !== undefined) {
      return this.webViewHref(actor, item.webView);
    }
    return websiteNavigationStaticHref(item);
  }

  private canReadPageRoute(actor: Actor, route: string | undefined): boolean {
    if (route === undefined) {
      return true;
    }
    try {
      this.webPages.getWebPageByRoute(actor, route);
      return true;
    } catch (error) {
      if (isExpectedWebsiteSettingsAccessMiss(error)) {
        return false;
      }
      throw error;
    }
  }

  private async webFormHref(actor: Actor, webFormName: string): Promise<string | undefined> {
    if (this.webForms === undefined) {
      return undefined;
    }
    try {
      const metadata = await this.webForms.getWebForm(actor, webFormName);
      return websiteWebFormHref(metadata.form);
    } catch (error) {
      if (isExpectedWebsiteSettingsAccessMiss(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async webViewHref(actor: Actor, webViewName: string): Promise<string | undefined> {
    if (this.webViews === undefined) {
      return undefined;
    }
    try {
      const metadata = await this.webViews.getWebView(actor, webViewName);
      return websiteWebViewHref(metadata.view);
    } catch (error) {
      if (isExpectedWebsiteSettingsAccessMiss(error)) {
        return undefined;
      }
      throw error;
    }
  }
}
