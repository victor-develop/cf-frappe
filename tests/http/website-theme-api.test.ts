import {
  createRegistry,
  createResourceApi,
  defineWebsiteTheme,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  unsafeHeaderActorResolver,
  WebsiteThemeService
} from "../../src";
import { now } from "../helpers";

describe("website theme api", () => {
  it("serves theme metadata", async () => {
    const registry = createRegistry({
      websiteThemes: [
        defineWebsiteTheme({
          name: "Starter",
          label: "Starter",
          tokens: { primaryColor: "#2563eb" }
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const app = createResourceApi({
      registry,
      documents: new DocumentService({ registry, store, clock: fixedClock(now) }),
      queries: new QueryService({ registry, projections: store }),
      websiteThemes: new WebsiteThemeService({ registry }),
      actor: unsafeHeaderActorResolver
    });

    const listed = await app.request("/api/meta/website-themes");
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({ data: [{ name: "Starter" }] });

    const metadata = await app.request("/api/meta/website-themes/Starter");
    expect(metadata.status).toBe(200);
    await expect(metadata.json()).resolves.toMatchObject({ data: { tokens: { primaryColor: "#2563eb" } } });
  });
});
