import {
  documentShareAllows,
  documentSharePermissionsForActor,
  foldDocumentShares,
  invalidDocumentSharePermissions,
  normalizeDocumentShareGrant
} from "../../src";
import type { DomainEvent } from "../../src";
import { now } from "../helpers";

describe("document share folding", () => {
  const base = {
    tenantId: "acme",
    stream: "acme:Note:Shared",
    doctype: "Note",
    documentName: "Shared",
    actorId: "owner@example.com",
    occurredAt: now,
    metadata: {}
  };

  it("normalizes write aliases and implied read grants", () => {
    expect(normalizeDocumentShareGrant({
      userId: " collab@example.com ",
      permissions: ["write", "share", "read", "write"]
    })).toEqual({
      userId: "collab@example.com",
      permissions: ["read", "share", "update"]
    });
  });

  it("folds current grants from share and revoke events", () => {
    const events: DomainEvent[] = [
      {
        ...base,
        id: "evt1",
        sequence: 1,
        type: "NoteCreated",
        payload: { kind: "DocumentCreated", data: { title: "Shared" }, docstatus: "draft" }
      },
      {
        ...base,
        id: "evt2",
        sequence: 2,
        type: "NoteShared",
        payload: { kind: "DocumentShared", userId: "collab@example.com", permissions: ["read"] }
      },
      {
        ...base,
        id: "evt3",
        sequence: 3,
        type: "NoteShared",
        payload: { kind: "DocumentShared", userId: "ops@example.com", permissions: ["read", "update"] }
      },
      {
        ...base,
        id: "evt4",
        sequence: 4,
        type: "NoteShareRevoked",
        payload: { kind: "DocumentShareRevoked", userId: "collab@example.com" }
      }
    ];

    const state = foldDocumentShares("acme", "Note", "Shared", events);

    expect(state).toEqual({
      tenantId: "acme",
      doctype: "Note",
      name: "Shared",
      version: 4,
      grants: [{ userId: "ops@example.com", permissions: ["read", "update"] }]
    });
    expect(documentSharePermissionsForActor({ id: "ops@example.com", roles: ["User"] }, state.grants))
      .toEqual(["read", "update"]);
    expect(documentShareAllows(state.grants[0]?.permissions ?? [], "update")).toBe(true);
    expect(documentShareAllows(state.grants[0]?.permissions ?? [], "delete")).toBe(false);
  });

  it("reports invalid permission strings without rejecting write aliases", () => {
    expect(invalidDocumentSharePermissions(["read", "write", "delete", ""])).toEqual(["delete"]);
  });

  it("unions grants that match actor id or email", () => {
    expect(
      documentSharePermissionsForActor(
        { id: "u123", email: "person@example.com", roles: ["User"] },
        [
          { userId: "person@example.com", permissions: ["read"] },
          { userId: "u123", permissions: ["update"] }
        ]
      )
    ).toEqual(["read", "update"]);
  });
});
