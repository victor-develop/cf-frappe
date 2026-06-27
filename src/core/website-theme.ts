import { FrameworkError } from "./errors.js";

export interface WebsiteThemeTokens {
  readonly primaryColor?: string;
  readonly backgroundColor?: string;
  readonly surfaceColor?: string;
  readonly textColor?: string;
  readonly mutedTextColor?: string;
  readonly headingColor?: string;
  readonly linkColor?: string;
}

export interface WebsiteThemeDefinition {
  readonly name: string;
  readonly label?: string;
  readonly description?: string;
  readonly fontFamily?: string;
  readonly tokens?: WebsiteThemeTokens;
}

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const UNQUOTED_FONT_FAMILY_PATTERN = /^[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*$/;
const QUOTED_FONT_FAMILY_PATTERN = /^(?:"[A-Za-z0-9 _-]+"|'[A-Za-z0-9 _-]+')$/;

export function defineWebsiteTheme(definition: WebsiteThemeDefinition): WebsiteThemeDefinition {
  assertWebsiteThemeDefinition(definition);
  return Object.freeze({
    ...definition,
    ...(definition.tokens === undefined ? {} : { tokens: Object.freeze({ ...definition.tokens }) })
  });
}

export function assertWebsiteThemeDefinition(definition: WebsiteThemeDefinition): void {
  assertIdentifier(definition.name, "website theme name");
  if (definition.fontFamily !== undefined) {
    assertFontFamily(definition.name, definition.fontFamily);
  }
  for (const [token, value] of Object.entries(definition.tokens ?? {})) {
    if (!HEX_COLOR_PATTERN.test(value)) {
      throw new FrameworkError(
        "WEBSITE_THEME_INVALID",
        `Website theme '${definition.name}' token '${token}' must be a six-digit hex color`,
        { status: 400 }
      );
    }
  }
}

function assertIdentifier(value: string, label: string): void {
  if (!value.trim()) {
    throw new FrameworkError("WEBSITE_THEME_INVALID", `${label} is required`, { status: 400 });
  }
}

function assertFontFamily(themeName: string, value: string): void {
  const families = value.split(",").map((family) => family.trim());
  if (families.length === 0 || families.some((family) => !isSafeFontFamily(family))) {
    throw new FrameworkError("WEBSITE_THEME_INVALID", `Website theme '${themeName}' font family must be safe text`, {
      status: 400
    });
  }
}

function isSafeFontFamily(value: string): boolean {
  return UNQUOTED_FONT_FAMILY_PATTERN.test(value) || QUOTED_FONT_FAMILY_PATTERN.test(value);
}
