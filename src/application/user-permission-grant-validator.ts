import { foldDocument } from "../core/events.js";
import { badRequest } from "../core/errors.js";
import type { ModelRegistry } from "../core/registry.js";
import { documentStream } from "../core/streams.js";
import type { TenantId } from "../core/types.js";
import type { UserPermissionGrant } from "../core/user-permissions.js";
import type { EventStore } from "../ports/event-store.js";

export interface UserPermissionGrantValidation {
  readonly tenantId: TenantId;
  readonly grant: UserPermissionGrant;
}

export interface UserPermissionGrantValidator {
  validateGrant(validation: UserPermissionGrantValidation): Promise<void>;
}

export class ModelBackedUserPermissionGrantValidator implements UserPermissionGrantValidator {
  private readonly registry: ModelRegistry;
  private readonly events: EventStore;

  constructor(options: { readonly registry: ModelRegistry; readonly events: EventStore }) {
    this.registry = options.registry;
    this.events = options.events;
  }

  async validateGrant(validation: UserPermissionGrantValidation): Promise<void> {
    const target = this.registeredDoctype(validation.grant.targetDoctype, "Target DocType");
    for (const applicableDoctype of validation.grant.applicableDoctypes ?? []) {
      const applicable = this.registeredDoctype(applicableDoctype, "Applicable DocType");
      if (
        applicable.name !== target.name &&
        !applicable.fields.some((field) => field.type === "link" && field.linkTo === target.name)
      ) {
        throw badRequest(`Applicable DocType '${applicable.name}' does not link to ${target.name}`);
      }
    }
    const snapshot = foldDocument(
      await this.events.readStream(documentStream(validation.tenantId, target.name, validation.grant.targetName))
    );
    if (!snapshot || snapshot.docstatus === "deleted") {
      throw badRequest(`Target document ${target.name}/${validation.grant.targetName} does not exist`);
    }
  }

  private registeredDoctype(name: string, label: string) {
    if (!this.registry.has(name)) {
      throw badRequest(`${label} '${name}' is not registered`);
    }
    return this.registry.get(name);
  }
}
