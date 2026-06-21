import { FrameworkError, notFound, permissionDenied } from "../core/errors";
import { can } from "../core/permissions";
import type { ModelRegistry } from "../core/registry";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type DocTypeDefinition,
  type DocumentSnapshot,
  type FieldDefinition,
  type JsonPrimitive,
  type ListDocumentsFilter,
  type ListFilterOperator,
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
    options: {
      readonly tenantId?: string;
      readonly filters?: readonly ListDocumentsFilter[];
      readonly limit?: number;
      readonly offset?: number;
    } = {}
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
      filters: normalizeListFilters(doctype, options.filters ?? []),
      limit,
      offset
    });
    return {
      ...result,
      data: result.data.filter((document) => document.docstatus !== "deleted" && can(actor, doctype, "read", document))
    };
  }
}

function normalizeListFilters(
  doctype: DocTypeDefinition,
  filters: readonly ListDocumentsFilter[]
): readonly ListDocumentsFilter[] {
  if (filters.length === 0) {
    return [];
  }
  const fields = new Map(doctype.fields.map((field) => [field.name, field]));
  return filters.map((filter) => {
    const field = fields.get(filter.field);
    if (!field) {
      throw new FrameworkError("BAD_REQUEST", `Filter field '${filter.field}' is not defined on ${doctype.name}`, {
        status: 400
      });
    }
    if (field.type === "json") {
      throw new FrameworkError("BAD_REQUEST", `Filter field '${filter.field}' cannot be a json field`, {
        status: 400
      });
    }
    const operator = normalizeFilterOperator(filter.operator);
    if (field.type === "boolean" && operator !== "eq") {
      throw new FrameworkError("BAD_REQUEST", `Boolean filter '${filter.field}' only supports eq`, {
        status: 400
      });
    }
    return {
      field: filter.field,
      ...(operator === "eq" ? {} : { operator }),
      value: coerceFilterValue(field, filter.value)
    };
  });
}

function normalizeFilterOperator(operator: unknown): ListFilterOperator {
  if (operator === undefined) {
    return "eq";
  }
  if (operator === "eq" || operator === "contains" || operator === "gte" || operator === "lte") {
    return operator;
  }
  throw new FrameworkError("BAD_REQUEST", `Unsupported list filter operator '${String(operator)}'`, { status: 400 });
}

function coerceFilterValue(field: FieldDefinition, value: JsonPrimitive): JsonPrimitive {
  if (value === null) {
    throw new FrameworkError("BAD_REQUEST", `Filter '${field.name}' cannot be null`, { status: 400 });
  }
  if (field.type === "integer") {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(parsed)) {
      throw new FrameworkError("BAD_REQUEST", `Filter '${field.name}' must be an integer`, { status: 400 });
    }
    return parsed;
  }
  if (field.type === "number") {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      throw new FrameworkError("BAD_REQUEST", `Filter '${field.name}' must be a number`, { status: 400 });
    }
    return parsed;
  }
  if (field.type === "boolean") {
    if (typeof value === "boolean") {
      return value;
    }
    if (value === "true" || value === "1" || value === "on") {
      return true;
    }
    if (value === "false" || value === "0" || value === "off") {
      return false;
    }
    throw new FrameworkError("BAD_REQUEST", `Filter '${field.name}' must be a boolean`, { status: 400 });
  }
  return typeof value === "string" ? value : String(value);
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
