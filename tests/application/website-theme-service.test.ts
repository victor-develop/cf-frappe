import { createRegistry, defineWebsiteTheme, WebsiteThemeService } from "../../src";

describe("WebsiteThemeService", () => {
  it("lists and resolves manifest-owned Website Themes", () => {
    const registry = createRegistry({
      websiteThemes: [
        defineWebsiteTheme({ name: "Default", tokens: { primaryColor: "#2563eb" } }),
        defineWebsiteTheme({ name: "Starter", tokens: { backgroundColor: "#ffffff" } })
      ]
    });
    const themes = new WebsiteThemeService({ registry });

    expect(themes.listWebsiteThemes().map((theme) => theme.name)).toEqual(["Default", "Starter"]);
    expect(themes.getWebsiteTheme("Starter")).toMatchObject({ name: "Starter" });
  });
});
