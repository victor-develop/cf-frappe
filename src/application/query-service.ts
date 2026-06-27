import { notFound, permissionDenied } from "../core/errors.js";
import { resolveFormView } from "../core/form-view.js";
import {
  normalizeListFilterExpression,
  normalizeListFilters,
  normalizeListOrder,
  resolveListView
} from "../core/list-view.js";
import type {
  DocumentSharePermission,
  DocumentShareProvider
} from "../core/document-shares.js";
import { can } from "../core/permissions.js";
import type { ModelRegistry } from "../core/registry.js";
import {
  type UserPermissionGrant,
  type UserPermissionProvider
} from "../core/user-permissions.js";
import {
  canReadLinkedDocumentTarget,
  canUseDocumentAction,
  canUseVisibleDocument
} from "./document-access-policy.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type DocTypeDefinition,
  type DocumentSnapshot,
  type FieldDefinition,
  type GlobalSearchResult,
  type GlobalSearchResultItem,
  type ListDocumentsFilter,
  type ListFilterExpression,
  type ListDocumentsResult,
  type ListOrderDirection,
  type LinkOption,
  type LinkOptionsResult,
  type PermissionAction,
  type ResolvedFormView,
  type ResolvedListView
} from "../core/types.js";
import type { ProjectionStore } from "../ports/projection-store.js";
import { CSV_CONTENT_TYPE, csvLine, filenamePart } from "./csv.js";
import {
  DEFAULT_DOCUMENT_CSV_EXPORT_LIMIT,
  clampCsvExportLimit,
  clampLimit,
  clampSearchLimit,
  compareSearchResults,
  documentCsvColumns,
  getLinkField,
  globalSearchMatch,
  matchesLinkSearch,
  mergeDefaultFilters,
  normalizeRequiredSearch,
  normalizeSearch,
  toGlobalSearchResult,
  toLinkOption
} from "./document-query-policy.js";

export interface QueryServiceOptions {
  readonly registry: ModelRegistry;
  readonly projections: ProjectionStore;
  readonly doctypeResolver?: QueryServiceDocTypeResolver;
  readonly userPermissions?: UserPermissionProvider;
  readonly documentShares?: DocumentShareProvider;
}

export type QueryServiceDocTypeResolver = (
  base: DocTypeDefinition,
  context: { readonly actor: Actor; readonly tenantId: string }
) => DocTypeDefinition | Promise<DocTypeDefinition>;

export interface DocumentCsvExportOptions {
  readonly tenantId?: string;
  readonly filters?: readonly ListDocumentsFilter[];
  readonly filterExpression?: ListFilterExpression;
  readonly useDefaultFilters?: boolean;
  readonly orderBy?: string;
  readonly order?: ListOrderDirection;
  readonly limit?: number;
}

export interface DocumentCsvExport {
  readonly filename: string;
  readonly contentType: typeof CSV_CONTENT_TYPE;
  readonly body: string;
  readonly exported: number;
  readonly total: number;
  readonly truncated: boolean;
  readonly limit: number;
}

export class QueryService {
  private readonly registry: ModelRegistry;
  private readonly projections: ProjectionStore;
  private readonly doctypeResolver: QueryServiceDocTypeResolver | undefined;
  private readonly userPermissions: UserPermissionProvider | undefined;
  private readonly documentShares: DocumentShareProvider | undefined;

  constructor(options: QueryServiceOptions) {
    this.registry = options.registry;
    this.projections = options.projections;
    this.doctypeResolver = options.doctypeResolver;
    this.userPermissions = options.userPermissions;
    this.documentShares = options.documentShares;
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

  getCreateMeta(actor: Actor, doctypeName: string): DocTypeDefinition {
    const doctype = this.registry.get(doctypeName);
    if (!can(actor, doctype, "create")) {
      throw permissionDenied(`Actor '${actor.id}' cannot create ${doctype.name}`);
    }
    return doctype;
  }

  async getDocument(
    actor: Actor,
    doctypeName: string,
    name: string,
    tenantId = actor.tenantId ?? DEFAULT_TENANT_ID
  ): Promise<DocumentSnapshot> {
    const doctype = await this.doctypeFor(actor, doctypeName, tenantId);
    const document = await this.projections.get(tenantId, doctype.name, name);
    if (!document || document.docstatus === "deleted") {
      throw notFound(`${doctype.name}/${name} was not found`);
    }
    if (!(await this.canReadDocument(actor, doctype, document))) {
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
      readonly filterExpression?: ListFilterExpression;
      readonly orderBy?: string;
      readonly order?: ListOrderDirection;
      readonly limit?: number;
      readonly offset?: number;
      readonly maxLimit?: number;
    } = {}
  ): Promise<ListDocumentsResult> {
    const tenantId = options.tenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID;
    const doctype = await this.doctypeFor(actor, doctypeName, tenantId);
    if (!can(actor, doctype, "read")) {
      throw permissionDenied(`Actor '${actor.id}' cannot read ${doctype.name}`);
    }
    const limit = clampLimit(options.limit, options.maxLimit);
    const offset = Math.max(0, options.offset ?? 0);
    const order = normalizeListOrder(doctype, options.orderBy, options.order);
    const filters = normalizeListFilters(doctype, options.filters ?? []);
    const filterExpression = options.filterExpression === undefined
      ? undefined
      : normalizeListFilterExpression(doctype, options.filterExpression);
    const result = await this.projections.list({
      tenantId,
      doctype: doctype.name,
      filters,
      ...(filterExpression === undefined ? {} : { filterExpression }),
      orderBy: order.orderBy,
      order: order.order,
      limit,
      offset
    });
    const data = await this.filterReadableDocuments(actor, doctype, result.data);
    return {
      ...result,
      data
    };
  }

  getListView(actor: Actor, doctypeName: string): ResolvedListView {
    return resolveListView(this.getMeta(actor, doctypeName));
  }

  getFormView(actor: Actor, doctypeName: string): ResolvedFormView {
    return resolveFormView(this.getMeta(actor, doctypeName));
  }

  async listEffectiveDoctypes(
    actor: Actor,
    tenantId = actor.tenantId ?? DEFAULT_TENANT_ID
  ): Promise<readonly DocTypeDefinition[]> {
    return Promise.all(this.listDoctypes(actor).map((doctype) => this.resolveDocType(doctype, actor, tenantId)));
  }

  async getEffectiveMeta(
    actor: Actor,
    doctypeName: string,
    tenantId = actor.tenantId ?? DEFAULT_TENANT_ID
  ): Promise<DocTypeDefinition> {
    return this.resolveDocType(this.getMeta(actor, doctypeName), actor, tenantId);
  }

  async getEffectiveCreateMeta(
    actor: Actor,
    doctypeName: string,
    tenantId = actor.tenantId ?? DEFAULT_TENANT_ID
  ): Promise<DocTypeDefinition> {
    return this.resolveDocType(this.getCreateMeta(actor, doctypeName), actor, tenantId);
  }

  async resolveEffectiveDocType(
    actor: Actor,
    doctypeName: string,
    tenantId = actor.tenantId ?? DEFAULT_TENANT_ID
  ): Promise<DocTypeDefinition> {
    return this.doctypeFor(actor, doctypeName, tenantId);
  }

  async getEffectiveListView(
    actor: Actor,
    doctypeName: string,
    tenantId = actor.tenantId ?? DEFAULT_TENANT_ID
  ): Promise<ResolvedListView> {
    return resolveListView(await this.getEffectiveMeta(actor, doctypeName, tenantId));
  }

  async getEffectiveFormView(
    actor: Actor,
    doctypeName: string,
    tenantId = actor.tenantId ?? DEFAULT_TENANT_ID
  ): Promise<ResolvedFormView> {
    return resolveFormView(await this.getEffectiveMeta(actor, doctypeName, tenantId));
  }

  async getEffectiveCreateFormView(
    actor: Actor,
    doctypeName: string,
    tenantId = actor.tenantId ?? DEFAULT_TENANT_ID
  ): Promise<ResolvedFormView> {
    return resolveFormView(await this.getEffectiveCreateMeta(actor, doctypeName, tenantId));
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
    const tenantId = options.tenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID;
    const doctype = await this.doctypeFor(actor, doctypeName, tenantId);
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
    const field = getLinkField(doctype, fieldName);
    const target = this.registry.get(field.linkTo);
    if (!can(actor, target, "read")) {
      throw permissionDenied(`Actor '${actor.id}' cannot read ${target.name}`);
    }
    const limit = clampLimit(options.limit ?? 20);
    const search = normalizeSearch(options.q);
    const tenantId = options.tenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID;
    const linkOptions = await this.collectLinkOptions(actor, doctype, field, target, tenantId, search, limit);
    return {
      doctype: doctype.name,
      field: field.name,
      target: target.name,
      options: linkOptions
    };
  }

  async search(
    actor: Actor,
    options: {
      readonly tenantId?: string;
      readonly q?: string;
      readonly limit?: number;
    }
  ): Promise<GlobalSearchResult> {
    const tenantId = options.tenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID;
    const query = normalizeRequiredSearch(options.q);
    const limit = clampSearchLimit(options.limit);
    const results: GlobalSearchResultItem[] = [];
    for (const doctype of await this.listEffectiveDoctypes(actor, tenantId)) {
      await this.collectSearchResults(actor, doctype, tenantId, query, results);
    }
    const sorted = results.sort(compareSearchResults);
    return {
      query,
      limit,
      total: sorted.length,
      data: sorted.slice(0, limit)
    };
  }

  async listDocumentsForView(
    actor: Actor,
    doctypeName: string,
    options: {
      readonly tenantId?: string;
      readonly filters?: readonly ListDocumentsFilter[];
      readonly filterExpression?: ListFilterExpression;
      readonly useDefaultFilters?: boolean;
      readonly orderBy?: string;
      readonly order?: ListOrderDirection;
      readonly limit?: number;
      readonly offset?: number;
      readonly maxLimit?: number;
    } = {}
  ): Promise<{
    readonly listView: ResolvedListView;
    readonly filters: readonly ListDocumentsFilter[];
    readonly filterExpression?: ListFilterExpression;
    readonly result: ListDocumentsResult;
  }> {
    const tenantId = options.tenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID;
    const doctype = await this.doctypeFor(actor, doctypeName, tenantId);
    if (!can(actor, doctype, "read")) {
      throw permissionDenied(`Actor '${actor.id}' cannot read ${doctype.name}`);
    }
    const listView = resolveListView(doctype);
    const filters = mergeDefaultFilters(
      options.useDefaultFilters === false ? [] : listView.filters,
      options.filters ?? []
    );
    const filterExpression = options.filterExpression === undefined
      ? undefined
      : normalizeListFilterExpression(doctype, options.filterExpression);
    const order = normalizeListOrder(
      doctype,
      options.orderBy ?? listView.orderBy,
      options.order ?? listView.order
    );
    const result = await this.listDocuments(actor, doctype.name, {
      tenantId,
      filters,
      ...(filterExpression === undefined ? {} : { filterExpression }),
      orderBy: order.orderBy,
      order: order.order,
      limit: options.limit ?? listView.pageSize,
      ...(options.maxLimit === undefined ? {} : { maxLimit: options.maxLimit }),
      ...(options.offset !== undefined ? { offset: options.offset } : {})
    });
    return {
      listView: { ...listView, orderBy: order.orderBy, order: order.order },
      filters,
      ...(filterExpression === undefined ? {} : { filterExpression }),
      result
    };
  }

  async exportDocumentsCsv(
    actor: Actor,
    doctypeName: string,
    options: DocumentCsvExportOptions = {}
  ): Promise<DocumentCsvExport> {
    const limit = clampCsvExportLimit(options.limit);
    const { listView, result } = await this.listDocumentsForView(actor, doctypeName, {
      ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
      filters: options.filters ?? [],
      ...(options.filterExpression === undefined ? {} : { filterExpression: options.filterExpression }),
      ...(options.useDefaultFilters === undefined ? {} : { useDefaultFilters: options.useDefaultFilters }),
      ...(options.orderBy === undefined ? {} : { orderBy: options.orderBy }),
      ...(options.order === undefined ? {} : { order: options.order }),
      limit,
      maxLimit: DEFAULT_DOCUMENT_CSV_EXPORT_LIMIT
    });
    const columns = documentCsvColumns(listView.columns);
    const lines = [
      csvLine(columns.map((column) => column.label)),
      ...result.data.map((document) => csvLine(columns.map((column) => column.value(document))))
    ];
    const exported = result.data.length;
    return {
      filename: `${filenamePart(result.data[0]?.doctype ?? doctypeName, "documents")}.csv`,
      contentType: CSV_CONTENT_TYPE,
      body: lines.join("\n"),
      exported,
      total: result.total,
      truncated: exported < result.total,
      limit
    };
  }

  private async doctypeFor(actor: Actor, doctypeName: string, tenantId: string): Promise<DocTypeDefinition> {
    return this.resolveDocType(this.registry.get(doctypeName), actor, tenantId);
  }

  private async resolveDocType(
    base: DocTypeDefinition,
    actor: Actor,
    tenantId: string
  ): Promise<DocTypeDefinition> {
    return (await this.doctypeResolver?.(base, { actor, tenantId })) ?? base;
  }

  private async collectLinkOptions(
    actor: Actor,
    source: DocTypeDefinition,
    field: FieldDefinition,
    target: DocTypeDefinition,
    tenantId: string,
    search: string | undefined,
    limit: number
  ): Promise<readonly LinkOption[]> {
    const matches: LinkOption[] = [];
    const pageSize = 200;
    const grants = (await this.userPermissions?.permissionsFor(actor, tenantId)) ?? [];
    for (let offset = 0; ; offset += pageSize) {
      const result = await this.projections.list({
        tenantId,
        doctype: target.name,
        filters: [],
        limit: pageSize,
        offset
      });
      for (const document of result.data) {
        if (!(await this.canReadLinkTarget(actor, source, field, target, document, grants))) {
          continue;
        }
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

  private async collectSearchResults(
    actor: Actor,
    doctype: DocTypeDefinition,
    tenantId: string,
    query: string,
    results: GlobalSearchResultItem[]
  ): Promise<void> {
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const result = await this.projections.list({
        tenantId,
        doctype: doctype.name,
        filters: [],
        limit: pageSize,
        offset
      });
      const readable = await this.filterReadableDocuments(actor, doctype, result.data);
      for (const document of readable) {
        const match = globalSearchMatch(doctype, document, query);
        if (match) {
          results.push(toGlobalSearchResult(doctype, document, match));
        }
      }
      if (offset + pageSize >= result.total) {
        return;
      }
    }
  }

  private async filterReadableDocuments(
    actor: Actor,
    doctype: DocTypeDefinition,
    documents: readonly DocumentSnapshot[]
  ): Promise<readonly DocumentSnapshot[]> {
    const readable = await Promise.all(
      documents.map(async (document) => ({
        document,
        readable: document.docstatus !== "deleted" && (await this.canReadDocument(actor, doctype, document))
      }))
    );
    return readable.filter((entry) => entry.readable).map((entry) => entry.document);
  }

  async canReadDocument(actor: Actor, doctype: DocTypeDefinition, document: DocumentSnapshot): Promise<boolean> {
    const sharedPermissions = canUseDocumentAction({ actor, doctype, action: "read", document })
      ? []
      : await this.sharedPermissionsFor(actor, document);
    const grants = await this.userPermissions?.permissionsFor(actor, document.tenantId);
    return canUseVisibleDocument({
      actor,
      doctype,
      action: "read",
      document,
      sharedPermissions,
      userPermissionGrants: grants ?? []
    });
  }

  async canActOnDocument(
    actor: Actor,
    doctype: DocTypeDefinition,
    action: PermissionAction,
    document: DocumentSnapshot
  ): Promise<boolean> {
    const sharedPermissions = canUseDocumentAction({ actor, doctype, action, document })
      ? []
      : await this.sharedPermissionsFor(actor, document);
    const grants = await this.userPermissions?.permissionsFor(actor, document.tenantId);
    return canUseVisibleDocument({
      actor,
      doctype,
      action,
      document,
      sharedPermissions,
      userPermissionGrants: grants ?? []
    });
  }

  private async canReadLinkTarget(
    actor: Actor,
    source: DocTypeDefinition,
    field: FieldDefinition,
    target: DocTypeDefinition,
    document: DocumentSnapshot,
    grants: readonly UserPermissionGrant[]
  ): Promise<boolean> {
    const sharedPermissions = canUseDocumentAction({ actor, doctype: target, action: "read", document })
      ? []
      : await this.sharedPermissionsFor(actor, document);
    return canReadLinkedDocumentTarget({
      actor,
      sourceDoctype: source,
      field,
      targetDoctype: target,
      target: document,
      sharedPermissions,
      userPermissionGrants: grants
    });
  }

  private async sharedPermissionsFor(
    actor: Actor,
    document: DocumentSnapshot
  ): Promise<readonly DocumentSharePermission[]> {
    return await this.documentShares?.sharedPermissionsFor(actor, document) ?? [];
  }
}
