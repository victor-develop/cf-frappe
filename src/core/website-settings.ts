import { FrameworkError } from "./errors.js";
import { SYSTEM_MANAGER_ROLE, type Actor } from "./types.js";
import { isCanonicalWebPageRoute } from "./web-page.js";

const PUBLIC_WEBSITE_HREF_PATTERN = /^\/(page|web|web-forms)\/[A-Za-z0-9][A-Za-z0-9._~%/-]*$/;

export interface WebsiteNavigationItemDefinition {
  readonly name: string;
  readonly label: string;
  readonly pageRoute?: string;
  readonly href?: string;
  readonly roles?: readonly string[];
}

export interface WebsiteSettingsDefinition {
  readonly title: string;
  readonly description?: string;
  readonly homePageRoute?: string;
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
  if (definition.homePageRoute !== undefined) {
    assertPageRoute(definition.homePageRoute, "website homepage route");
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
  return item.pageRoute === undefined ? item.href ?? "" : `/page/${item.pageRoute}`;
}

function assertNavigationTarget(item: WebsiteNavigationItemDefinition): void {
  const hasPageRoute = item.pageRoute !== undefined;
  const hasHref = item.href !== undefined;
  if (hasPageRoute === hasHref) {
    throw new FrameworkError(
      "WEBSITE_SETTINGS_INVALID",
      `Website navigation item '${item.name}' must define exactly one of pageRoute or href`,
      { status: 400 }
    );
  }
  if (item.pageRoute !== undefined) {
    assertPageRoute(item.pageRoute, `website navigation item '${item.name}' page route`);
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

function isSafeWebsiteHref(value: string): boolean {
  if (value.startsWith("/")) {
    return PUBLIC_WEBSITE_HREF_PATTERN.test(value) &&
      !value.includes("..") &&
      !value.includes("\\") &&
      !value.includes("?") &&
      !value.includes("#") &&
      !/\s/.test(value);
  }
  if (!value.startsWith("https://") && !value.startsWith("http://")) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
