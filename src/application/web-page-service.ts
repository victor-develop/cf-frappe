import { notFound, permissionDenied } from "../core/errors.js";
import { canReadWebPage, type WebPageDefinition } from "../core/web-page.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor } from "../core/types.js";

export interface WebPageServiceOptions {
  readonly registry: ModelRegistry;
}

export class WebPageService {
  private readonly registry: ModelRegistry;

  constructor(options: WebPageServiceOptions) {
    this.registry = options.registry;
  }

  listWebPages(actor: Actor): readonly WebPageDefinition[] {
    return this.registry.listWebPages().filter((page) => page.published !== false && canReadWebPage(actor, page));
  }

  getWebPage(actor: Actor, pageName: string): WebPageDefinition {
    const page = this.registry.getWebPage(pageName);
    if (page.published === false || !canReadWebPage(actor, page)) {
      throw permissionDenied(`Actor '${actor.id}' cannot read web page '${page.name}'`);
    }
    return page;
  }

  getWebPageByRoute(actor: Actor, route: string): WebPageDefinition {
    const page = this.listWebPages(actor).find((candidate) => candidate.route === route);
    if (page === undefined) {
      throw notFound(`Web page route '${route}' was not found`, "WEB_PAGE_NOT_FOUND");
    }
    return page;
  }
}
