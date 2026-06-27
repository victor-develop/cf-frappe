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
import type { WebPageService } from "./web-page-service.js";
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
  readonly theme?: WebsiteThemeDefinition;
  readonly navItems: readonly WebsiteNavigationItem[];
}

export interface WebsiteSettingsServiceOptions {
  readonly registry: ModelRegistry;
  readonly webPages: Pick<WebPageService, "getWebPageByRoute">;
  readonly websiteThemes?: Pick<WebsiteThemeService, "getWebsiteTheme">;
}

export class WebsiteSettingsService {
  private readonly registry: ModelRegistry;
  private readonly webPages: Pick<WebPageService, "getWebPageByRoute">;
  private readonly websiteThemes: Pick<WebsiteThemeService, "getWebsiteTheme"> | undefined;

  constructor(options: WebsiteSettingsServiceOptions) {
    this.registry = options.registry;
    this.webPages = options.webPages;
    this.websiteThemes = options.websiteThemes;
  }

  getWebsiteSettings(actor: Actor): ResolvedWebsiteSettings {
    const settings = this.readSettings(actor);
    return {
      title: settings.title,
      ...(settings.description === undefined ? {} : { description: settings.description }),
      ...(settings.homePageRoute !== undefined && this.canReadPageRoute(actor, settings.homePageRoute)
        ? { homePageRoute: settings.homePageRoute }
        : {}),
      ...(settings.theme === undefined || this.websiteThemes === undefined
        ? {}
        : { theme: this.websiteThemes.getWebsiteTheme(settings.theme) }),
      navItems: (settings.navItems ?? []).flatMap((item) => this.resolveNavigationItem(actor, item))
    };
  }

  getHomePageRoute(actor: Actor): string {
    const settings = this.readSettings(actor);
    if (settings.homePageRoute === undefined || !this.canReadPageRoute(actor, settings.homePageRoute)) {
      throw notFound("Website home page was not found", "WEBSITE_SETTINGS_NOT_FOUND");
    }
    return settings.homePageRoute;
  }

  private readSettings(actor: Actor): WebsiteSettingsDefinition {
    const settings = this.registry.getWebsiteSettings();
    if (settings.published === false || !canReadWebsiteSettings(actor, settings)) {
      throw permissionDenied(`Actor '${actor.id}' cannot read website settings`);
    }
    return settings;
  }

  private resolveNavigationItem(
    actor: Actor,
    item: WebsiteNavigationItemDefinition
  ): readonly WebsiteNavigationItem[] {
    if (!canReadWebsiteNavigationItem(actor, item) || !this.canReadPageRoute(actor, item.pageRoute)) {
      return [];
    }
    return [
      {
        name: item.name,
        label: item.label,
        href: websiteNavigationItemHref(item)
      }
    ];
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
}

function isExpectedAccessMiss(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "WEB_PAGE_NOT_FOUND" || error.code === "PERMISSION_DENIED");
}
