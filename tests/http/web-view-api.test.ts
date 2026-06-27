import {
  createRegistry,
  createResourceApi,
  defineDocType,
  defineWebPage,
  defineWebsiteSettings,
  defineWebsiteTheme,
  defineWebView,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  unsafeHeaderActorResolver,
  WebPageService,
  WebsiteSettingsService,
  WebsiteThemeService,
  WebViewService
} from "../../src";
import { now, owner } from "../helpers";

const defaultOwner = { ...owner, tenantId: "default" };

const articleDocType = defineDocType({
  name: "Article",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "route", type: "text", required: true },
    { name: "published", type: "boolean" },
    { name: "body", type: "longText" }
  ],
  permissions: [
    { roles: ["Guest"], actions: ["read"] },
    { roles: ["User"], actions: ["read", "create"] }
  ]
});

describe("web view api", () => {
  it("serves metadata, JSON items, and public HTML pages", async () => {
    const registry = createRegistry({
      doctypes: [articleDocType],
      webViews: [
        defineWebView({
          name: "Articles",
          label: "Articles",
          description: "Published articles",
          doctype: "Article",
          routeField: "route",
          titleField: "title",
          publishedField: "published",
          fields: [{ field: "body", label: "Body" }]
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webViews = new WebViewService({ registry, queries });
    const app = createResourceApi({
      registry,
      documents,
      queries,
      webViews,
      actor: unsafeHeaderActorResolver
    });

    await documents.create({
      actor: defaultOwner,
      doctype: "Article",
      data: { title: "<Launch>", route: "launch", published: true, body: "Hello <world>" }
    });
    await documents.create({
      actor: defaultOwner,
      doctype: "Article",
      data: { title: "Draft", route: "draft", published: false, body: "Hidden" }
    });

    const listed = await app.request("/api/meta/web-views");
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({ data: [{ name: "Articles", doctype: "Article" }] });

    const metadata = await app.request("/api/meta/web-views/Articles");
    expect(metadata.status).toBe(200);
    await expect(metadata.json()).resolves.toMatchObject({
      data: {
        view: { name: "Articles" },
        routeField: { field: "route" },
        fields: [{ field: "body", label: "Body" }]
      }
    });

    const items = await app.request("/api/web-view/Articles?limit=5");
    expect(items.status).toBe(200);
    await expect(items.json()).resolves.toMatchObject({
      data: {
        total: 1,
        items: [{ route: "launch", title: "<Launch>", data: { body: "Hello <world>" } }]
      }
    });

    const item = await app.request("/api/web-view/Articles/launch");
    expect(item.status).toBe(200);
    await expect(item.json()).resolves.toMatchObject({
      data: { item: { route: "launch", data: { body: "Hello <world>" } } }
    });

    const listPage = await app.request("/web/Articles");
    expect(listPage.status).toBe(200);
    const listHtml = await listPage.text();
    expect(listHtml).toContain("Published articles");
    expect(listHtml).toContain("&lt;Launch&gt;");

    const itemPage = await app.request("/web/Articles/launch");
    expect(itemPage.status).toBe(200);
    const itemHtml = await itemPage.text();
    expect(itemHtml).toContain("&lt;Launch&gt;");
    expect(itemHtml).toContain("Hello &lt;world&gt;");

    const draft = await app.request("/api/web-view/Articles/draft");
    expect(draft.status).toBe(404);
  });

  it("applies the active Website Theme to public Web View pages", async () => {
    const registry = createRegistry({
      doctypes: [articleDocType],
      webViews: [
        defineWebView({
          name: "Articles",
          label: "Articles",
          description: "Published articles",
          doctype: "Article",
          routeField: "route",
          titleField: "title",
          publishedField: "published",
          fields: [{ field: "body", label: "Body" }]
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
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webPages = new WebPageService({ registry });
    const app = createResourceApi({
      registry,
      documents,
      queries,
      webViews: new WebViewService({ registry, queries }),
      webPages,
      websiteSettings: new WebsiteSettingsService({
        registry,
        webPages,
        websiteThemes: new WebsiteThemeService({ registry })
      }),
      websiteThemes: new WebsiteThemeService({ registry }),
      actor: unsafeHeaderActorResolver
    });

    await documents.create({
      actor: defaultOwner,
      doctype: "Article",
      data: { title: "Launch", route: "launch", published: true, body: "Hello" }
    });

    const listPage = await app.request("/web/Articles");
    expect(listPage.status).toBe(200);
    const listHtml = await listPage.text();
    expect(listHtml).toContain("--cf-frappe-primary: #0f766e");
    expect(listHtml).toContain("--cf-frappe-background: #f8fafc");
    expect(listHtml).toContain("--cf-frappe-font-family: Inter, system-ui");

    const itemPage = await app.request("/web/Articles/launch");
    expect(itemPage.status).toBe(200);
    const itemHtml = await itemPage.text();
    expect(itemHtml).toContain("--cf-frappe-primary: #0f766e");
    expect(itemHtml).toContain("--cf-frappe-background: #f8fafc");
    expect(itemHtml).toContain("--cf-frappe-font-family: Inter, system-ui");
  });

  it("renders Website Settings navigation on public Web View pages", async () => {
    const registry = createRegistry({
      doctypes: [articleDocType],
      webPages: [
        defineWebPage({
          name: "About",
          route: "about",
          title: "About",
          sections: [{ body: "Welcome" }]
        }),
        defineWebPage({
          name: "Members",
          route: "members",
          title: "Members",
          roles: ["User"],
          sections: [{ body: "Private" }]
        })
      ],
      webViews: [
        defineWebView({
          name: "Articles",
          label: "Articles",
          doctype: "Article",
          routeField: "route",
          titleField: "title",
          publishedField: "published",
          fields: [{ field: "body", label: "Body" }]
        })
      ],
      websiteSettings: defineWebsiteSettings({
        title: "Starter Site",
        navItems: [
          { name: "about", label: "About", pageRoute: "about" },
          { name: "members", label: "Members", pageRoute: "members" },
          { name: "articles", label: "Articles", webView: "Articles" }
        ]
      })
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webPages = new WebPageService({ registry });
    const webViews = new WebViewService({ registry, queries });
    const app = createResourceApi({
      registry,
      documents,
      queries,
      webViews,
      webPages,
      websiteSettings: new WebsiteSettingsService({ registry, webPages, webViews }),
      actor: unsafeHeaderActorResolver
    });

    await documents.create({
      actor: defaultOwner,
      doctype: "Article",
      data: { title: "Launch", route: "launch", published: true, body: "Hello" }
    });

    const listPage = await app.request("/web/Articles");
    expect(listPage.status).toBe(200);
    const listHtml = await listPage.text();
    expect(listHtml).toContain('aria-label="Website navigation"');
    expect(listHtml).toContain('<a href="/page/about">About</a>');
    expect(listHtml).toContain('<a href="/web/Articles">Articles</a>');
    expect(listHtml).not.toContain('href="/page/members"');

    const itemPage = await app.request("/web/Articles/launch");
    expect(itemPage.status).toBe(200);
    const itemHtml = await itemPage.text();
    expect(itemHtml).toContain('aria-label="Website navigation"');
    expect(itemHtml).toContain('<a href="/web/Articles">Articles</a>');
    expect(itemHtml).not.toContain('href="/page/members"');
  });

  it("falls back to default Web View CSS when Website Settings cannot be read", async () => {
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
        doctypes: [articleDocType],
        webViews: [
          defineWebView({
            name: "Articles",
            label: "Articles",
            doctype: "Article",
            routeField: "route",
            titleField: "title",
            publishedField: "published",
            fields: [{ field: "body", label: "Body" }]
          })
        ],
        websiteThemes: [defineWebsiteTheme({ name: "Starter", tokens: { primaryColor: "#0f766e" } })],
        websiteSettings
      });
      const store = new InMemoryDocumentStore();
      const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
      const queries = new QueryService({ registry, projections: store });
      const webPages = new WebPageService({ registry });
      const app = createResourceApi({
        registry,
        documents,
        queries,
        webViews: new WebViewService({ registry, queries }),
        webPages,
        websiteSettings: new WebsiteSettingsService({
          registry,
          webPages,
          websiteThemes: new WebsiteThemeService({ registry })
        }),
        websiteThemes: new WebsiteThemeService({ registry }),
        actor: unsafeHeaderActorResolver
      });

      await documents.create({
        actor: defaultOwner,
        doctype: "Article",
        data: { title: "Launch", route: "launch", published: true, body: "Hello" }
      });

      const page = await app.request("/web/Articles");
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("--cf-frappe-primary: #2563eb");
      expect(html).not.toContain("--cf-frappe-primary: #0f766e");
      expect(html).not.toContain("Website navigation");
    }
  });

  it("renders public Web View pages with default CSS when Website Settings are absent", async () => {
    const registry = createRegistry({
      doctypes: [articleDocType],
      webViews: [
        defineWebView({
          name: "Articles",
          label: "Articles",
          doctype: "Article",
          routeField: "route",
          titleField: "title",
          publishedField: "published",
          fields: [{ field: "body", label: "Body" }]
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webPages = new WebPageService({ registry });
    const app = createResourceApi({
      registry,
      documents,
      queries,
      webViews: new WebViewService({ registry, queries }),
      webPages,
      websiteSettings: new WebsiteSettingsService({ registry, webPages }),
      actor: unsafeHeaderActorResolver
    });

    await documents.create({
      actor: defaultOwner,
      doctype: "Article",
      data: { title: "Launch", route: "launch", published: true, body: "Hello" }
    });

    const listPage = await app.request("/web/Articles");
    expect(listPage.status).toBe(200);
    const listHtml = await listPage.text();
    expect(listHtml).toContain("--cf-frappe-primary: #2563eb");
    expect(listHtml).not.toContain("Website navigation");

    const itemPage = await app.request("/web/Articles/launch");
    expect(itemPage.status).toBe(200);
    const itemHtml = await itemPage.text();
    expect(itemHtml).toContain("--cf-frappe-primary: #2563eb");
    expect(itemHtml).not.toContain("Website navigation");
  });
});
