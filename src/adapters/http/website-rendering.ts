import type { ResolvedWebsiteSettings, WebsiteSettingsService } from "../../application/website-settings-service.js";
import type { Actor } from "../../core/types.js";
import type { WebsiteThemeDefinition } from "../../core/website-theme.js";

export type WebsiteSettingsReader = Pick<WebsiteSettingsService, "getWebsiteSettings">;

export interface WebsitePresentation {
  readonly theme?: WebsiteThemeDefinition;
  readonly navItems: ResolvedWebsiteSettings["navItems"];
}

const DEFAULT_WEBSITE_PRESENTATION: WebsitePresentation = Object.freeze({ navItems: Object.freeze([]) });

export function websitePage(title: string, body: string, presentation: WebsitePresentation | undefined): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
${themeCss(presentation?.theme)}body { margin: 0; font: 15px/1.6 var(--cf-frappe-font-family); color: var(--cf-frappe-text); background: var(--cf-frappe-background); }
.site-nav { border-bottom: 1px solid color-mix(in srgb, var(--cf-frappe-muted-text) 18%, transparent); background: var(--cf-frappe-surface); }
.site-nav__inner { width: min(960px, calc(100vw - 32px)); margin: 0 auto; min-height: 56px; display: flex; align-items: center; justify-content: flex-end; gap: 18px; flex-wrap: wrap; }
.site-nav a { font-weight: 600; text-decoration: none; }
main { width: min(760px, calc(100vw - 32px)); margin: 40px auto; }
h1 { margin: 0 0 16px; font-size: 34px; line-height: 1.15; color: var(--cf-frappe-heading); }
h2 { margin: 28px 0 8px; font-size: 18px; color: var(--cf-frappe-heading); }
p, li { color: var(--cf-frappe-muted-text); white-space: pre-wrap; }
ul { display: grid; gap: 12px; padding-left: 20px; }
a { color: var(--cf-frappe-link); }
</style></head><body>${renderNavigation(presentation)}${body}</body></html>`;
}

export function resolveWebsitePresentation(
  settings: WebsiteSettingsReader | undefined,
  actor: Actor
): WebsitePresentation {
  try {
    const resolved = settings?.getWebsiteSettings(actor);
    return resolved === undefined
      ? DEFAULT_WEBSITE_PRESENTATION
      : {
          ...(resolved.theme === undefined ? {} : { theme: resolved.theme }),
          navItems: resolved.navItems
        };
  } catch (error) {
    if (isExpectedSettingsMiss(error)) {
      return DEFAULT_WEBSITE_PRESENTATION;
    }
    throw error;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderNavigation(presentation: WebsitePresentation | undefined): string {
  const navItems = presentation?.navItems ?? [];
  if (navItems.length === 0) {
    return "";
  }
  const items = navItems
    .map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`)
    .join("");
  return `<nav class="site-nav" aria-label="Website navigation"><div class="site-nav__inner">${items}</div></nav>`;
}

function themeCss(theme: WebsiteThemeDefinition | undefined): string {
  const tokens = theme?.tokens;
  return `:root {
  --cf-frappe-font-family: ${theme?.fontFamily ?? 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'};
  --cf-frappe-primary: ${tokens?.primaryColor ?? "#2563eb"};
  --cf-frappe-background: ${tokens?.backgroundColor ?? "#f9fafb"};
  --cf-frappe-surface: ${tokens?.surfaceColor ?? "#ffffff"};
  --cf-frappe-text: ${tokens?.textColor ?? "#111827"};
  --cf-frappe-muted-text: ${tokens?.mutedTextColor ?? "#374151"};
  --cf-frappe-heading: ${tokens?.headingColor ?? tokens?.textColor ?? "#111827"};
  --cf-frappe-link: ${tokens?.linkColor ?? tokens?.primaryColor ?? "#2563eb"};
}
`;
}

function isExpectedSettingsMiss(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "WEBSITE_SETTINGS_NOT_FOUND" || error.code === "PERMISSION_DENIED");
}
