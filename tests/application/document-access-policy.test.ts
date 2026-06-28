import { describe, expect, it } from "vitest";

import {
  canReadLinkedDocumentTarget,
  canUseDocumentAction,
  canUseVisibleDocument,
  defineDocType,
  documentSatisfiesUserPermissions,
  planDocumentSharedPermissionLookup,
  type Actor,
  type DocumentSnapshot
} from "../../src";

const reader: Actor = { id: "reader@example.com", roles: ["Reader"] };
const collaborator: Actor = { id: "collab@example.com", roles: ["Guest"] };

const Project = defineDocType({
  name: "Project",
  fields: [{ name: "title", type: "text" }],
  permissions: [{ roles: ["Reader"], actions: ["read"] }]
});

const Task = defineDocType({
  name: "Task",
  fields: [
    { name: "project", type: "link", linkTo: "Project" },
    { name: "title", type: "text" }
  ],
  permissions: [{ roles: ["Reader"], actions: ["read", "update"] }]
});

const project = snapshot("Project", "PROJ-1", { title: "Apollo" });
const task = snapshot("Task", "TASK-1", { project: "PROJ-1", title: "Launch" });

describe("document access policy", () => {
  it("allows document actions through static DocType permissions", () => {
    expect(canUseDocumentAction({
      actor: reader,
      doctype: Task,
      action: "update",
      document: task
    })).toBe(true);
  });

  it("allows document actions through shared document permissions", () => {
    expect(canUseDocumentAction({
      actor: collaborator,
      doctype: Task,
      action: "update",
      document: task,
      sharedPermissions: ["read", "update"]
    })).toBe(true);
    expect(canUseDocumentAction({
      actor: collaborator,
      doctype: Task,
      action: "delete",
      document: task,
      sharedPermissions: ["read", "update"]
    })).toBe(false);
  });

  it("skips shared-permission lookup when static permissions already allow the action", () => {
    expect(planDocumentSharedPermissionLookup({
      actor: reader,
      doctype: Task,
      action: "update",
      document: task
    })).toEqual({ status: "skip", sharedPermissions: [] });
  });

  it("skips shared-permission lookup when supplied shares already allow the action", () => {
    expect(planDocumentSharedPermissionLookup({
      actor: collaborator,
      doctype: Task,
      action: "update",
      document: task,
      sharedPermissions: ["update"]
    })).toEqual({ status: "skip", sharedPermissions: [] });
  });

  it("plans shared-permission lookup when static and supplied shares do not allow the action", () => {
    expect(planDocumentSharedPermissionLookup({
      actor: collaborator,
      doctype: Task,
      action: "update",
      document: task
    })).toEqual({ status: "read-shares" });
  });

  it("rejects deleted documents from visible access even when permissions match", () => {
    expect(canUseVisibleDocument({
      actor: reader,
      doctype: Task,
      action: "read",
      document: { ...task, docstatus: "deleted" }
    })).toBe(false);
  });

  it("applies user-permission grants to visible documents", () => {
    expect(documentSatisfiesUserPermissions({
      doctype: Task,
      document: task,
      userPermissionGrants: [{ targetDoctype: "Project", targetName: "PROJ-1" }]
    })).toBe(true);
    expect(canUseVisibleDocument({
      actor: reader,
      doctype: Task,
      action: "read",
      document: task,
      userPermissionGrants: [{ targetDoctype: "Project", targetName: "PROJ-2" }]
    })).toBe(false);
  });

  it("allows linked targets when read access and link grants both match", () => {
    expect(canReadLinkedDocumentTarget({
      actor: collaborator,
      sourceDoctype: Task,
      field: Task.fields[0]!,
      targetDoctype: Project,
      target: project,
      sharedPermissions: ["read"],
      userPermissionGrants: [{ targetDoctype: "Project", targetName: "PROJ-1", applicableDoctypes: ["Task"] }]
    })).toBe(true);
  });

  it("rejects linked targets that fail action, deletion, or link-grant checks", () => {
    expect(canReadLinkedDocumentTarget({
      actor: collaborator,
      sourceDoctype: Task,
      field: Task.fields[0]!,
      targetDoctype: Project,
      target: project
    })).toBe(false);
    expect(canReadLinkedDocumentTarget({
      actor: reader,
      sourceDoctype: Task,
      field: Task.fields[0]!,
      targetDoctype: Project,
      target: { ...project, docstatus: "deleted" }
    })).toBe(false);
    expect(canReadLinkedDocumentTarget({
      actor: reader,
      sourceDoctype: Task,
      field: Task.fields[0]!,
      targetDoctype: Project,
      target: project,
      userPermissionGrants: [{ targetDoctype: "Project", targetName: "PROJ-2", applicableDoctypes: ["Task"] }]
    })).toBe(false);
  });
});

function snapshot(doctype: string, name: string, data: DocumentSnapshot["data"]): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype,
    name,
    version: 1,
    docstatus: "draft",
    data,
    createdAt: "2026-06-28T01:00:00.000Z",
    updatedAt: "2026-06-28T01:00:00.000Z"
  };
}
