import { FrameworkError, notFound, permissionDenied } from "../core/errors";
import { can } from "../core/permissions";
import type { ModelRegistry } from "../core/registry";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type DocTypeDefinition,
  type DocumentSnapshot,
  type ListDocumentsResult
} from "../core/types";
import type { ProjectionStore } from "../ports/projection-store";

export interface QueryServiceOptions {
  readonly registry: ModelRegistry;
  readonly projections: ProjectionStore;
}

export class QueryService {
  private readonly registry: ModelRegistry;
  private readonly projections: ProjectionStore;

  constructor(options: QueryServiceOptions) {
    this.registry = options.registry;
    this.projections = options.projections;
  }

  listDoctypes(actor: Actor): readonly DocTypeDefinition[] {
    return this.registry.list().filter((doctype) => can(actor, doctype, "read"));
  }

  getMeta(actor: Actor, doctypeName: string): DocTypeDefinition {
    const doctype = this.registry.get(doctypeName);
    if (!can(actor, doctype, "read")) {
      throw permissionDenied(`Actor '${actor.id}' cannot read ${doctype.name}`);
    }
    return doctype;
  }

  async getDocument(
    actor: Actor,
    doctypeName: string,
    name: string,
    tenantId = actor.tenantId ?? DEFAULT_TENANT_ID
  ): Promise<DocumentSnapshot> {
    const doctype = this.registry.get(doctypeName);
    const document = await this.projections.get(tenantId, doctype.name, name);
    if (!document || document.docstatus === "deleted") {
      throw notFound(`${doctype.name}/${name} was not found`);
    }
    if (!can(actor, doctype, "read", document)) {
      throw permissionDenied(`Actor '${actor.id}' cannot read ${doctype.name}/${name}`);
    }
    return document;
  }

  async listDocuments(
    actor: Actor,
    doctypeName: string,
    options: { readonly tenantId?: string; readonly limit?: number; readonly offset?: number } = {}
  ): Promise<ListDocumentsResult> {
    const doctype = this.registry.get(doctypeName);
    if (!can(actor, doctype, "read")) {
      throw permissionDenied(`Actor '${actor.id}' cannot read ${doctype.name}`);
    }
    const limit = clampLimit(options.limit);
    const offset = Math.max(0, options.offset ?? 0);
    const result = await this.projections.list({
      tenantId: options.tenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID,
      doctype: doctype.name,
      limit,
      offset
    });
    return {
      ...result,
      data: result.data.filter((document) => document.docstatus !== "deleted" && can(actor, doctype, "read", document))
    };
  }
}

function clampLimit(limit?: number): number {
  if (limit === undefined) {
    return 50;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new FrameworkError("BAD_REQUEST", "limit must be a positive integer", { status: 400 });
  }
  return Math.min(limit, 200);
}
