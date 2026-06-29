import { canReadWebPage, type WebPageDefinition } from "../core/web-page.js";
import type { Actor } from "../core/types.js";

export type WebPageReadAccessDecision =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly message: string };

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
