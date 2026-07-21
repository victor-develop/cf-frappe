import {
  createRegistry,
  defineDocType,
  defineWebView,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  WebViewService
} from "../../src";
import type { Actor, DocTypeDefinition } from "../../src";
import { guest, now, owner } from "../helpers";

const BlogPost = defineDocType({
  name: "Blog Post",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "route", type: "text" },
    { name: "published", type: "boolean", defaultValue: false },
    { name: "audience", type: "select", options: ["Public", "Internal"] },
    { name: "summary", type: "longText" },
    { name: "internal_notes", type: "text" }
  ],
  permissions: [
    { roles: ["Guest"], actions: ["read"] },
    { roles: ["User"], actions: ["read", "create"] }
  ]
});

describe("WebViewService", () => {
  it("lists and resolves published items through permissioned projections", async () => {
    const registry = createRegistry({
      doctypes: [BlogPost],
      webViews: [
        defineWebView({
          name: "Blog",
          label: "Blog",
          doctype: "Blog Post",
          routeField: "route",
          titleField: "title",
          publishedField: "published",
          fields: [{ field: "summary", label: "Summary" }],
          roles: ["Guest"],
          pageSize: 10
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webViews = new WebViewService({ registry, queries });

    await documents.create({
      actor: owner,
      doctype: "Blog Post",
      data: {
        title: "Published Post",
        route: "docs/published-post",
        published: true,
        summary: "Visible summary",
        internal_notes: "not exposed"
      }
    });
    await documents.create({
      actor: owner,
      doctype: "Blog Post",
      data: {
        title: "Draft Post",
        route: "draft-post",
        published: false,
        summary: "Hidden summary"
      }
    });
    await documents.create({
      actor: owner,
      doctype: "Blog Post",
      data: {
        title: "Missing Route",
        route: "",
        published: true,
        summary: "No route"
      }
    });
    await documents.create({
      actor: owner,
      doctype: "Blog Post",
      data: {
        title: "Unsafe Route",
        route: "../admin",
        published: true,
        summary: "Hidden unsafe route"
      }
    });

    await expect(webViews.listWebViews(guest)).resolves.toMatchObject([{ name: "Blog" }]);
    await expect(webViews.getWebView(guest, "Blog")).resolves.toMatchObject({
      view: { name: "Blog" },
      doctype: "Blog Post",
      routeField: { field: "route", type: "text" },
      titleField: { field: "title", type: "text" },
      publishedField: { field: "published", type: "boolean" },
      fields: [{ field: "summary", label: "Summary", type: "longText" }]
    });

    await expect(webViews.listItems(guest, "Blog")).resolves.toMatchObject({
      total: 1,
      items: [
        {
          doctype: "Blog Post",
          name: "Published Post",
          route: "docs/published-post",
          title: "Published Post",
          data: { summary: "Visible summary" }
        }
      ]
    });
    await expect(webViews.getItem(guest, "Blog", "docs/published-post")).resolves.toMatchObject({
      item: { title: "Published Post", data: { summary: "Visible summary" } }
    });
    await expect(webViews.getItem(guest, "Blog", "../admin")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(webViews.getItem(guest, "Blog", "draft-post")).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });

  it("hides views when view roles or DocType read permissions fail", async () => {
    const registry = createRegistry({
      doctypes: [BlogPost],
      webViews: [
        defineWebView({
          name: "Members Blog",
          roles: ["User"],
          doctype: "Blog Post",
          routeField: "route",
          titleField: "title"
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const queries = new QueryService({ registry, projections: store });
    const webViews = new WebViewService({ registry, queries });

    await expect(webViews.listWebViews(guest)).resolves.toEqual([]);
    await expect(webViews.getWebView(guest, "Members Blog")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(webViews.getWebView(owner, "Members Blog")).resolves.toMatchObject({ view: { name: "Members Blog" } });
  });

  it("paginates over visible safe item routes", async () => {
    const registry = createRegistry({
      doctypes: [BlogPost],
      webViews: [
        defineWebView({
          name: "Blog",
          doctype: "Blog Post",
          routeField: "route",
          titleField: "title",
          publishedField: "published",
          pageSize: 2
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webViews = new WebViewService({ registry, queries });

    for (const data of [
      { title: "First", route: "first", published: true },
      { title: "Unsafe", route: "../unsafe", published: true },
      { title: "Second", route: "second", published: true },
      { title: "Third", route: "third", published: true }
    ]) {
      await documents.create({ actor: owner, doctype: "Blog Post", data });
    }

    await expect(webViews.listItems(guest, "Blog", { limit: 1, offset: 1 })).resolves.toMatchObject({
      total: 3,
      totalIsExact: false,
      limit: 1,
      offset: 1,
      hasMore: true,
      nextOffset: 2,
      items: [{ route: "second", title: "Second" }]
    });
    await expect(webViews.listItems(guest, "Blog", { limit: 2, offset: 2 })).resolves.toMatchObject({
      total: 3,
      totalIsExact: true,
      limit: 2,
      offset: 2,
      hasMore: false,
      items: [{ route: "third", title: "Third" }]
    });
  });

  it("orders Web View items through metadata before safe pagination", async () => {
    const registry = createRegistry({
      doctypes: [BlogPost],
      webViews: [
        defineWebView({
          name: "Blog",
          doctype: "Blog Post",
          routeField: "route",
          titleField: "title",
          publishedField: "published",
          orderBy: "title",
          order: "asc",
          pageSize: 2
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webViews = new WebViewService({ registry, queries });

    for (const data of [
      { title: "Zulu", route: "zulu", published: true },
      { title: "Alpha", route: "alpha", published: true },
      { title: "Middle", route: "../unsafe", published: true },
      { title: "Bravo", route: "bravo", published: true }
    ]) {
      await documents.create({ actor: owner, doctype: "Blog Post", data });
    }

    await expect(webViews.listItems(guest, "Blog", { limit: 2 })).resolves.toMatchObject({
      items: [
        { route: "alpha", title: "Alpha" },
        { route: "bravo", title: "Bravo" }
      ],
      hasMore: true,
      nextOffset: 2
    });
    await expect(webViews.listItems(guest, "Blog", { limit: 2, offset: 2 })).resolves.toMatchObject({
      items: [{ route: "zulu", title: "Zulu" }],
      hasMore: false
    });
  });

  it("applies metadata filters to Web View list and detail items", async () => {
    const registry = createRegistry({
      doctypes: [BlogPost],
      webViews: [
        defineWebView({
          name: "Blog",
          doctype: "Blog Post",
          routeField: "route",
          titleField: "title",
          publishedField: "published",
          filters: [{ field: "audience", value: "Public" }],
          orderBy: "title",
          order: "asc"
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webViews = new WebViewService({ registry, queries });

    await documents.create({
      actor: owner,
      doctype: "Blog Post",
      data: { title: "Public Launch", route: "public-launch", published: true, audience: "Public" }
    });
    await documents.create({
      actor: owner,
      doctype: "Blog Post",
      data: { title: "Internal Launch", route: "internal-launch", published: true, audience: "Internal" }
    });
    await documents.create({
      actor: owner,
      doctype: "Blog Post",
      data: { title: "Public Draft", route: "public-draft", published: false, audience: "Public" }
    });

    await expect(webViews.listItems(guest, "Blog")).resolves.toMatchObject({
      total: 1,
      items: [{ route: "public-launch", title: "Public Launch" }]
    });
    await expect(webViews.getItem(guest, "Blog", "public-launch")).resolves.toMatchObject({
      item: { route: "public-launch", title: "Public Launch" }
    });
    await expect(webViews.getItem(guest, "Blog", "internal-launch")).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND"
    });
    await expect(webViews.getItem(guest, "Blog", "public-draft")).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND"
    });
  });

  it("applies metadata filter expressions with published and route filters", async () => {
    const registry = createRegistry({
      doctypes: [BlogPost],
      webViews: [
        defineWebView({
          name: "Blog",
          doctype: "Blog Post",
          routeField: "route",
          titleField: "title",
          publishedField: "published",
          filters: [{ field: "audience", value: "Public" }],
          filterExpression: {
            kind: "group",
            match: "any",
            filters: [
              { field: "title", operator: "contains", value: "Launch" },
              { field: "title", operator: "contains", value: "Guide" }
            ]
          },
          orderBy: "title",
          order: "asc"
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webViews = new WebViewService({ registry, queries });

    for (const data of [
      { title: "Public Changelog", route: "public-changelog", published: true, audience: "Public" },
      { title: "Public Guide", route: "public-guide", published: true, audience: "Public" },
      { title: "Public Launch", route: "public-launch", published: true, audience: "Public" },
      { title: "Internal Guide", route: "internal-guide", published: true, audience: "Internal" },
      { title: "Public Draft Guide", route: "public-draft-guide", published: false, audience: "Public" }
    ]) {
      await documents.create({ actor: owner, doctype: "Blog Post", data });
    }

    await expect(webViews.listItems(guest, "Blog")).resolves.toMatchObject({
      total: 2,
      items: [
        { route: "public-guide", title: "Public Guide" },
        { route: "public-launch", title: "Public Launch" }
      ]
    });
    await expect(webViews.getItem(guest, "Blog", "public-guide")).resolves.toMatchObject({
      item: { route: "public-guide", title: "Public Guide" }
    });
    await expect(webViews.getItem(guest, "Blog", "public-changelog")).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND"
    });
    await expect(webViews.getItem(guest, "Blog", "internal-guide")).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND"
    });
    await expect(webViews.getItem(guest, "Blog", "public-draft-guide")).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND"
    });
  });

  it("rejects Web View pagination that exceeds the bounded projection scan budget", async () => {
    const registry = createRegistry({
      doctypes: [BlogPost],
      webViews: [
        defineWebView({
          name: "Blog",
          doctype: "Blog Post",
          routeField: "route",
          titleField: "title",
          publishedField: "published"
        })
      ]
    });
    const listDocuments = vi.fn(async (
      _actor: Actor,
      _doctype: string,
      options: { readonly limit?: number; readonly offset?: number } = {}
    ) => ({
      data: [],
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
      total: 10_000
    }));
    const queries = {
      getEffectiveMeta: async () => BlogPost,
      listDocuments
    } as unknown as QueryService;
    const webViews = new WebViewService({ registry, queries });

    await expect(webViews.listItems(guest, "Blog", { limit: 1, offset: 500 })).rejects.toMatchObject({
      code: "BAD_REQUEST"
    });
    expect(listDocuments).toHaveBeenCalledTimes(50);
  });

  it("validates fields against effective read metadata", async () => {
    const registry = createRegistry({
      doctypes: [BlogPost],
      webViews: [
        defineWebView({
          name: "Blog",
          doctype: "Blog Post",
          routeField: "route",
          titleField: "title",
          fields: [{ field: "summary" }]
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const queries = new QueryService({
      registry,
      projections: store,
      doctypeResolver: hideSummaryForTenant
    });
    const webViews = new WebViewService({ registry, queries });

    await expect(webViews.getWebView({ ...guest, tenantId: "acme" }, "Blog")).rejects.toMatchObject({
      code: "WEB_VIEW_INVALID"
    });
  });

  it("hides Web Views that reference fields denied by field-level read permissions", async () => {
    const FieldAclPost = defineDocType({
      name: "Field ACL Post",
      naming: { kind: "field", field: "title" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "route", type: "text" },
        { name: "published", type: "boolean", defaultValue: false },
        {
          name: "secret_summary",
          type: "longText",
          permissions: [{ roles: ["User"], actions: ["read", "create"] }]
        }
      ],
      permissions: [
        { roles: ["Guest"], actions: ["read"] },
        { roles: ["User"], actions: ["read", "create"] }
      ]
    });
    const registry = createRegistry({
      doctypes: [FieldAclPost],
      webViews: [
        defineWebView({
          name: "Field ACL Blog",
          doctype: "Field ACL Post",
          routeField: "route",
          titleField: "title",
          publishedField: "published",
          fields: [{ field: "secret_summary" }],
          roles: ["Guest"]
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webViews = new WebViewService({ registry, queries });

    await documents.create({
      actor: owner,
      doctype: "Field ACL Post",
      data: {
        title: "Published ACL Post",
        route: "published-acl-post",
        published: true,
        secret_summary: "Guest must not see this"
      }
    });

    await expect(webViews.listWebViews(guest)).resolves.toEqual([]);
    await expect(webViews.getWebView(guest, "Field ACL Blog")).rejects.toMatchObject({
      code: "WEB_VIEW_INVALID"
    });
  });
});

function hideSummaryForTenant(
  base: DocTypeDefinition,
  context: { readonly actor: Actor; readonly tenantId: string }
): DocTypeDefinition {
  if (context.tenantId !== "acme") {
    return base;
  }
  return {
    ...base,
    fields: base.fields.map((field) => field.name === "summary" ? { ...field, hidden: true } : field)
  };
}
