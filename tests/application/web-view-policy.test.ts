import {
  clampWebViewLimit,
  clampWebViewOffset,
  defineDocType,
  defineWebView,
  resolveWebViewMetadata,
  webViewFilterExpressionOption,
  webViewFilters,
  webViewItemFromDocument,
  webViewListResult,
  webViewOrderOptions,
  webViewPageLimit,
  webViewRouteFilters,
  type DocumentSnapshot
} from "../../src";

const BlogPost = defineDocType({
  name: "Blog Post",
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "route", type: "text", label: "Route" },
    { name: "published", type: "boolean", label: "Published" },
    { name: "audience", type: "select", options: ["Public", "Internal"] },
    { name: "summary", type: "longText", label: "Summary" }
  ]
});

const BlogView = defineWebView({
  name: "Blog",
  doctype: "Blog Post",
  routeField: "route",
  titleField: "title",
  publishedField: "published",
  fields: [{ field: "summary", label: "Teaser" }],
  filters: [{ field: "audience", value: "Public" }],
  filterExpression: { field: "title", operator: "contains", value: "Launch" },
  orderBy: "title",
  order: "asc",
  pageSize: 10
});

describe("web view policy", () => {
  it("resolves Web View metadata fields from effective DocType metadata", () => {
    expect(resolveWebViewMetadata(BlogView, BlogPost)).toEqual({
      view: BlogView,
      doctype: "Blog Post",
      routeField: { field: "route", label: "Route", type: "text" },
      titleField: { field: "title", label: "Title", type: "text" },
      publishedField: { field: "published", label: "Published", type: "boolean" },
      fields: [{ field: "summary", label: "Teaser", type: "longText" }]
    });
  });

  it("builds published, route, filter-expression, and ordering query options", () => {
    const metadata = resolveWebViewMetadata(BlogView, BlogPost);

    expect(webViewFilters(metadata)).toEqual([
      { field: "audience", value: "Public" },
      { field: "published", value: true }
    ]);
    expect(webViewRouteFilters(metadata, "launch")).toEqual([
      { field: "audience", value: "Public" },
      { field: "published", value: true },
      { field: "route", value: "launch" }
    ]);
    expect(webViewFilterExpressionOption(BlogView)).toEqual({
      filterExpression: { field: "title", operator: "contains", value: "Launch" }
    });
    expect(webViewOrderOptions(BlogView)).toEqual({ orderBy: "title", order: "asc" });
  });

  it("clamps list limits and offsets to configured and hard bounds", () => {
    expect(clampWebViewLimit(undefined, 25)).toBe(25);
    expect(clampWebViewLimit(5, 25)).toBe(5);
    expect(clampWebViewLimit(500, 250)).toBe(200);
    expect(clampWebViewLimit(0, 25)).toBe(25);
    expect(clampWebViewOffset(undefined)).toBe(0);
    expect(clampWebViewOffset(10)).toBe(10);
    expect(clampWebViewOffset(-1)).toBe(0);
    expect(clampWebViewOffset(1.5)).toBe(0);
  });

  it("bounds page scan sizes and rejects exhausted scan budgets", () => {
    expect(webViewPageLimit(1, 0)).toBe(20);
    expect(webViewPageLimit(100, 950)).toBe(50);
    expect(() => webViewPageLimit(1, 1_000)).toThrow(
      "Web view pagination scanned more than 1000 documents"
    );
  });

  it("projects safe routed documents into public Web View items", () => {
    const metadata = resolveWebViewMetadata(BlogView, BlogPost);

    expect(webViewItemFromDocument(metadata, document({
      title: "Published Launch",
      route: "docs/published-launch",
      published: true,
      audience: "Public",
      summary: "Visible summary"
    }))).toEqual({
      doctype: "Blog Post",
      name: "Published Launch",
      route: "docs/published-launch",
      title: "Published Launch",
      data: { summary: "Visible summary" }
    });
  });

  it("omits unsafe routes and falls back to document names for blank titles", () => {
    const metadata = resolveWebViewMetadata(BlogView, BlogPost);

    expect(webViewItemFromDocument(metadata, document({ title: "Unsafe", route: "../admin" }))).toBeUndefined();
    expect(webViewItemFromDocument(metadata, document({ title: "Missing", route: "" }))).toBeUndefined();
    expect(webViewItemFromDocument(metadata, document({ title: " ", route: "safe-route" }))).toMatchObject({
      name: "Published Launch",
      title: "Published Launch",
      route: "safe-route"
    });
  });

  it("shapes visible list results with next offsets and exact-total markers", () => {
    const metadata = resolveWebViewMetadata(BlogView, BlogPost);
    const first = webViewItemFromDocument(metadata, document({ title: "First", route: "first" }))!;
    const second = webViewItemFromDocument(metadata, document({ title: "Second", route: "second" }))!;

    expect(webViewListResult({
      metadata,
      collected: [first, second],
      visibleSeen: 2,
      rawOffset: 20,
      rawTotal: 100,
      limit: 1,
      offset: 0
    })).toEqual({
      view: BlogView,
      items: [first],
      total: 2,
      totalIsExact: false,
      limit: 1,
      offset: 0,
      hasMore: true,
      nextOffset: 1
    });
    expect(webViewListResult({
      metadata,
      collected: [first],
      visibleSeen: 1,
      rawOffset: 100,
      rawTotal: 100,
      limit: 10,
      offset: 5
    })).toMatchObject({
      totalIsExact: true,
      hasMore: false
    });
  });
});

function document(data: DocumentSnapshot["data"]): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Blog Post",
    name: "Published Launch",
    version: 1,
    docstatus: "draft",
    data,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
