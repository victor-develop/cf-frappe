import { FrameworkError } from "./errors.js";
import { SYSTEM_MANAGER_ROLE, type Actor } from "./types.js";
import { isSafeWebsiteHref } from "./website-href.js";
import { isCanonicalWebPageRoute } from "./web-page.js";

export interface WebsiteNavigationItemDefinition {
  readonly name: string;
  readonly label: string;
  readonly pageRoute?: string;
  readonly webForm?: string;
  readonly webView?: string;
  readonly href?: string;
  readonly roles?: readonly string[];
}

export interface WebsiteSettingsDefinition {
  readonly title: string;
  readonly description?: string;
  readonly homePageRoute?: string;
  readonly homePageWebForm?: string;
  readonly homePageWebView?: string;
  readonly homePageHref?: string;
  readonly theme?: string;
  readonly published?: boolean;
  readonly roles?: readonly string[];
  readonly navItems?: readonly WebsiteNavigationItemDefinition[];
}

export function defineWebsiteSettings(definition: WebsiteSettingsDefinition): WebsiteSettingsDefinition {
  assertWebsiteSettingsDefinition(definition);
  return Object.freeze({
    ...definition,
    ...(definition.roles === undefined ? {} : { roles: Object.freeze([...definition.roles]) }),
    ...(definition.navItems === undefined
      ? {}
      : {
          navItems: Object.freeze(
            definition.navItems.map((item) =>
              Object.freeze({
                ...item,
                ...(item.roles === undefined ? {} : { roles: Object.freeze([...item.roles]) })
              })
            )
          )
        })
  });
}

export function assertWebsiteSettingsDefinition(definition: WebsiteSettingsDefinition): void {
  assertIdentifier(definition.title, "website title");
  assertHomepageTarget(definition);
  if (definition.theme !== undefined) {
    assertIdentifier(definition.theme, "website theme");
  }
  const seen = new Set<string>();
  for (const item of definition.navItems ?? []) {
    assertIdentifier(item.name, "website navigation item name");
    assertIdentifier(item.label, `website navigation item '${item.name}' label`);
    if (seen.has(item.name)) {
      throw new FrameworkError(
        "WEBSITE_SETTINGS_INVALID",
        `Website settings has duplicate navigation item '${item.name}'`,
        { status: 400 }
      );
    }
    seen.add(item.name);
    assertNavigationTarget(item);
  }
}

export function canReadWebsiteSettings(actor: Actor, settings: WebsiteSettingsDefinition): boolean {
  if (actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  return settings.roles === undefined || settings.roles.some((role) => actor.roles.includes(role));
}

export function canReadWebsiteNavigationItem(actor: Actor, item: WebsiteNavigationItemDefinition): boolean {
  if (actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  return item.roles === undefined || item.roles.some((role) => actor.roles.includes(role));
}

export function websiteNavigationItemHref(item: WebsiteNavigationItemDefinition): string {
  if (item.pageRoute !== undefined) {
    return `/page/${item.pageRoute}`;
  }
  if (item.webForm !== undefined) {
    return `/web-forms/${encodeURIComponent(item.webForm)}`;
  }
  if (item.webView !== undefined) {
    return `/web/${encodeURIComponent(item.webView)}`;
  }
  return item.href ?? "";
}

function assertHomepageTarget(definition: WebsiteSettingsDefinition): void {
  const targetCount = [
    definition.homePageRoute,
    definition.homePageWebForm,
    definition.homePageWebView,
    definition.homePageHref
  ].filter((target) => target !== undefined).length;
  if (targetCount > 1) {
    throw new FrameworkError(
      "WEBSITE_SETTINGS_INVALID",
      "Website settings homepage must define at most one of homePageRoute, homePageWebForm, homePageWebView, or homePageHref",
      { status: 400 }
    );
  }
  if (definition.homePageRoute !== undefined) {
    assertPageRoute(definition.homePageRoute, "website homepage route");
  }
  if (definition.homePageWebForm !== undefined) {
    assertIdentifier(definition.homePageWebForm, "website homepage Web Form");
  }
  if (definition.homePageWebView !== undefined) {
    assertIdentifier(definition.homePageWebView, "website homepage Web View");
  }
  if (definition.homePageHref !== undefined && !isSafeWebsiteHref(definition.homePageHref)) {
    throw new FrameworkError("WEBSITE_SETTINGS_INVALID", "Website settings homepage must define a safe href", {
      status: 400
    });
  }
}

function assertNavigationTarget(item: WebsiteNavigationItemDefinition): void {
  const targetCount = [item.pageRoute, item.webForm, item.webView, item.href].filter((target) => target !== undefined).length;
  if (targetCount !== 1) {
    throw new FrameworkError(
      "WEBSITE_SETTINGS_INVALID",
      `Website navigation item '${item.name}' must define exactly one of pageRoute, webForm, webView, or href`,
      { status: 400 }
    );
  }
  if (item.pageRoute !== undefined) {
    assertPageRoute(item.pageRoute, `website navigation item '${item.name}' page route`);
  }
  if (item.webForm !== undefined) {
    assertIdentifier(item.webForm, `website navigation item '${item.name}' Web Form`);
  }
  if (item.webView !== undefined) {
    assertIdentifier(item.webView, `website navigation item '${item.name}' Web View`);
  }
  if (item.href !== undefined && !isSafeWebsiteHref(item.href)) {
    throw new FrameworkError(
      "WEBSITE_SETTINGS_INVALID",
      `Website navigation item '${item.name}' must define a safe href`,
      { status: 400 }
    );
  }
}

function assertPageRoute(route: string, label: string): void {
  assertIdentifier(route, label);
  if (!isCanonicalWebPageRoute(route)) {
    throw new FrameworkError("WEBSITE_SETTINGS_INVALID", `${label} must be a safe canonical relative path`, {
      status: 400
    });
  }
}

function assertIdentifier(value: string, label: string): void {
  if (!value.trim()) {
    throw new FrameworkError("WEBSITE_SETTINGS_INVALID", `${label} is required`, { status: 400 });
  }
}
