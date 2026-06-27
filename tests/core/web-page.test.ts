import { createRegistry, createRegistryFromApps, defineApp, defineWebPage } from "../../src";

describe("metadata Web Pages", () => {
  it("freezes metadata-defined web pages", () => {
    const page = defineWebPage({
      name: "About",
      route: "about",
      title: "About",
      sections: [{ heading: "Hello", body: "Welcome" }],
      roles: ["Guest"]
    });

    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.sections)).toBe(true);
    expect(Object.isFrozen(page.sections[0])).toBe(true);
  });

  it("validates and registers metadata web pages", () => {
    const page = defineWebPage({
      name: "About",
      route: "about",
      title: "About",
      sections: [{ body: "Welcome" }]
    });
    const registry = createRegistry({ webPages: [page] });

    expect(registry.getWebPage("About")).toEqual(page);
    expect(registry.listWebPages().map((item) => item.name)).toEqual(["About"]);
    expect(createRegistryFromApps([defineApp({ name: "website", webPages: [page] })]).getWebPage("About")).toEqual(page);
    expect(() => createRegistry({ webPages: [page, page] })).toThrow("already registered");
    expect(() =>
      createRegistry({
        webPages: [
          page,
          defineWebPage({ name: "Duplicate Route", route: "about", title: "Duplicate", sections: [{ body: "Nope" }] })
        ]
      })
    ).toThrow("route 'about' is already registered");
    expect(() => defineWebPage({ name: "", route: "about", title: "About", sections: [{ body: "Welcome" }] }))
      .toThrow("web page name is required");
    expect(() => defineWebPage({ name: "Bad", route: "/admin", title: "Bad", sections: [{ body: "Welcome" }] }))
      .toThrow("safe canonical relative path");
    expect(() => defineWebPage({ name: "Bad", route: "bad?x=1", title: "Bad", sections: [{ body: "Welcome" }] }))
      .toThrow("safe canonical relative path");
    expect(() => defineWebPage({ name: "Bad", route: "bad route", title: "Bad", sections: [{ body: "Welcome" }] }))
      .toThrow("safe canonical relative path");
    expect(() => defineWebPage({ name: "Bad", route: "bad/", title: "Bad", sections: [{ body: "Welcome" }] }))
      .toThrow("safe canonical relative path");
    expect(() => defineWebPage({ name: "Bad", route: "bad//route", title: "Bad", sections: [{ body: "Welcome" }] }))
      .toThrow("safe canonical relative path");
    expect(() => defineWebPage({ name: "Bad", route: "bad\\route", title: "Bad", sections: [{ body: "Welcome" }] }))
      .toThrow("safe canonical relative path");
    expect(() => defineWebPage({ name: "Bad", route: "%2e%2e/admin", title: "Bad", sections: [{ body: "Welcome" }] }))
      .toThrow("safe canonical relative path");
    expect(() => defineWebPage({ name: "Bad", route: "docs/../admin", title: "Bad", sections: [{ body: "Welcome" }] }))
      .toThrow("safe canonical relative path");
    expect(() => defineWebPage({ name: "Bad", route: "bad", title: "Bad", sections: [] }))
      .toThrow("sections must not be empty");
    expect(() => defineWebPage({ name: "Bad", route: "bad", title: "Bad", sections: [{ body: "" }] }))
      .toThrow("section body is required");
  });
});
