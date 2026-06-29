import type { WebFormDefinition } from "../core/web-form.js";
import type { WebViewDefinition } from "../core/web-view.js";
import {
  canReadWebsiteNavigationItem,
  canReadWebsiteSettings,
  websiteNavigationItemHref,
  type WebsiteNavigationItemDefinition,
  type WebsiteSettingsDefinition
} from "../core/website-settings.js";
import type { WebsiteThemeDefinition } from "../core/website-theme.js";
import type { Actor } from "../core/types.js";

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

export type WebsiteSettingsReadAccessDecision =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly message: string };

export function isPublishedWebsiteSettingsForActor(
  actor: Actor,
  settings: WebsiteSettingsDefinition
): boolean {
  return settings.published !== false && canReadWebsiteSettings(actor, settings);
}

export function planWebsiteSettingsReadAccess(command: {
  readonly actor: Actor;
  readonly settings: WebsiteSettingsDefinition;
}): WebsiteSettingsReadAccessDecision {
  return isPublishedWebsiteSettingsForActor(command.actor, command.settings)
    ? { status: "allow" }
    : {
        status: "deny",
        message: `Actor '${command.actor.id}' cannot read website settings`
      };
}

export function visibleWebsiteHomePageRoute(
  settings: WebsiteSettingsDefinition,
  canReadPageRoute: (route: string) => boolean
): string | undefined {
  return settings.homePageRoute !== undefined && canReadPageRoute(settings.homePageRoute)
    ? settings.homePageRoute
    : undefined;
}

export function websitePageHomeHref(
  settings: WebsiteSettingsDefinition,
  canReadPageRoute: (route: string) => boolean
): string | undefined {
  const route = visibleWebsiteHomePageRoute(settings, canReadPageRoute);
  return route === undefined ? undefined : `/page/${route}`;
}

export function websiteStaticHomeHref(settings: WebsiteSettingsDefinition): string | undefined {
  return settings.homePageHref;
}

export function shouldResolveWebsiteNavigationItem(
  actor: Actor,
  item: WebsiteNavigationItemDefinition,
  canReadPageRoute: (route: string) => boolean
): boolean {
  return canReadWebsiteNavigationItem(actor, item) &&
    (item.pageRoute === undefined || canReadPageRoute(item.pageRoute));
}

export function websiteNavigationStaticHref(item: WebsiteNavigationItemDefinition): string {
  return websiteNavigationItemHref(item);
}

export function websiteNavigationItemResult(
  item: WebsiteNavigationItemDefinition,
  href: string | undefined
): readonly WebsiteNavigationItem[] {
  return href === undefined
    ? []
    : [
        {
          name: item.name,
          label: item.label,
          href
        }
      ];
}

export function websiteWebFormHref(form: Pick<WebFormDefinition, "name" | "route">): string {
  return `/web-forms/${form.route ?? encodeURIComponent(form.name)}`;
}

export function websiteWebViewHref(view: Pick<WebViewDefinition, "name">): string {
  return `/web/${encodeURIComponent(view.name)}`;
}

export function websiteSettingsResult(options: {
  readonly settings: WebsiteSettingsDefinition;
  readonly homePageRoute?: string;
  readonly homePageHref?: string;
  readonly theme?: WebsiteThemeDefinition;
  readonly navItems: readonly WebsiteNavigationItem[];
}): ResolvedWebsiteSettings {
  return {
    title: options.settings.title,
    ...(options.settings.description === undefined ? {} : { description: options.settings.description }),
    ...(options.homePageRoute === undefined ? {} : { homePageRoute: options.homePageRoute }),
    ...(options.homePageHref === undefined ? {} : { homePageHref: options.homePageHref }),
    ...(options.theme === undefined ? {} : { theme: options.theme }),
    navItems: options.navItems
  };
}

export function isExpectedWebsiteSettingsAccessMiss(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "WEB_PAGE_NOT_FOUND" || error.code === "WEB_VIEW_NOT_FOUND" || error.code === "PERMISSION_DENIED");
}
