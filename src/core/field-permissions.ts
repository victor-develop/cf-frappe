import type {
  Actor,
  DocTypeDefinition,
  DocumentSnapshot,
  FieldDefinition,
  FieldPermissionAction,
  FieldPermissionContext,
  FieldPermissionRule,
  JsonValue,
  TenantId
} from "./types.js";
import { SYSTEM_MANAGER_ROLE } from "./types.js";

export interface FieldPermissionCheck {
  readonly actor: Actor;
  readonly action: FieldPermissionAction;
  readonly doctype: DocTypeDefinition;
  readonly field: FieldDefinition;
  readonly tenantId?: TenantId;
  readonly document?: DocumentSnapshot;
  readonly value?: JsonValue;
}

export function canAccessField(input: FieldPermissionCheck): boolean {
  if (input.actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  const rules = input.field.permissions ?? [];
  if (rules.length === 0) {
    return true;
  }
  return rules.some((rule) => fieldPermissionRuleAllows(rule, input));
}

export function canReadField(input: Omit<FieldPermissionCheck, "action">): boolean {
  return canAccessField({ ...input, action: "read" });
}

export function canWriteField(input: FieldPermissionCheck): boolean {
  return input.action === "create" || input.action === "update"
    ? canAccessField(input)
    : false;
}

export function canFieldAppearInMetadata(input: {
  readonly actor: Actor;
  readonly action: FieldPermissionAction;
  readonly field: FieldDefinition;
}): boolean {
  if (input.actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  const rules = input.field.permissions ?? [];
  if (rules.length === 0) {
    return true;
  }
  return rules.some((rule) => fieldPermissionRuleMatchesActorAndAction(rule, input.actor, input.action));
}

export function canFieldBeQueried(input: {
  readonly actor: Actor;
  readonly field: FieldDefinition;
}): boolean {
  if (input.actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  const rules = input.field.permissions ?? [];
  if (rules.length === 0) {
    return true;
  }
  return rules.some((rule) =>
    rule.when === undefined && fieldPermissionRuleMatchesActorAndAction(rule, input.actor, "read")
  );
}

export function fieldPermissionRuleMatchesActorAndAction(
  rule: FieldPermissionRule,
  actor: Actor,
  action: FieldPermissionAction
): boolean {
  return rule.actions.includes(action) && rule.roles.some((role) => actor.roles.includes(role));
}

function fieldPermissionRuleAllows(rule: FieldPermissionRule, input: FieldPermissionCheck): boolean {
  if (!fieldPermissionRuleMatchesActorAndAction(rule, input.actor, input.action)) {
    return false;
  }
  return rule.when?.(fieldPermissionContext(input)) ?? true;
}

function fieldPermissionContext(input: FieldPermissionCheck): FieldPermissionContext {
  return {
    actor: input.actor,
    action: input.action,
    doctype: input.doctype,
    field: input.field,
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    ...(input.document === undefined ? {} : { document: input.document }),
    ...(input.value === undefined ? {} : { value: input.value })
  };
}
