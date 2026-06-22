import { FrameworkError, notFound, permissionDenied } from "../core/errors";
import { resolveFormView } from "../core/form-view";
import { mergeListFilters, normalizeListFilters, resolveListView } from "../core/list-view";
import { can } from "../core/permissions";
import type { ModelRegistry } from "../core/registry";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type DocTypeDefinition,
  type DocumentSnapshot,
  type FieldDefinition,
  type ListDocumentsFilter,
  type ListDocumentsResult,
  type LinkOption,
  type LinkOptionsResult,
  type ResolvedFormView,
  type ResolvedListView
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

  getListView(actor: Actor, doctypeName: string): ResolvedListView {
    return resolveListView(this.getMeta(actor, doctypeName));
  }

  getFormView(actor: Actor, doctypeName: string): ResolvedFormView {
    return resolveFormView(this.getMeta(actor, doctypeName));
  }

  async listLinkOptions(
    actor: Actor,
    doctypeName: string,
    fieldName: string,
    options: {
      readonly tenantId?: string;
      readonly q?: string;
      readonly limit?: number;
    } = {}
  ): Promise<LinkOptionsResult> {
    const doctype = this.getMeta(actor, doctypeName);
    return this.listLinkOptionsForField(actor, doctype, fieldName, options);
  }

  async listLinkOptionsForField(
    actor: Actor,
    doctype: DocTypeDefinition,
    fieldName: string,
    options: {
      readonly tenantId?: string;
      readonly q?: string;
      readonly limit?: number;
    } = {}
  ): Promise<LinkOptionsResult> {
    const field = getField(doctype, fieldName);
    if (field.type !== "link" || !field.linkTo) {
      throw new FrameworkError("BAD_REQUEST", `Field '${fieldName}' on ${doctype.name} is not a link field`, {
        status: 400
      });
    }
    const target = this.registry.get(field.linkTo);
    if (!can(actor, target, "read")) {
      throw permissionDenied(`Actor '${actor.id}' cannot read ${target.name}`);
    }
    const limit = clampLimit(options.limit ?? 20);
    const search = normalizeSearch(options.q);
    const tenantId = options.tenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID;
    const linkOptions = await this.collectLinkOptions(actor, target, tenantId, search, limit);
    return {
      doctype: doctype.name,
      field: field.name,
      target: target.name,
      options: linkOptions
    };
  }

  async listDocumentsForView(
    actor: Actor,
    doctypeName: string,
    options: {
      readonly tenantId?: string;
      readonly filters?: readonly ListDocumentsFilter[];
      readonly useDefaultFilters?: boolean;
      readonly limit?: number;
      readonly offset?: number;
    } = {}
  ): Promise<{
    readonly listView: ResolvedListView;
    readonly filters: readonly ListDocumentsFilter[];
    readonly result: ListDocumentsResult;
  }> {
    const doctype = this.registry.get(doctypeName);
    if (!can(actor, doctype, "read")) {
      throw permissionDenied(`Actor '${actor.id}' cannot read ${doctype.name}`);
    }
    const listView = resolveListView(doctype);
    const filters = mergeDefaultFilters(
      options.useDefaultFilters === false ? [] : listView.filters,
      options.filters ?? []
    );
    const result = await this.listDocuments(actor, doctype.name, {
      ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
      filters,
      limit: options.limit ?? listView.pageSize,
      ...(options.offset !== undefined ? { offset: options.offset } : {})
    });
    return { listView, filters, result };
  }

  private async collectLinkOptions(
    actor: Actor,
    target: DocTypeDefinition,
    tenantId: string,
    search: string | undefined,
    limit: number
  ): Promise<readonly LinkOption[]> {
    const matches: LinkOption[] = [];
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const result = await this.listDocuments(actor, target.name, { tenantId, limit: pageSize, offset });
      for (const document of result.data) {
        const option = toLinkOption(document, target);
        if (!search || matchesLinkSearch(option, search)) {
          matches.push(option);
          if (matches.length >= limit) {
            return matches;
          }
        }
      }
      if (offset + pageSize >= result.total) {
        return matches;
      }
    }
  }
}

function mergeDefaultFilters(
  defaults: readonly ListDocumentsFilter[],
  overrides: readonly ListDocumentsFilter[]
): readonly ListDocumentsFilter[] {
  return mergeListFilters(defaults, overrides);
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

function getField(doctype: DocTypeDefinition, fieldName: string): FieldDefinition {
  const field = doctype.fields.find((item) => item.name === fieldName);
  if (!field) {
    throw new FrameworkError("BAD_REQUEST", `Field '${fieldName}' is not defined on ${doctype.name}`, {
      status: 400
    });
  }
  return field;
}

function normalizeSearch(q: string | undefined): string | undefined {
  const search = q?.trim().toLowerCase();
  return search ? search : undefined;
}

function toLinkOption(document: DocumentSnapshot, doctype: DocTypeDefinition): LinkOption {
  return {
    value: document.name,
    label: labelForLinkedDocument(document, doctype)
  };
}

function labelForLinkedDocument(document: DocumentSnapshot, doctype: DocTypeDefinition): string {
  const title = document.data.title;
  if (typeof title === "string" && title.length > 0) {
    return title;
  }
  if (doctype.naming?.kind === "field") {
    const namedValue = document.data[doctype.naming.field];
    if (typeof namedValue === "string" && namedValue.length > 0) {
      return namedValue;
    }
  }
  return document.name;
}

function matchesLinkSearch(option: LinkOption, search: string): boolean {
  return option.value.toLowerCase().includes(search) || option.label.toLowerCase().includes(search);
}
