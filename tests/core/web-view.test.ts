import { createRegistry, createRegistryFromApps, defineApp, defineDocType, defineWebView } from "../../src";

const BlogPost = defineDocType({
  name: "Blog Post",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "route", type: "text", required: true },
    { name: "published", type: "boolean" },
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
    const view = defineWebView({
      name: "Blog",
      label: "Blog",
      doctype: "Blog Post",
      routeField: "route",
      titleField: "title",
      publishedField: "published",
      fields: [{ field: "body", label: "Article" }],
      roles: ["Guest"],
      pageSize: 10
    });

    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.fields)).toBe(true);
    expect(Object.isFrozen(view.fields?.[0])).toBe(true);
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
  });
});
