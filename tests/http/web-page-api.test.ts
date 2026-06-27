import {
  createRegistry,
  createResourceApi,
  defineWebPage,
  defineWebsiteSettings,
  defineWebsiteTheme,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  unsafeHeaderActorResolver,
  WebPageService,
  WebsiteSettingsService,
  WebsiteThemeService
} from "../../src";
import { now } from "../helpers";

describe("web page api", () => {
  it("serves metadata and escaped public HTML pages", async () => {
    const registry = createRegistry({
      webPages: [
        defineWebPage({
          name: "About",
          route: "about/company",
          title: "About <Company>",
          description: "Public <story>",
          sections: [{ heading: "Mission", body: "Build <well>" }]
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const app = createResourceApi({
      registry,
      documents: new DocumentService({ registry, store, clock: fixedClock(now) }),
      queries: new QueryService({ registry, projections: store }),
      webPages: new WebPageService({ registry }),
      actor: unsafeHeaderActorResolver
    });

    const listed = await app.request("/api/meta/web-pages");
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({ data: [{ name: "About", route: "about/company" }] });

    const metadata = await app.request("/api/meta/web-pages/About");
    expect(metadata.status).toBe(200);
    await expect(metadata.json()).resolves.toMatchObject({ data: { title: "About <Company>" } });

    const page = await app.request("/page/about/company");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("About &lt;Company&gt;");
    expect(html).toContain("Public &lt;story&gt;");
    expect(html).toContain("Build &lt;well&gt;");
  });

  it("applies the active Website Theme to public HTML pages", async () => {
    const registry = createRegistry({
      webPages: [
        defineWebPage({
          name: "About",
          route: "about",
          title: "About",
          sections: [{ body: "Welcome" }]
        })
      ],
      websiteThemes: [
        defineWebsiteTheme({
          name: "Starter",
          fontFamily: "Inter, system-ui",
          tokens: {
            primaryColor: "#0f766e",
            backgroundColor: "#f8fafc",
            textColor: "#0f172a"
          }
        })
      ],
      websiteSettings: defineWebsiteSettings({
        title: "Starter Site",
        theme: "Starter"
      })
    });
    const store = new InMemoryDocumentStore();
    const app = createResourceApi({
      registry,
      documents: new DocumentService({ registry, store, clock: fixedClock(now) }),
      queries: new QueryService({ registry, projections: store }),
      webPages: new WebPageService({ registry }),
      websiteSettings: new WebsiteSettingsService({
        registry,
        webPages: new WebPageService({ registry }),
        websiteThemes: new WebsiteThemeService({ registry })
      }),
      websiteThemes: new WebsiteThemeService({ registry }),
      actor: unsafeHeaderActorResolver
    });

    const page = await app.request("/page/about");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("--cf-frappe-primary: #0f766e");
    expect(html).toContain("--cf-frappe-background: #f8fafc");
    expect(html).toContain("--cf-frappe-font-family: Inter, system-ui");
  });

  it("falls back to default page CSS when Website Settings cannot be read", async () => {
    for (const websiteSettings of [
      defineWebsiteSettings({
        title: "Draft Site",
        theme: "Starter",
        published: false
      }),
      defineWebsiteSettings({
        title: "Members Site",
        theme: "Starter",
        roles: ["User"]
      })
    ]) {
      const registry = createRegistry({
        webPages: [
          defineWebPage({
            name: "About",
            route: "about",
            title: "About",
            sections: [{ body: "Welcome" }]
          })
        ],
        websiteThemes: [defineWebsiteTheme({ name: "Starter", tokens: { primaryColor: "#0f766e" } })],
        websiteSettings
      });
      const store = new InMemoryDocumentStore();
      const webPages = new WebPageService({ registry });
      const app = createResourceApi({
        registry,
        documents: new DocumentService({ registry, store, clock: fixedClock(now) }),
        queries: new QueryService({ registry, projections: store }),
        webPages,
        websiteSettings: new WebsiteSettingsService({
          registry,
          webPages,
          websiteThemes: new WebsiteThemeService({ registry })
        }),
        websiteThemes: new WebsiteThemeService({ registry }),
        actor: unsafeHeaderActorResolver
      });

      const page = await app.request("/page/about");
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("--cf-frappe-primary: #2563eb");
      expect(html).not.toContain("--cf-frappe-primary: #0f766e");
    }
  });

  it("renders public pages with default CSS when Website Settings are absent", async () => {
    const registry = createRegistry({
      webPages: [
        defineWebPage({
          name: "About",
          route: "about",
          title: "About",
          sections: [{ body: "Welcome" }]
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const webPages = new WebPageService({ registry });
    const app = createResourceApi({
      registry,
      documents: new DocumentService({ registry, store, clock: fixedClock(now) }),
      queries: new QueryService({ registry, projections: store }),
      webPages,
      websiteSettings: new WebsiteSettingsService({ registry, webPages }),
      actor: unsafeHeaderActorResolver
    });

    const page = await app.request("/page/about");
    expect(page.status).toBe(200);
    await expect(page.text()).resolves.toContain("--cf-frappe-primary: #2563eb");
  });
});
