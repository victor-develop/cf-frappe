import { canReadWebPage, type WebPageDefinition } from "../core/web-page.js";
import type { Actor } from "../core/types.js";

export type WebPageReadAccessDecision =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly message: string };

export type WebPageRouteLookupDecision =
  | { readonly status: "found"; readonly page: WebPageDefinition }
  | { readonly status: "not-found"; readonly message: string; readonly code: "WEB_PAGE_NOT_FOUND" };

export function planWebPageReadAccess(options: {
  readonly actor: Actor;
  readonly page: WebPageDefinition;
}): WebPageReadAccessDecision {
  if (options.page.published === false || !canReadWebPage(options.actor, options.page)) {
    return {
      status: "deny",
      message: `Actor '${options.actor.id}' cannot read web page '${options.page.name}'`
    };
  }
  return { status: "allow" };
}

export function planWebPageRouteLookup(options: {
  readonly pages: readonly WebPageDefinition[];
  readonly route: string;
}): WebPageRouteLookupDecision {
  const page = options.pages.find((candidate) => candidate.route === options.route);
  return page === undefined
    ? {
        status: "not-found",
        message: `Web page route '${options.route}' was not found`,
        code: "WEB_PAGE_NOT_FOUND"
      }
    : { status: "found", page };
}
