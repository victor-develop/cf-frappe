import type { ModelRegistry } from "../core/registry.js";
import type { WebsiteThemeDefinition } from "../core/website-theme.js";

export interface WebsiteThemeServiceOptions {
  readonly registry: ModelRegistry;
}

export class WebsiteThemeService {
  private readonly registry: ModelRegistry;

  constructor(options: WebsiteThemeServiceOptions) {
    this.registry = options.registry;
  }

  listWebsiteThemes(): readonly WebsiteThemeDefinition[] {
    return this.registry.listWebsiteThemes();
  }

  getWebsiteTheme(themeName: string): WebsiteThemeDefinition {
    return this.registry.getWebsiteTheme(themeName);
  }
}
