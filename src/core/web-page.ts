import { FrameworkError } from "./errors.js";
import { SYSTEM_MANAGER_ROLE, type Actor } from "./types.js";

const WEB_PAGE_ROUTE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*(\/[A-Za-z0-9][A-Za-z0-9._~-]*)*$/;

export interface WebPageSectionDefinition {
  readonly heading?: string;
  readonly body: string;
}

export interface WebPageDefinition {
  readonly name: string;
  readonly route: string;
  readonly title: string;
  readonly module?: string;
  readonly description?: string;
  readonly roles?: readonly string[];
  readonly published?: boolean;
  readonly sections: readonly WebPageSectionDefinition[];
}

export function defineWebPage(definition: WebPageDefinition): WebPageDefinition {
  assertWebPageDefinition(definition);
  return Object.freeze({
    ...definition,
    ...(definition.roles === undefined ? {} : { roles: Object.freeze([...definition.roles]) }),
    sections: Object.freeze(definition.sections.map((section) => Object.freeze({ ...section })))
  });
}

export function assertWebPageDefinition(definition: WebPageDefinition): void {
  assertIdentifier(definition.name, "web page name");
  assertIdentifier(definition.title, `web page '${definition.name}' title`);
  assertRoute(definition.route, definition.name);
  if (!Array.isArray(definition.sections) || definition.sections.length === 0) {
    throw new FrameworkError("WEB_PAGE_INVALID", `Web page '${definition.name}' sections must not be empty`, {
      status: 400
    });
  }
  for (const section of definition.sections) {
    if (section.heading !== undefined) {
      assertIdentifier(section.heading, `web page '${definition.name}' section heading`);
    }
    assertIdentifier(section.body, `web page '${definition.name}' section body`);
  }
}

export function canReadWebPage(actor: Actor, page: WebPageDefinition): boolean {
  if (actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  return page.roles === undefined || page.roles.some((role) => actor.roles.includes(role));
}

function assertRoute(route: string, pageName: string): void {
  assertIdentifier(route, `web page '${pageName}' route`);
  if (!WEB_PAGE_ROUTE_PATTERN.test(route) || route.includes("..")) {
    throw new FrameworkError("WEB_PAGE_INVALID", `Web page '${pageName}' route must be a safe canonical relative path`, {
      status: 400
    });
  }
}

function assertIdentifier(value: string, label: string): void {
  if (!value.trim()) {
    throw new FrameworkError("WEB_PAGE_INVALID", `${label} is required`, { status: 400 });
  }
}
