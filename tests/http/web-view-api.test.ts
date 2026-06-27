import {
  createRegistry,
  createResourceApi,
  defineDocType,
  defineWebView,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  unsafeHeaderActorResolver,
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
});
