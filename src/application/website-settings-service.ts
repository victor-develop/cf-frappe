import { notFound, permissionDenied } from "../core/errors.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor } from "../core/types.js";
import {
  canReadWebsiteNavigationItem,
  canReadWebsiteSettings,
  websiteNavigationItemHref,
  type WebsiteNavigationItemDefinition,
  type WebsiteSettingsDefinition
} from "../core/website-settings.js";
import type { WebsiteThemeDefinition } from "../core/website-theme.js";
import type { WebFormService } from "./web-form-service.js";
import type { WebPageService } from "./web-page-service.js";
import type { WebViewService } from "./web-view-service.js";
import type { WebsiteThemeService } from "./website-theme-service.js";

export interface WebsiteNavigationItem {
  readonly name: string;
  readonly label: string;
  readonly href: string;
}

export interface ResolvedWebsiteSettings {
  readonly title: string;
  readonly description?: string;
  readonly homePageRoute?: string;
  readonly homePageHref?: string;
  readonly theme?: WebsiteThemeDefinition;
  readonly navItems: readonly WebsiteNavigationItem[];
}

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
    return {
      title: settings.title,
      ...(settings.description === undefined ? {} : { description: settings.description }),
      ...(settings.homePageRoute !== undefined && this.canReadPageRoute(actor, settings.homePageRoute)
        ? { homePageRoute: settings.homePageRoute }
        : {}),
      ...(homePageHref === undefined ? {} : { homePageHref }),
      ...(settings.theme === undefined || this.websiteThemes === undefined
        ? {}
        : { theme: this.websiteThemes.getWebsiteTheme(settings.theme) }),
      navItems: navItems.flat()
    };
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
    if (settings.homePageRoute === undefined || !this.canReadPageRoute(actor, settings.homePageRoute)) {
      throw notFound("Website home page was not found", "WEBSITE_SETTINGS_NOT_FOUND");
    }
    return settings.homePageRoute;
  }

  private async homePageHref(actor: Actor, settings: WebsiteSettingsDefinition): Promise<string | undefined> {
    if (settings.homePageRoute !== undefined) {
      return this.canReadPageRoute(actor, settings.homePageRoute) ? `/page/${settings.homePageRoute}` : undefined;
    }
    if (settings.homePageWebForm !== undefined) {
      return this.webFormHref(actor, settings.homePageWebForm);
    }
    if (settings.homePageWebView !== undefined) {
      return this.webViewHref(actor, settings.homePageWebView);
    }
    return settings.homePageHref;
  }

  private readSettings(actor: Actor): WebsiteSettingsDefinition {
    const settings = this.registry.getWebsiteSettings();
    if (settings.published === false || !canReadWebsiteSettings(actor, settings)) {
      throw permissionDenied(`Actor '${actor.id}' cannot read website settings`);
    }
    return settings;
  }

  private async resolveNavigationItem(
    actor: Actor,
    item: WebsiteNavigationItemDefinition
  ): Promise<readonly WebsiteNavigationItem[]> {
    if (!canReadWebsiteNavigationItem(actor, item) || !this.canReadPageRoute(actor, item.pageRoute)) {
      return [];
    }
    const href = await this.navigationItemHref(actor, item);
    if (href === undefined) {
      return [];
    }
    return [
      {
        name: item.name,
        label: item.label,
        href
      }
    ];
  }

  private async navigationItemHref(actor: Actor, item: WebsiteNavigationItemDefinition): Promise<string | undefined> {
    if (item.webForm !== undefined) {
      return this.webFormHref(actor, item.webForm);
    }
    if (item.webView !== undefined) {
      return this.webViewHref(actor, item.webView);
    }
    return websiteNavigationItemHref(item);
  }

  private canReadPageRoute(actor: Actor, route: string | undefined): boolean {
    if (route === undefined) {
      return true;
    }
    try {
      this.webPages.getWebPageByRoute(actor, route);
      return true;
    } catch (error) {
      if (isExpectedAccessMiss(error)) {
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
      return `/web-forms/${metadata.form.route ?? encodeURIComponent(metadata.form.name)}`;
    } catch (error) {
      if (isExpectedAccessMiss(error)) {
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
      return `/web/${encodeURIComponent(metadata.view.name)}`;
    } catch (error) {
      if (isExpectedAccessMiss(error)) {
        return undefined;
      }
      throw error;
    }
  }
}

function isExpectedAccessMiss(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "WEB_PAGE_NOT_FOUND" || error.code === "WEB_VIEW_NOT_FOUND" || error.code === "PERMISSION_DENIED");
}
