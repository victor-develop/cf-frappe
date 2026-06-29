import { describe, expect, it } from "vitest";

import {
  defineDocType,
  resolveTenant,
  resolveTenantDocType,
  resolveTenantDocTypeContext,
  type Actor,
  type DocTypeDefinition
} from "../../src";

describe("document tenant policy", () => {
  const actor: Actor = { id: "owner@example.com", roles: ["User"], tenantId: "actor_tenant" };

  it("prefers an explicit command tenant over the actor tenant", () => {
    expect(resolveTenant(actor, "command_tenant"))
      .toBe("command_tenant");
  });

  it("uses the actor tenant when the command does not specify one", () => {
    expect(resolveTenant(actor)).toBe("actor_tenant");
  });

  it("falls back to the default tenant for tenantless actors and commands", () => {
    expect(resolveTenant({ id: "owner@example.com", roles: ["User"] })).toBe("default");
  });

  it("resolves tenant-specific DocType metadata through the configured resolver", async () => {
    const Task = defineDocType({ name: "Task", fields: [{ name: "title", type: "text" }] });
    const TenantTask = defineDocType({
      name: "Task",
      fields: [
        { name: "title", type: "text" },
        { name: "tenant_field", type: "text" }
      ]
    });
    const calls: Array<{ readonly base: string; readonly tenantId: string; readonly actor: Actor }> = [];

    await expect(resolveTenantDocType(Task, { actor, tenantId: "tenant-a" }, (base, context) => {
      calls.push({ base: base.name, tenantId: context.tenantId, actor: context.actor });
      return TenantTask;
    })).resolves.toBe(TenantTask);
    expect(calls).toEqual([{ base: "Task", tenantId: "tenant-a", actor }]);
  });

  it("falls back to base DocType metadata when no tenant resolver is configured", async () => {
    const Task = defineDocType({ name: "Task", fields: [{ name: "title", type: "text" }] });

    await expect(resolveTenantDocType(Task, { actor, tenantId: "tenant-a" })).resolves.toBe(Task);
  });

  it("builds a related DocType context for transitive link and table references", async () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "project", type: "link", linkTo: "Project" },
        { name: "items", type: "table", tableOf: "Task Item" }
      ]
    });
    const Project = defineDocType({
      name: "Project",
      fields: [{ name: "owner", type: "link", linkTo: "User" }]
    });
    const TaskItem = defineDocType({
      name: "Task Item",
      fields: [{ name: "task", type: "link", linkTo: "Task" }]
    });
    const User = defineDocType({ name: "User", fields: [{ name: "email", type: "text" }] });
    const doctypes = new Map([Task, Project, TaskItem, User].map((doctype) => [doctype.name, doctype]));
    const lookups: string[] = [];

    const context = await resolveTenantDocTypeContext(Task, async (name) => {
      lookups.push(name);
      return requireDocType(doctypes, name);
    });

    expect(context.doctype).toBe(Task);
    expect(context.relatedDocType("Task")).toBe(Task);
    expect(context.relatedDocType("Project")).toBe(Project);
    expect(context.relatedDocType("Task Item")).toBe(TaskItem);
    expect(context.relatedDocType("User")).toBe(User);
    expect(context.relatedDocType("Missing")).toBeUndefined();
    expect(lookups).toEqual(["Project", "User", "Task Item"]);
  });
});

function requireDocType(doctypes: ReadonlyMap<string, DocTypeDefinition>, name: string): DocTypeDefinition {
  const doctype = doctypes.get(name);
  if (doctype === undefined) {
    throw new Error(`Missing DocType ${name}`);
  }
  return doctype;
}
