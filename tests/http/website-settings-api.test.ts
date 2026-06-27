import {
  createRegistry,
  createResourceApi,
  defineWebPage,
  defineWebsiteSettings,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  unsafeHeaderActorResolver,
  WebPageService,
  WebsiteSettingsService
} from "../../src";
import { now } from "../helpers";

describe("website settings api", () => {
  it("serves metadata and redirects the configured home page", async () => {
    const registry = createRegistry({
      webPages: [
        defineWebPage({
          name: "About",
          route: "about",
          title: "About",
          sections: [{ body: "Welcome" }]
        })
      ],
      websiteSettings: defineWebsiteSettings({
        title: "Starter Site",
        description: "Cloudflare-native starter",
        homePageRoute: "about",
        navItems: [{ name: "about", label: "About", pageRoute: "about" }]
      })
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

    const metadata = await app.request("/api/meta/website-settings");
    expect(metadata.status).toBe(200);
    await expect(metadata.json()).resolves.toEqual({
      data: {
        title: "Starter Site",
        description: "Cloudflare-native starter",
        homePageRoute: "about",
        navItems: [{ name: "about", label: "About", href: "/page/about" }]
      }
    });

    const home = await app.request("/");
    expect(home.status).toBe(302);
    expect(home.headers.get("location")).toBe("/page/about");
  });

  it("returns expected public errors for hidden or missing website settings", async () => {
    const page = defineWebPage({ name: "About", route: "about", title: "About", sections: [{ body: "Welcome" }] });

    const missing = createApp(createRegistry({ webPages: [page] }));
    expect((await missing.request("/api/meta/website-settings")).status).toBe(404);
    expect((await missing.request("/")).status).toBe(404);

    const unpublished = createApp(createRegistry({
      webPages: [page],
      websiteSettings: defineWebsiteSettings({ title: "Draft Site", homePageRoute: "about", published: false })
    }));
    expect((await unpublished.request("/api/meta/website-settings")).status).toBe(403);
    expect((await unpublished.request("/")).status).toBe(403);

    const restricted = createApp(createRegistry({
      webPages: [page],
      websiteSettings: defineWebsiteSettings({ title: "Private Site", homePageRoute: "about", roles: ["User"] })
    }));
    expect((await restricted.request("/api/meta/website-settings")).status).toBe(403);
    expect((await restricted.request("/")).status).toBe(403);

    const hiddenHome = createApp(createRegistry({
      webPages: [
        defineWebPage({
          name: "Members",
          route: "members",
          title: "Members",
          roles: ["User"],
          sections: [{ body: "Private" }]
        })
      ],
      websiteSettings: defineWebsiteSettings({ title: "Starter Site", homePageRoute: "members" })
    }));
    const hiddenMetadata = await hiddenHome.request("/api/meta/website-settings");
    expect(hiddenMetadata.status).toBe(200);
    await expect(hiddenMetadata.json()).resolves.toEqual({
      data: {
        title: "Starter Site",
        navItems: []
      }
    });
    expect((await hiddenHome.request("/")).status).toBe(404);
  });
});

function createApp(registry: ReturnType<typeof createRegistry>) {
  const store = new InMemoryDocumentStore();
  const webPages = new WebPageService({ registry });
  return createResourceApi({
    registry,
    documents: new DocumentService({ registry, store, clock: fixedClock(now) }),
    queries: new QueryService({ registry, projections: store }),
    webPages,
    websiteSettings: new WebsiteSettingsService({ registry, webPages }),
    actor: unsafeHeaderActorResolver
  });
}
