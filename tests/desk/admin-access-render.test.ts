import { type UserAccount } from "../../src/core/user-accounts.js";
import {
  renderRoleAdmin,
  renderUserAccountAdmin,
  renderUserPermissionAdmin
} from "../../src/adapters/desk/views/admin-access.js";

function account(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    tenantId: "tenant-a",
    userId: "victor@example.com",
    version: 3,
    roles: ["System Manager"],
    enabled: true,
    ...overrides
  };
}

describe("Desk user permission admin", () => {
  it("renders a bare state without options", () => {
    const html = renderUserPermissionAdmin({
      tenantId: "tenant-a",
      userId: "victor@example.com",
      version: 0,
      grants: []
    });
    expect(html).toContain("No grants configured.");
    expect(html).toContain('value="victor@example.com"');
    expect(html).not.toContain('class="error"');
  });

  it("renders grants with and without applicable doctypes plus a draft", () => {
    const html = renderUserPermissionAdmin(
      {
        tenantId: "tenant-a",
        userId: "victor@example.com",
        version: 2,
        grants: [
          { targetDoctype: "Task", targetName: "TASK-1", applicableDoctypes: ["Task", "Note"] },
          { targetDoctype: "Note", targetName: "NOTE-1" }
        ]
      },
      {
        error: "Grant exists",
        userSuggestions: ["ops@example.com"],
        draft: {
          userId: "ops@example.com",
          targetDoctype: "Task",
          targetName: "TASK-1",
          applicableDoctypes: ["Task"]
        }
      }
    );
    expect(html).toContain("Grant exists");
    expect(html).toContain("Task, Note");
    expect(html).toContain('value="ops@example.com"');
    expect(html).toContain(">Revoke</button>");
  });
});

describe("Desk user account admin", () => {
  it("renders without an account and prefills the create form", () => {
    const html = renderUserAccountAdmin({ selectedUserId: "new@example.com" });
    expect(html).toContain("No account loaded.");
    expect(html).toContain('name="user" type="email" value="new@example.com"');
    expect(html).toContain("<option value=\"\" selected>Keep</option>");
    expect(html).not.toContain("Change Password");
  });

  it("renders a loaded account with profile, drafts, and status forms", () => {
    const html = renderUserAccountAdmin({
      selectedUserId: "victor@example.com",
      account: account({ email: "victor@example.com", updatedAt: "2026-08-02T00:00:00Z" }),
      profile: {
        tenantId: "tenant-a",
        userId: "victor@example.com",
        version: 5,
        profile: { fullName: "Victor Zhou", firstName: "Victor" }
      },
      roleSuggestions: ["Reviewer"],
      createDraft: { userId: "other@example.com", email: "other@example.com", roles: ["Reviewer"], enabled: false },
      roleDraft: { roles: ["Reviewer", "System Manager"] },
      providerSyncDraft: {
        userId: "victor@example.com",
        provider: "google",
        subject: "sub-123",
        email: "victor@example.com",
        roles: ["System Manager"],
        enabled: true,
        emailVerified: false
      },
      error: "Version conflict"
    });
    expect(html).toContain("Version conflict");
    expect(html).toContain("Victor Zhou");
    expect(html).toContain(">enabled</td>");
    expect(html).toContain("2026-08-02T00:00:00Z");
    expect(html).toContain("Change Password");
    expect(html).toContain(">Disable</button>");
    expect(html).toContain('value="google"');
    expect(html).toContain('value="sub-123"');
    expect(html).toContain('<option value="false" selected>Disabled</option>');
    expect(html).toContain('<option value="true" selected>Enabled</option>');
    expect(html).toContain('<option value="false" selected>Unverified</option>');
  });

  it("renders a disabled account without profile falling back to createdAt", () => {
    const html = renderUserAccountAdmin({
      selectedUserId: "victor@example.com",
      account: account({ enabled: false, createdAt: "2026-07-01T00:00:00Z" })
    });
    expect(html).toContain(">disabled</td>");
    expect(html).toContain("2026-07-01T00:00:00Z");
    expect(html).toContain(">Enable</button>");
    expect(html).not.toContain("Save Profile");
  });

  it("renders an account with neither updatedAt nor createdAt", () => {
    const html = renderUserAccountAdmin({ selectedUserId: "x@example.com", account: account() });
    expect(html).toContain('<td data-label="Updated"></td>');
  });
});

describe("Desk role admin", () => {
  it("renders an empty catalog", () => {
    const html = renderRoleAdmin({ tenantId: "tenant-a", version: 0, roles: [] });
    expect(html).toContain("No roles configured.");
    expect(html).not.toContain('class="error"');
  });

  it("renders cataloged and known roles with enable/disable forms", () => {
    const html = renderRoleAdmin(
      {
        tenantId: "tenant-a",
        version: 4,
        roles: [
          { name: "Reviewer", description: "Reviews things", enabled: true, version: 2 },
          { name: "Archived Role", enabled: false, version: 1 }
        ]
      },
      { error: "Role exists", knownRoles: ["Reviewer", "Guest"] }
    );
    expect(html).toContain("Role exists");
    expect(html).toContain("Reviews things");
    expect(html).toContain(">Disable</button>");
    expect(html).toContain(">Enable</button>");
    expect(html).toContain(">known</td>");
    expect(html).toContain(">Guest</td>");
    expect(html).not.toContain('<td data-label="Role">Reviewer</td><td data-label="Description">Referenced');
  });
});
