import { createRegistry, createRegistryFromApps, defineApp, defineDocType, defineWebView } from "../../src";

const BlogPost = defineDocType({
  name: "Blog Post",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "route", type: "text", required: true },
    { name: "published", type: "boolean" },
    { name: "category", type: "select", options: ["News", "Docs"] },
    { name: "body", type: "longText" },
    { name: "internal_notes", type: "text", hidden: true },
    { name: "children", type: "table", tableOf: "Blog Child" }
  ],
  permissions: [{ roles: ["Guest"], actions: ["read"] }]
});

const BlogChild = defineDocType({
  name: "Blog Child",
  fields: [{ name: "label", type: "text" }]
});
const blogDoctypes = [BlogPost, BlogChild] as const;

describe("metadata Web Views", () => {
  it("freezes metadata-defined web views", () => {
    const categories = ["News", "Docs"] as const;
    const view = defineWebView({
      name: "Blog",
      label: "Blog",
      doctype: "Blog Post",
      routeField: "route",
      titleField: "title",
      publishedField: "published",
      fields: [{ field: "body", label: "Article" }],
      filters: [{ field: "category", operator: "in", value: categories }],
      filterExpression: {
        kind: "group",
        match: "any",
        filters: [
          { field: "category", value: "News" },
          { field: "category", operator: "in", value: categories }
        ]
      },
      roles: ["Guest"],
      pageSize: 10,
      orderBy: "title",
      order: "asc"
    });

    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.fields)).toBe(true);
    expect(Object.isFrozen(view.fields?.[0])).toBe(true);
    expect(Object.isFrozen(view.filters)).toBe(true);
    expect(Object.isFrozen(view.filters?.[0])).toBe(true);
    expect(Object.isFrozen(view.filters?.[0]?.value)).toBe(true);
    expect(Object.isFrozen(view.filterExpression)).toBe(true);
    expect(Object.isFrozen((view.filterExpression as { readonly filters: readonly unknown[] }).filters)).toBe(true);
    expect(Object.isFrozen((view.filterExpression as { readonly filters: readonly { readonly value?: unknown }[] }).filters[1])).toBe(true);
    expect(Object.isFrozen((view.filterExpression as { readonly filters: readonly { readonly value?: unknown }[] }).filters[1]?.value)).toBe(true);
    expect(view.filters?.[0]?.value).toEqual(["News", "Docs"]);
    (categories as unknown as string[]).push("Internal");
    expect(view.filters?.[0]?.value).toEqual(["News", "Docs"]);
    expect((view.filterExpression as { readonly filters: readonly { readonly value?: unknown }[] }).filters[1]?.value).toEqual(["News", "Docs"]);
  });

  it("validates web views against registered DocType metadata", () => {
    const view = defineWebView({
      name: "Blog",
      doctype: "Blog Post",
      routeField: "route",
      titleField: "title",
      publishedField: "published",
      fields: [{ field: "body" }]
    });
    const registry = createRegistry({ doctypes: blogDoctypes, webViews: [view] });

    expect(registry.getWebView("Blog")).toEqual(view);
    expect(registry.listWebViews().map((item) => item.name)).toEqual(["Blog"]);
    expect(createRegistryFromApps([defineApp({ name: "website", doctypes: blogDoctypes, webViews: [view] })]).getWebView("Blog"))
      .toEqual(view);
    expect(() => createRegistry({ doctypes: blogDoctypes, webViews: [view, view] })).toThrow("already registered");

    expect(() =>
      createRegistry({ doctypes: blogDoctypes, webViews: [defineWebView({ name: "Broken", doctype: "Missing", routeField: "route", titleField: "title" })] })
    ).toThrow("unknown DocType");
    expect(() =>
      createRegistry({ doctypes: blogDoctypes, webViews: [defineWebView({ name: "Broken", doctype: "Blog Post", routeField: "missing", titleField: "title" })] })
    ).toThrow("unknown field");
    expect(() =>
      createRegistry({ doctypes: blogDoctypes, webViews: [defineWebView({ name: "Broken", doctype: "Blog Post", routeField: "published", titleField: "title" })] })
    ).toThrow("route field");
    expect(() =>
      createRegistry({ doctypes: blogDoctypes, webViews: [defineWebView({ name: "Broken", doctype: "Blog Post", routeField: "route", titleField: "title", publishedField: "title" })] })
    ).toThrow("published field");
    expect(() =>
      createRegistry({ doctypes: blogDoctypes, webViews: [defineWebView({ name: "Broken", doctype: "Blog Post", routeField: "route", titleField: "title", fields: [{ field: "internal_notes" }] })] })
    ).toThrow("must not be hidden");
    expect(() =>
      createRegistry({ doctypes: blogDoctypes, webViews: [defineWebView({ name: "Broken", doctype: "Blog Post", routeField: "route", titleField: "title", fields: [{ field: "children" }] })] })
    ).toThrow("cannot be a table field");
    expect(() =>
      defineWebView({ name: "Broken", doctype: "Blog Post", routeField: "route", titleField: "title", fields: [{ field: "body" }, { field: "body" }] })
    ).toThrow("duplicate field");
    expect(() =>
      defineWebView({ name: "Broken", doctype: "Blog Post", routeField: "route", titleField: "title", pageSize: 0 })
    ).toThrow("page size");
    expect(() =>
      defineWebView({ name: "Broken", doctype: "Blog Post", routeField: "route", titleField: "title", orderBy: " " })
    ).toThrow("orderBy field is required");
    expect(() =>
      defineWebView({
        name: "Broken",
        doctype: "Blog Post",
        routeField: "route",
        titleField: "title",
        filterExpression: "not-an-expression" as never
      })
    ).toThrow("filter expression must be an object");
    expect(() =>
      defineWebView({
        name: "Broken",
        doctype: "Blog Post",
        routeField: "route",
        titleField: "title",
        filterExpression: { kind: "group", match: "any" } as never
      })
    ).toThrow("List filter group must include at least one filter");
    expect(() =>
      createRegistry({ doctypes: blogDoctypes, webViews: [defineWebView({ name: "Broken", doctype: "Blog Post", routeField: "route", titleField: "title", orderBy: "missing" })] })
    ).toThrow("orderBy field 'missing' is not defined");
    expect(() =>
      createRegistry({ doctypes: blogDoctypes, webViews: [defineWebView({ name: "Broken", doctype: "Blog Post", routeField: "route", titleField: "title", orderBy: "internal_notes" })] })
    ).toThrow("orderBy field 'internal_notes' is hidden");
    expect(() =>
      createRegistry({ doctypes: blogDoctypes, webViews: [defineWebView({ name: "Broken", doctype: "Blog Post", routeField: "route", titleField: "title", orderBy: "children" })] })
    ).toThrow("orderBy field 'children' cannot be a table field");
    expect(() =>
      createRegistry({ doctypes: blogDoctypes, webViews: [defineWebView({ name: "Broken", doctype: "Blog Post", routeField: "route", titleField: "title", orderBy: "title", order: "sideways" as never })] })
    ).toThrow("List order must be asc or desc");
    expect(() =>
      createRegistry({ doctypes: blogDoctypes, webViews: [defineWebView({ name: "Broken", doctype: "Blog Post", routeField: "route", titleField: "title", filters: [{ field: "missing", value: "News" }] })] })
    ).toThrow("Filter field 'missing' is not defined");
    expect(() =>
      createRegistry({ doctypes: blogDoctypes, webViews: [defineWebView({ name: "Broken", doctype: "Blog Post", routeField: "route", titleField: "title", filters: [{ field: "internal_notes", value: "secret" }] })] })
    ).toThrow("filter field 'internal_notes' must not be hidden");
    expect(() =>
      createRegistry({ doctypes: blogDoctypes, webViews: [defineWebView({ name: "Broken", doctype: "Blog Post", routeField: "route", titleField: "title", filters: [{ field: "children", value: "child" }] })] })
    ).toThrow("Filter field 'children' cannot be a table field");
    expect(() =>
      createRegistry({
        doctypes: blogDoctypes,
        webViews: [
          defineWebView({
            name: "Broken",
            doctype: "Blog Post",
            routeField: "route",
            titleField: "title",
            filterExpression: { kind: "group", match: "any", filters: [] }
          })
        ]
      })
    ).toThrow("List filter group must include at least one filter");
    expect(() =>
      createRegistry({
        doctypes: blogDoctypes,
        webViews: [
          defineWebView({
            name: "Broken",
            doctype: "Blog Post",
            routeField: "route",
            titleField: "title",
            filterExpression: { field: "internal_notes", value: "secret" }
          })
        ]
      })
    ).toThrow("filter expression field 'internal_notes' must not be hidden");
    expect(() =>
      createRegistry({
        doctypes: blogDoctypes,
        webViews: [
          defineWebView({
            name: "Broken",
            doctype: "Blog Post",
            routeField: "route",
            titleField: "title",
            filterExpression: { field: "children", value: "child" }
          })
        ]
      })
    ).toThrow("Filter field 'children' cannot be a table field");
  });
});
