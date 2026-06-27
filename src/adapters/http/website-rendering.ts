import type { WebsiteSettingsService } from "../../application/website-settings-service.js";
import type { Actor } from "../../core/types.js";
import type { WebsiteThemeDefinition } from "../../core/website-theme.js";

export type WebsiteSettingsReader = Pick<WebsiteSettingsService, "getWebsiteSettings">;

export function websitePage(title: string, body: string, theme: WebsiteThemeDefinition | undefined): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
${themeCss(theme)}body { margin: 0; font: 15px/1.6 var(--cf-frappe-font-family); color: var(--cf-frappe-text); background: var(--cf-frappe-background); }
main { width: min(760px, calc(100vw - 32px)); margin: 40px auto; }
h1 { margin: 0 0 16px; font-size: 34px; line-height: 1.15; color: var(--cf-frappe-heading); }
h2 { margin: 28px 0 8px; font-size: 18px; color: var(--cf-frappe-heading); }
p, li { color: var(--cf-frappe-muted-text); white-space: pre-wrap; }
ul { display: grid; gap: 12px; padding-left: 20px; }
a { color: var(--cf-frappe-link); }
</style></head><body>${body}</body></html>`;
}

export function resolveWebsiteTheme(
  settings: WebsiteSettingsReader | undefined,
  actor: Actor
): WebsiteThemeDefinition | undefined {
  try {
    return settings?.getWebsiteSettings(actor).theme;
  } catch (error) {
    if (isExpectedSettingsMiss(error)) {
      return undefined;
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
