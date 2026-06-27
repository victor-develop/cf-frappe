import { createRegistry, createRegistryFromApps, defineApp, defineDocType, defineWebForm } from "../../src";

describe("web form metadata", () => {
  it("freezes metadata-defined web forms", () => {
    const webForm = defineWebForm({
      name: "Lead Intake",
      label: "Lead Intake",
      roles: ["Guest"],
      doctype: "Lead",
      fields: [
        { field: "title", label: "Name", required: true },
        { field: "email", description: "Work email" }
      ],
      submitLabel: "Send",
      successMessage: "Thanks",
      successUrl: "/page/thanks"
    });

    expect(Object.isFrozen(webForm)).toBe(true);
    expect(Object.isFrozen(webForm.roles ?? [])).toBe(true);
    expect(Object.isFrozen(webForm.fields)).toBe(true);
    expect(Object.isFrozen(webForm.fields[0])).toBe(true);
  });

  it("validates web forms against registered DocType metadata", () => {
    const Lead = defineDocType({
      name: "Lead",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "email", type: "text" },
        { name: "internal_notes", type: "longText", hidden: true },
        { name: "created_by", type: "text", readOnly: true },
        { name: "children", type: "table", tableOf: "Lead Child" }
      ]
    });
    const LeadChild = defineDocType({
      name: "Lead Child",
      fields: [{ name: "name", type: "text" }]
    });
    const form = defineWebForm({
      name: "Lead Intake",
      route: "lead/intake",
      doctype: "Lead",
      fields: [{ field: "title" }, { field: "email" }]
    });

    const registry = createRegistry({ doctypes: [Lead, LeadChild], webForms: [form] });

    expect(registry.getWebForm("Lead Intake")).toEqual(form);
    expect(registry.getWebFormByRoute("lead/intake")).toEqual(form);
    expect(registry.listWebForms().map((item) => item.name)).toEqual(["Lead Intake"]);
    expect(createRegistryFromApp(form).getWebForm("Lead Intake")).toEqual(form);
    expect(() => createRegistry({ doctypes: [Lead, LeadChild], webForms: [form, form] })).toThrow("already registered");
    expect(() =>
      createRegistry({
        doctypes: [Lead, LeadChild],
        webForms: [
          form,
          defineWebForm({ name: "Duplicate Route", route: "lead/intake", doctype: "Lead", fields: [{ field: "title" }] })
        ]
      })
    ).toThrow("route 'lead/intake' is already registered");
    expect(() =>
      createRegistry({
        doctypes: [Lead, LeadChild],
        webForms: [
          defineWebForm({ name: "contact", doctype: "Lead", fields: [{ field: "title" }] }),
          defineWebForm({ name: "Contact Intake", route: "contact", doctype: "Lead", fields: [{ field: "title" }] })
        ]
      })
    ).toThrow("route 'contact' conflicts with an existing web form name");
    expect(() =>
      createRegistry({
        doctypes: [Lead, LeadChild],
        webForms: [
          defineWebForm({ name: "Contact Intake", route: "contact", doctype: "Lead", fields: [{ field: "title" }] }),
          defineWebForm({ name: "contact", doctype: "Lead", fields: [{ field: "title" }] })
        ]
      })
    ).toThrow("name 'contact' conflicts with an existing web form route");
    expect(() => defineWebForm({ name: "Bad", route: "/lead", doctype: "Lead", fields: [{ field: "title" }] }))
      .toThrow("safe canonical relative path");
    expect(() => defineWebForm({ name: "Bad", route: "lead?x=1", doctype: "Lead", fields: [{ field: "title" }] }))
      .toThrow("safe canonical relative path");
    expect(() => defineWebForm({ name: "Bad", route: "lead/../admin", doctype: "Lead", fields: [{ field: "title" }] }))
      .toThrow("safe canonical relative path");
    expect(() => defineWebForm({ name: "Bad", doctype: "Lead", fields: [{ field: "title" }], successUrl: "javascript:alert(1)" }))
      .toThrow("success URL must be a safe href");
    expect(() => defineWebForm({ name: "Bad", doctype: "Lead", fields: [{ field: "title" }], successUrl: "/api/resource/Lead" }))
      .toThrow("success URL must be a safe href");
    expect(() => defineWebForm({ name: "Bad", doctype: "Lead", fields: [{ field: "title" }], successUrl: "/web/lead?x=1" }))
      .toThrow("success URL must be a safe href");
    expect(() => defineWebForm({ name: "Bad", doctype: "Lead", fields: [{ field: "title" }], successUrl: "/web/a/%2e%2e/%2e%2e/api/resource" }))
      .toThrow("success URL must be a safe href");
    expect(() =>
      createRegistry({
        doctypes: [Lead, LeadChild],
        webForms: [defineWebForm({ name: "Broken", doctype: "Missing", fields: [{ field: "title" }] })]
      })
    ).toThrow("references unknown DocType");
    expect(() =>
      createRegistry({
        doctypes: [Lead, LeadChild],
        webForms: [defineWebForm({ name: "Broken", doctype: "Lead", fields: [{ field: "missing" }] })]
      })
    ).toThrow("references unknown field");
    expect(() =>
      createRegistry({
        doctypes: [Lead, LeadChild],
        webForms: [defineWebForm({ name: "Broken", doctype: "Lead", fields: [{ field: "internal_notes" }] })]
      })
    ).toThrow("must not be hidden");
    expect(() =>
      createRegistry({
        doctypes: [Lead, LeadChild],
        webForms: [defineWebForm({ name: "Broken", doctype: "Lead", fields: [{ field: "created_by" }] })]
      })
    ).toThrow("must not be read-only");
    expect(() =>
      createRegistry({
        doctypes: [Lead, LeadChild],
        webForms: [defineWebForm({ name: "Broken", doctype: "Lead", fields: [{ field: "children" }] })]
      })
    ).toThrow("cannot be a table field");
  });
});

function createRegistryFromApp(form: ReturnType<typeof defineWebForm>) {
  const Lead = defineDocType({
    name: "Lead",
    fields: [
      { name: "title", type: "text" },
      { name: "email", type: "text" }
    ]
  });
  return createRegistryFromApps([defineApp({ name: "crm", doctypes: [Lead], webForms: [form] })]);
}
