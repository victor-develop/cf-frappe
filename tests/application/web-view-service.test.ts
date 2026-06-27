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
