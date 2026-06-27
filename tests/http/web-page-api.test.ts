import {
  createRegistry,
  createResourceApi,
  defineWebPage,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  unsafeHeaderActorResolver,
  WebPageService
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
});
