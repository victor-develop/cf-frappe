import { notFound, permissionDenied } from "../core/errors.js";
import type { WebPageDefinition } from "../core/web-page.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor } from "../core/types.js";
import { planWebPageReadAccess, planWebPageRouteLookup } from "./web-page-policy.js";

export interface WebPageServiceOptions {
  readonly registry: ModelRegistry;
}

export class WebPageService {
  private readonly registry: ModelRegistry;

  constructor(options: WebPageServiceOptions) {
    this.registry = options.registry;
  }

  listWebPages(actor: Actor): readonly WebPageDefinition[] {
    return this.registry.listWebPages().filter((page) => planWebPageReadAccess({ actor, page }).status === "allow");
  }

  getWebPage(actor: Actor, pageName: string): WebPageDefinition {
    const page = this.registry.getWebPage(pageName);
    const decision = planWebPageReadAccess({ actor, page });
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
    }
    return page;
  }

  getWebPageByRoute(actor: Actor, route: string): WebPageDefinition {
    const lookup = planWebPageRouteLookup({ pages: this.listWebPages(actor), route });
    if (lookup.status === "not-found") {
      throw notFound(lookup.message, lookup.code);
    }
    return lookup.page;
  }
}
