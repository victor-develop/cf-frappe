import { createRegistry, createRegistryFromApps, defineApp, defineWebsiteSettings, defineWebsiteTheme } from "../../src";

describe("metadata Website Themes", () => {
  it("freezes and registers safe website theme tokens", () => {
    const theme = defineWebsiteTheme({
      name: "Starter",
      label: "Starter",
      fontFamily: "Inter, system-ui",
      tokens: {
        primaryColor: "#2563eb",
        backgroundColor: "#ffffff",
        textColor: "#111827"
      }
    });
    const registry = createRegistry({ websiteThemes: [theme] });

    expect(Object.isFrozen(theme)).toBe(true);
    expect(Object.isFrozen(theme.tokens)).toBe(true);
    expect(registry.getWebsiteTheme("Starter")).toEqual(theme);
    expect(registry.listWebsiteThemes().map((item) => item.name)).toEqual(["Starter"]);
    expect(createRegistryFromApps([defineApp({ name: "website", websiteThemes: [theme] })]).getWebsiteTheme("Starter"))
      .toEqual(theme);
  });

  it("validates theme metadata and Website Settings references", () => {
    const theme = defineWebsiteTheme({ name: "Starter", tokens: { primaryColor: "#2563eb" } });

    expect(() => defineWebsiteTheme({ name: "", tokens: { primaryColor: "#2563eb" } })).toThrow("website theme name is required");
    expect(() => defineWebsiteTheme({ name: "Bad", tokens: { primaryColor: "blue" } })).toThrow("six-digit hex color");
    expect(() => defineWebsiteTheme({ name: "Bad", fontFamily: "Inter; color: red" })).toThrow("font family must be safe");
    expect(() => defineWebsiteTheme({ name: "Bad", fontFamily: '"Inter, system-ui' })).toThrow("font family must be safe");
    expect(() => createRegistry({ websiteThemes: [theme, theme] })).toThrow("already registered");
    expect(() => createRegistry({
      websiteThemes: [theme],
      websiteSettings: defineWebsiteSettings({ title: "Site", theme: "Missing" })
    })).toThrow("unknown Website Theme 'Missing'");
  });
});
