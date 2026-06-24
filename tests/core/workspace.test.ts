import {
  createRegistry,
  defineDashboard,
  defineDocType,
  defineReport,
  defineWorkspace,
  FrameworkError,
  SYSTEM_MANAGER_ROLE,
  canReadWorkspace,
  canReadWorkspaceShortcut
} from "../../src";

const actor = { id: "user@example.com", roles: ["User"], tenantId: "acme" };
const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

describe("workspaces", () => {
  it("freezes metadata-defined workspace sections and shortcuts", () => {
    const workspace = defineWorkspace({
      name: "Operations",
      label: "Operations",
      description: "Daily workbench",
      roles: ["User"],
      sections: [
        {
          name: "records",
          label: "Records",
          shortcuts: [
            {
              name: "notes",
              label: "Notes",
              kind: "doctype",
              target: "Note",
              roles: ["User"]
            }
          ]
        }
      ]
    });

    expect(Object.isFrozen(workspace)).toBe(true);
    expect(Object.isFrozen(workspace.sections)).toBe(true);
    expect(Object.isFrozen(workspace.sections[0]?.shortcuts)).toBe(true);
    expect(canReadWorkspace(actor, workspace)).toBe(true);
    expect(canReadWorkspace(admin, workspace)).toBe(true);
    expect(canReadWorkspaceShortcut(actor, workspace.sections[0]!.shortcuts[0]!)).toBe(true);
  });

  it("rejects invalid workspace shortcut declarations", () => {
    expect(() =>
      defineWorkspace({
        name: "Broken",
        sections: [{ name: "empty", shortcuts: [] }]
      })
    ).toThrow("must define at least one shortcut");
    for (const href of ["javascript:alert(1)", "//evil.example", "///evil.example", "/\\evil.example"]) {
      expect(() =>
        defineWorkspace({
          name: "Broken",
          sections: [
            {
              name: "links",
              shortcuts: [{ name: "bad-url", kind: "url", href }]
            }
          ]
        })
      ).toThrow(FrameworkError);
    }
    expect(() =>
      defineWorkspace({
        name: "Broken",
        sections: [
          {
            name: "links",
            shortcuts: [{ name: "missing-target", kind: "doctype" }]
          }
        ]
      })
    ).toThrow("must define a target");
  });

  it("registers workspace metadata after validating DocType, report, and dashboard references", () => {
    const Note = defineDocType({ name: "Note", fields: [{ name: "title", type: "text" }] });
    const report = defineReport({ name: "Open Notes", doctype: "Note", columns: [{ name: "title" }] });
    const dashboard = defineDashboard({
      name: "Operations Dashboard",
      cards: [{ name: "open_notes", source: { kind: "documentCount", doctype: "Note" } }]
    });
    const workspace = defineWorkspace({
      name: "Operations",
      sections: [
        {
          name: "main",
          shortcuts: [
            { name: "notes", kind: "doctype", target: "Note" },
            { name: "open-notes", kind: "report", target: "Open Notes" },
            { name: "operations-dashboard", kind: "dashboard", target: "Operations Dashboard" }
          ]
        }
      ]
    });

    const registry = createRegistry({ doctypes: [Note], reports: [report], dashboards: [dashboard], workspaces: [workspace] });

    expect(registry.listWorkspaces().map((item) => item.name)).toEqual(["Operations"]);
    expect(registry.getWorkspace("Operations")).toEqual(workspace);
    expect(() =>
      createRegistry({
        doctypes: [Note],
        workspaces: [
          defineWorkspace({
            name: "Broken",
            sections: [{ name: "main", shortcuts: [{ name: "missing", kind: "doctype", target: "Missing" }] }]
          })
        ]
      })
    ).toThrow("references unknown DocType");
    expect(() =>
      createRegistry({ doctypes: [Note], reports: [report], dashboards: [dashboard], workspaces: [workspace, workspace] })
    ).toThrow("already registered");
  });

  it("rejects workspace dashboard shortcuts that reference unregistered dashboards", () => {
    expect(() =>
      createRegistry({
        workspaces: [
          defineWorkspace({
            name: "Broken Dashboard",
            sections: [
              {
                name: "main",
                shortcuts: [{ name: "missing-dashboard", kind: "dashboard", target: "Missing Dashboard" }]
              }
            ]
          })
        ]
      })
    ).toThrow("references unknown dashboard");
  });
});
