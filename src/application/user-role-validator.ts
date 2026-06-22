import { validationFailed } from "../core/errors.js";
import { foldRoleCatalog, normalizeRoleName } from "../core/roles.js";
import { roleCatalogStream } from "../core/streams.js";
import type { TenantId, ValidationIssue } from "../core/types.js";
import type { EventStore } from "../ports/event-store.js";

export interface UserRoleValidationContext {
  readonly tenantId: TenantId;
  readonly roles: readonly string[];
}

export interface UserRoleValidator {
  validateRoles(context: UserRoleValidationContext): Promise<void>;
}

export interface RoleCatalogUserRoleValidatorOptions {
  readonly events: EventStore;
}

export class RoleCatalogUserRoleValidator implements UserRoleValidator {
  private readonly events: EventStore;

  constructor(options: RoleCatalogUserRoleValidatorOptions) {
    this.events = options.events;
  }

  async validateRoles(context: UserRoleValidationContext): Promise<void> {
    if (context.roles.length === 0) {
      return;
    }
    const state = foldRoleCatalog(
      context.tenantId,
      await this.events.readStream(roleCatalogStream(context.tenantId))
    );
    const catalog = new Map(state.roles.map((role) => [role.name, role]));
    const issues: ValidationIssue[] = [];
    for (const role of context.roles.map(normalizeRoleName)) {
      const catalogRole = catalog.get(role);
      if (!catalogRole) {
        issues.push({
          field: "roles",
          code: "role_not_found",
          message: `Role '${role}' is not in the role catalog`
        });
        continue;
      }
      if (!catalogRole.enabled) {
        issues.push({
          field: "roles",
          code: "role_disabled",
          message: `Role '${role}' is disabled`
        });
      }
    }
    if (issues.length > 0) {
      throw validationFailed(issues);
    }
  }
}
