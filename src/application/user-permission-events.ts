import { foldUserPermissions, type UserPermissionGrant, type UserPermissionState } from "../core/user-permissions.js";
import type {
  Actor,
  DocTypeName,
  DocumentData,
  DocumentName,
  DomainEvent,
  NewDomainEvent,
  StreamName,
  TenantId
} from "../core/types.js";

export type UserPermissionEventPayload =
  | {
      readonly kind: "UserPermissionAllowed";
      readonly userId: string;
      readonly targetDoctype: DocTypeName;
      readonly targetName: DocumentName;
      readonly applicableDoctypes?: readonly DocTypeName[];
    }
  | {
      readonly kind: "UserPermissionRevoked";
      readonly userId: string;
      readonly targetDoctype: DocTypeName;
      readonly targetName: DocumentName;
      readonly applicableDoctypes?: readonly DocTypeName[];
    };

export const USER_PERMISSION_PAYLOAD_KINDS = Object.freeze([
  "UserPermissionAllowed",
  "UserPermissionRevoked"
] as const);

export interface UserPermissionPayloadOptions {
  readonly kind: UserPermissionEventPayload["kind"];
  readonly userId: string;
  readonly grant: UserPermissionGrant;
}

export function userPermissionPayload(options: UserPermissionPayloadOptions): UserPermissionEventPayload {
  return {
    kind: options.kind,
    userId: options.userId,
    targetDoctype: options.grant.targetDoctype,
    targetName: options.grant.targetName,
    ...(options.grant.applicableDoctypes !== undefined ? { applicableDoctypes: options.grant.applicableDoctypes } : {})
  };
}

export interface UserPermissionEventOptions<TPayload extends UserPermissionEventPayload> {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly stream: StreamName;
  readonly actor: Actor;
  readonly occurredAt: string;
  readonly payload: TPayload;
  readonly metadata?: DocumentData;
}

export function userPermissionEvent<TPayload extends UserPermissionEventPayload>(
  options: UserPermissionEventOptions<TPayload>
): NewDomainEvent<TPayload> {
  return {
    id: options.id,
    tenantId: options.tenantId,
    stream: options.stream,
    type: userPermissionEventType(options.payload),
    doctype: "__UserPermissions",
    documentName: userPermissionDocumentName(options.payload),
    actorId: options.actor.id,
    occurredAt: options.occurredAt,
    payload: options.payload,
    metadata: options.metadata ?? {}
  };
}

export function userPermissionEventType(payload: UserPermissionEventPayload): UserPermissionEventPayload["kind"] {
  return payload.kind;
}

export function userPermissionDocumentName(payload: UserPermissionEventPayload): string {
  return payload.userId;
}

export function replayUserPermissionAppend(
  state: UserPermissionState,
  previousEvents: readonly DomainEvent[],
  savedEvents: readonly DomainEvent[]
): UserPermissionState {
  return foldUserPermissions(state.tenantId, state.userId, [...previousEvents, ...savedEvents]);
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly UserPermissionAllowed: Extract<
      UserPermissionEventPayload,
      { readonly kind: "UserPermissionAllowed" }
    >;
    readonly UserPermissionRevoked: Extract<
      UserPermissionEventPayload,
      { readonly kind: "UserPermissionRevoked" }
    >;
  }
}
