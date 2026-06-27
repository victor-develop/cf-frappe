import {
  createRegistry,
  createResourceApi,
  defineDocType,
  defineWebForm,
  defineWebPage,
  defineWebsiteSettings,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  unsafeHeaderActorResolver,
  WebFormService,
  WebPageService,
  WebsiteSettingsService
} from "../../src";
import { now } from "../helpers";

describe("website settings api", () => {
  it("serves metadata and redirects the configured home page", async () => {
    const Lead = defineDocType({
      name: "Lead",
      fields: [{ name: "title", type: "text", required: true }],
      permissions: [{ roles: ["Guest"], actions: ["create"] }]
    });
    const registry = createRegistry({
      doctypes: [Lead],
      webPages: [
        defineWebPage({
          name: "About",
          route: "about",
          title: "About",
          sections: [{ body: "Welcome" }]
        })
      ],
      webForms: [
        defineWebForm({
          name: "Lead Intake",
          route: "lead/intake",
          doctype: "Lead",
          fields: [{ field: "title" }]
        })
      ],
      websiteSettings: defineWebsiteSettings({
        title: "Starter Site",
        description: "Cloudflare-native starter",
        homePageRoute: "about",
        navItems: [
          { name: "about", label: "About", pageRoute: "about" },
          { name: "intake", label: "Lead Intake", webForm: "Lead Intake" }
        ]
      })
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webForms = new WebFormService({ registry, documents, queries });
    const webPages = new WebPageService({ registry });
    const app = createResourceApi({
      registry,
      documents,
      queries,
      webForms,
      webPages,
      websiteSettings: new WebsiteSettingsService({ registry, webPages, webForms }),
      actor: unsafeHeaderActorResolver
    });

    const metadata = await app.request("/api/meta/website-settings");
    expect(metadata.status).toBe(200);
    await expect(metadata.json()).resolves.toEqual({
      data: {
        title: "Starter Site",
          description: "Cloudflare-native starter",
          homePageRoute: "about",
          navItems: [
            { name: "about", label: "About", href: "/page/about" },
            { name: "intake", label: "Lead Intake", href: "/web-forms/lead/intake" }
          ]
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

  it("filters Web Form navigation references through Web Form access rules", async () => {
    const Lead = defineDocType({
      name: "Lead",
      fields: [{ name: "title", type: "text", required: true }],
      permissions: [
        { roles: ["Guest"], actions: ["create"] },
        { roles: ["User"], actions: ["create"] }
      ]
    });
    const registry = createRegistry({
      doctypes: [Lead],
      webPages: [
        defineWebPage({
          name: "About",
          route: "about",
          title: "About",
          sections: [{ body: "Welcome" }]
        })
      ],
      webForms: [
        defineWebForm({
          name: "Public Intake",
          route: "public/intake",
          doctype: "Lead",
          fields: [{ field: "title" }]
        }),
        defineWebForm({
          name: "Member Intake",
          route: "member/intake",
          loginRequired: true,
          doctype: "Lead",
          fields: [{ field: "title" }]
        })
      ],
      websiteSettings: defineWebsiteSettings({
        title: "Starter Site",
        navItems: [
          { name: "public-intake", label: "Public Intake", webForm: "Public Intake" },
          { name: "member-intake", label: "Member Intake", webForm: "Member Intake" }
        ]
      })
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webForms = new WebFormService({ registry, documents, queries });
    const webPages = new WebPageService({ registry });
    const app = createResourceApi({
      registry,
      documents,
      queries,
      webForms,
      webPages,
      websiteSettings: new WebsiteSettingsService({ registry, webPages, webForms }),
      actor: unsafeHeaderActorResolver
    });

    const guestMetadata = await app.request("/api/meta/website-settings");
    expect(guestMetadata.status).toBe(200);
    await expect(guestMetadata.json()).resolves.toMatchObject({
      data: {
        navItems: [{ name: "public-intake", href: "/web-forms/public/intake" }]
      }
    });

    const userMetadata = await app.request("/api/meta/website-settings", {
      headers: { "x-cf-frappe-user": "member@example.com", "x-cf-frappe-roles": "User" }
    });
    expect(userMetadata.status).toBe(200);
    await expect(userMetadata.json()).resolves.toMatchObject({
      data: {
        navItems: [
          { name: "public-intake", href: "/web-forms/public/intake" },
          { name: "member-intake", href: "/web-forms/member/intake" }
        ]
      }
    });
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
