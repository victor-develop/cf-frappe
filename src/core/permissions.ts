import type { Actor, DocTypeDefinition, DocumentSnapshot, PermissionAction } from "./types.js";
import { SYSTEM_MANAGER_ROLE } from "./types.js";

export function can(
  actor: Actor,
  doctype: DocTypeDefinition,
  action: PermissionAction,
  document?: DocumentSnapshot
): boolean {
  if (actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  const rules = doctype.permissions ?? [];
  return rules.some((rule) => {
    const roleMatch = rule.roles.some((role) => actor.roles.includes(role));
    const actionMatch = rule.actions.includes(action);
    const conditionMatch = rule.when?.({
      actor,
      action,
      doctype,
      ...(document ? { document } : {})
    }) ?? true;
    return roleMatch && actionMatch && conditionMatch;
  });
}
