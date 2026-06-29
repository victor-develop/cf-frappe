import {
  foldUserPermissions,
  isUserPermissionEvent,
  isUserPermissionPayloadKind,
  replayUserPermissionAppend,
  USER_PERMISSION_PAYLOAD_KINDS,
  userPermissionDocumentName,
  userPermissionEvent,
  userPermissionEventType,
  userPermissionPayload
} from "../../src";
import type { DomainEvent, UserPermissionGrant } from "../../src";

const admin = {
  id: "admin@example.com",
  roles: ["System Manager"],
  tenantId: "acme"
};

const grant: UserPermissionGrant = {
  targetDoctype: "Project",
  targetName: "Apollo",
  applicableDoctypes: ["Issue", "Task"]
};

describe("user permission events", () => {
  it("derives user permission event types from payload identity", () => {
    expect(userPermissionEventType(userPermissionPayload({
      kind: "UserPermissionAllowed",
      userId: "owner@example.com",
      grant
    }))).toBe("UserPermissionAllowed");
    expect(userPermissionEventType(userPermissionPayload({
      kind: "UserPermissionRevoked",
      userId: "owner@example.com",
      grant
    }))).toBe("UserPermissionRevoked");
  });

  it("creates typed user permission events from payload identity", () => {
    expect(userPermissionEvent({
      id: "evt_permission",
      tenantId: "acme",
      stream: "acme:__UserPermissions:owner@example.com",
      actor: admin,
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: userPermissionPayload({
        kind: "UserPermissionAllowed",
        userId: "owner@example.com",
        grant
      })
    })).toMatchObject({
      id: "evt_permission",
      type: "UserPermissionAllowed",
      doctype: "__UserPermissions",
      documentName: "owner@example.com",
      actorId: admin.id,
      payload: {
        kind: "UserPermissionAllowed",
        userId: "owner@example.com",
        targetDoctype: "Project",
        targetName: "Apollo",
        applicableDoctypes: ["Issue", "Task"]
      },
      metadata: {}
    });
  });

  it("shapes allow and revoke payloads from normalized grants", () => {
    expect(userPermissionPayload({
      kind: "UserPermissionAllowed",
      userId: "owner@example.com",
      grant
    })).toEqual({
      kind: "UserPermissionAllowed",
      userId: "owner@example.com",
      targetDoctype: "Project",
      targetName: "Apollo",
      applicableDoctypes: ["Issue", "Task"]
    });
    expect(userPermissionPayload({
      kind: "UserPermissionRevoked",
      userId: "owner@example.com",
      grant: { targetDoctype: "Project", targetName: "Apollo" }
    })).toEqual({
      kind: "UserPermissionRevoked",
      userId: "owner@example.com",
      targetDoctype: "Project",
      targetName: "Apollo"
    });
  });

  it("uses the user id as the event document name", () => {
    expect(userPermissionDocumentName(userPermissionPayload({
      kind: "UserPermissionAllowed",
      userId: "owner@example.com",
      grant
    }))).toBe("owner@example.com");
  });

  it("replays appended events against the previous stream prefix", () => {
    const previous = [allowedEvent(1)];
    const state = foldUserPermissions("acme", "owner@example.com", previous);
    const replayed = replayUserPermissionAppend(state, previous, [revokedEvent(2)]);

    expect(replayed).toMatchObject({ tenantId: "acme", userId: "owner@example.com", version: 2, grants: [] });
  });

  it("exposes the bounded user permission payload kind set", () => {
    expect(USER_PERMISSION_PAYLOAD_KINDS).toEqual([
      "UserPermissionAllowed",
      "UserPermissionRevoked"
    ]);
  });

  it("narrows user permission events by payload kind when event type names are custom", () => {
    const allowed = allowedEvent(1);
    const imported = { ...allowed, type: "ProjectAccessGrantedByPolicy" };

    expect(isUserPermissionPayloadKind("UserPermissionAllowed")).toBe(true);
    expect(isUserPermissionPayloadKind("DocumentDeleted")).toBe(false);
    expect(isUserPermissionEvent(imported)).toBe(true);
    expect(isUserPermissionEvent(event({ kind: "DocumentDeleted" }))).toBe(false);
  });

  it("folds user permission state by payload kind when event type names are custom", () => {
    const misleadingUnrelated = event({ kind: "DocumentDeleted" }, "UserPermissionAllowed");
    const customTypedAllowed = {
      ...allowedEvent(2),
      type: "ProjectAccessGrantedByPolicy"
    };

    const state = foldUserPermissions("acme", "owner@example.com", [misleadingUnrelated, customTypedAllowed]);

    expect(state.version).toBe(2);
    expect(state.grants).toEqual([grant]);
  });
});

function event(payload: DomainEvent["payload"], type: string = payload.kind): DomainEvent {
  return {
    id: "evt_other",
    tenantId: "acme",
    stream: "acme:Note:NOTE-1",
    sequence: 1,
    type,
    doctype: "Note",
    documentName: "NOTE-1",
    actorId: admin.id,
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload,
    metadata: {}
  };
}

function allowedEvent(sequence: number): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "acme:__UserPermissions:owner@example.com",
    sequence,
    type: "UserPermissionAllowed",
    doctype: "__UserPermissions",
    documentName: "owner@example.com",
    actorId: admin.id,
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: userPermissionPayload({
      kind: "UserPermissionAllowed",
      userId: "owner@example.com",
      grant
    }),
    metadata: {}
  };
}

function revokedEvent(sequence: number): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "acme:__UserPermissions:owner@example.com",
    sequence,
    type: "UserPermissionRevoked",
    doctype: "__UserPermissions",
    documentName: "owner@example.com",
    actorId: admin.id,
    occurredAt: "2026-01-01T00:05:00.000Z",
    payload: userPermissionPayload({
      kind: "UserPermissionRevoked",
      userId: "owner@example.com",
      grant
    }),
    metadata: {}
  };
}
