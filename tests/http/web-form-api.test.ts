import {
  createRegistry,
  createResourceApi,
  defineDocType,
  defineWebForm,
  defineWebPage,
  defineWebsiteSettings,
  defineWebsiteTheme,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  unsafeHeaderActorResolver,
  WebFormService,
  WebPageService,
  WebsiteSettingsService,
  WebsiteThemeService
} from "../../src";
import { now } from "../helpers";

const leadDocType = defineDocType({
  name: "Lead",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "email", type: "text" },
    { name: "score", type: "integer" },
    { name: "accepted", type: "boolean" },
    { name: "details", type: "json" }
  ],
  permissions: [{ roles: ["Guest"], actions: ["create"] }]
});

describe("web form api", () => {
  it("serves metadata and submits web forms through JSON and public HTML routes", async () => {
    const registry = createRegistry({
      doctypes: [leadDocType],
      webForms: [
        defineWebForm({
          name: "Lead Intake",
          label: "Lead Intake",
          route: "lead/intake",
          doctype: "Lead",
          fields: [
            { field: "title", label: "Name", required: true },
            { field: "email" },
            { field: "score" },
            { field: "accepted" },
            { field: "details" }
          ],
          successMessage: "Thanks for reaching out.",
          successUrl: "/page/thanks"
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webForms = new WebFormService({ registry, documents, queries });
    const app = createResourceApi({
      registry,
      documents,
      queries,
      webForms,
      actor: unsafeHeaderActorResolver
    });

    const listed = await app.request("/api/meta/web-forms");
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({ data: [{ name: "Lead Intake", doctype: "Lead" }] });

    const metadata = await app.request("/api/meta/web-forms/Lead%20Intake");
    expect(metadata.status).toBe(200);
    await expect(metadata.json()).resolves.toMatchObject({
      data: {
        form: { name: "Lead Intake", route: "lead/intake", successUrl: "/page/thanks" },
        doctype: "Lead",
        fields: expect.arrayContaining([{ field: "title", label: "Name", type: "text", required: true }])
      }
    });

    const jsonSubmit = await app.request("/api/web-form/Lead%20Intake/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { title: "JSON Lead", email: "json@example.com", score: 7, accepted: true } })
    });
    expect(jsonSubmit.status).toBe(201);
    await expect(jsonSubmit.json()).resolves.toMatchObject({
      data: { document: { name: "JSON Lead", data: { score: 7, accepted: true } } }
    });

    const html = await app.request("/web-forms/Lead%20Intake");
    expect(html.status).toBe(200);
    await expect(html.text()).resolves.toContain("<h1>Lead Intake</h1>");

    const list = await app.request("/web-forms");
    expect(list.status).toBe(200);
    await expect(list.text()).resolves.toContain('href="/web-forms/lead/intake"');

    const routedHtml = await app.request("/web-forms/lead/intake");
    expect(routedHtml.status).toBe(200);
    await expect(routedHtml.text()).resolves.toContain("<h1>Lead Intake</h1>");

    const formSubmit = await app.request("/web-forms/Lead%20Intake", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        title: "HTML Lead",
        email: "html@example.com",
        score: "9",
        accepted: "1",
        details: "{\"source\":\"html\"}"
      })
    });
    expect(formSubmit.status).toBe(201);
    const formSubmitHtml = await formSubmit.text();
    expect(formSubmitHtml).toContain("Thanks for reaching out.");
    expect(formSubmitHtml).toContain('<a class="web-form-continue" href="/page/thanks">Continue</a>');
    await expect(store.get("default", "Lead", "HTML Lead"))
      .resolves.toMatchObject({
        data: {
          title: "HTML Lead",
          score: 9,
          accepted: true,
          details: { source: "html" }
        }
      });
  });

  it("applies Website presentation to public Web Form pages", async () => {
    const registry = createRegistry({
      doctypes: [leadDocType],
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
          label: "Lead <Intake>",
          doctype: "Lead",
          fields: [{ field: "title", label: "Name", required: true }],
          successMessage: "Thanks <friend>.",
          successUrl: "/web/Lead%20Updates"
        })
      ],
      websiteThemes: [
        defineWebsiteTheme({
          name: "Starter",
          fontFamily: "Inter, system-ui",
          tokens: {
            primaryColor: "#0f766e",
            backgroundColor: "#f8fafc",
            textColor: "#0f172a"
          }
        })
      ],
      websiteSettings: defineWebsiteSettings({
        title: "Starter Site",
        theme: "Starter",
        navItems: [
          { name: "about", label: "About", pageRoute: "about" },
          { name: "intake", label: "<Intake>", href: "/web-forms/lead/intake" }
        ]
      })
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const webPages = new WebPageService({ registry });
    const webForms = new WebFormService({ registry, documents, queries });
    const app = createResourceApi({
      registry,
      documents,
      queries,
      webForms,
      webPages,
      websiteSettings: new WebsiteSettingsService({
        registry,
        webPages,
        websiteThemes: new WebsiteThemeService({ registry })
      }),
      websiteThemes: new WebsiteThemeService({ registry }),
      actor: unsafeHeaderActorResolver
    });

    const listPage = await app.request("/web-forms");
    expect(listPage.status).toBe(200);
    const listHtml = await listPage.text();
    expect(listHtml).toContain("--cf-frappe-primary: #0f766e");
    expect(listHtml).toContain("--cf-frappe-background: #f8fafc");
    expect(listHtml).toContain("--cf-frappe-font-family: Inter, system-ui");
    expect(listHtml).toContain('aria-label="Website navigation"');
    expect(listHtml).toContain('<a href="/page/about">About</a>');
    expect(listHtml).toContain('href="/web-forms/lead/intake"');
    expect(listHtml).toContain('<a href="/web-forms/lead/intake">&lt;Intake&gt;</a>');

    const formPage = await app.request("/web-forms/lead/intake");
    expect(formPage.status).toBe(200);
    const formHtml = await formPage.text();
    expect(formHtml).toContain("<h1>Lead &lt;Intake&gt;</h1>");
    expect(formHtml).toContain("background: var(--cf-frappe-primary)");
    expect(formHtml).toContain('<a href="/web-forms/lead/intake">&lt;Intake&gt;</a>');

    const submitted = await app.request("/web-forms/lead/intake", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: "HTML Lead" })
    });
    expect(submitted.status).toBe(201);
    const submittedHtml = await submitted.text();
    expect(submittedHtml).toContain("Thanks &lt;friend&gt;.");
    expect(submittedHtml).toContain('<a class="web-form-continue" href="/web/Lead%20Updates">Continue</a>');
    expect(submittedHtml).toContain("--cf-frappe-primary: #0f766e");
    expect(submittedHtml).toContain('<a href="/page/about">About</a>');
  });

  it("falls back to default Web Form CSS and no navigation when Website Settings cannot be read", async () => {
    for (const registry of [
      createRegistry({
        doctypes: [leadDocType],
        webForms: [
          defineWebForm({
            name: "Lead Intake",
            doctype: "Lead",
            fields: [{ field: "title", label: "Name", required: true }]
          })
        ]
      }),
      createRegistry({
        doctypes: [leadDocType],
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
            doctype: "Lead",
            fields: [{ field: "title", label: "Name", required: true }]
          })
        ],
        websiteThemes: [defineWebsiteTheme({ name: "Starter", tokens: { primaryColor: "#0f766e" } })],
        websiteSettings: defineWebsiteSettings({
          title: "Private Site",
          theme: "Starter",
          roles: ["User"],
          navItems: [{ name: "about", label: "About", pageRoute: "about" }]
        })
      }),
      createRegistry({
        doctypes: [leadDocType],
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
            doctype: "Lead",
            fields: [{ field: "title", label: "Name", required: true }]
          })
        ],
        websiteThemes: [defineWebsiteTheme({ name: "Starter", tokens: { primaryColor: "#0f766e" } })],
        websiteSettings: defineWebsiteSettings({
          title: "Draft Site",
          theme: "Starter",
          published: false,
          navItems: [{ name: "about", label: "About", pageRoute: "about" }]
        })
      })
    ]) {
      const store = new InMemoryDocumentStore();
      const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
      const queries = new QueryService({ registry, projections: store });
      const webPages = new WebPageService({ registry });
      const app = createResourceApi({
        registry,
        documents,
        queries,
        webForms: new WebFormService({ registry, documents, queries }),
        webPages,
        websiteSettings: new WebsiteSettingsService({
          registry,
          webPages,
          websiteThemes: new WebsiteThemeService({ registry })
        }),
        websiteThemes: new WebsiteThemeService({ registry }),
        actor: unsafeHeaderActorResolver
      });

      const page = await app.request("/web-forms/Lead%20Intake");
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("--cf-frappe-primary: #2563eb");
      expect(html).not.toContain("--cf-frappe-primary: #0f766e");
      expect(html).not.toContain("Website navigation");
    }
  });
});
