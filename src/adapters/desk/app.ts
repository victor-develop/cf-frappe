import { Hono } from "hono";
import type { DocumentCommandExecutor } from "../../application/document-service";
import type { DocumentHistoryService } from "../../application/document-history-service";
import type { PrintService } from "../../application/print-service";
import { QueryService } from "../../application/query-service";
import type { ReportFilters, ReportService } from "../../application/report-service";
import { FrameworkError } from "../../core/errors";
import { can } from "../../core/permissions";
import type { ModelRegistry } from "../../core/registry";
import {
  CHILD_TABLE_ROW_INDEX_FIELD,
  type Actor,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentSnapshot,
  type FieldDefinition,
  type JsonPrimitive,
  type MutableDocumentData,
  type ResolvedFormView
} from "../../core/types";
import type { ActorResolver } from "../http/actor";
import { listFiltersFromUrl, parseOptionalInteger } from "../http/request";
import { renderPrintDocument } from "../print";
import {
  renderDeskHome,
  renderDeskLayout,
  renderErrorPanel,
  renderDocumentTimeline,
  renderFormView,
  renderListView,
  renderNotFound,
  renderReportList,
  renderReportView,
  type FormLifecycleAction,
  type FormLinkOptions,
  type FormTableDefinitions
} from "./render";

export interface DeskAppOptions {
  readonly registry: ModelRegistry;
  readonly documents: DocumentCommandExecutor;
  readonly prints?: PrintService;
  readonly queries: QueryService;
  readonly timeline?: DocumentHistoryService;
  readonly reports?: ReportService;
  readonly actor: ActorResolver;
}

export function createDeskApp(options: DeskAppOptions): Hono {
  const app = new Hono();

  app.onError((error, c) => renderDeskFailure(options, c.req.raw, error));

  app.get("/desk", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    return html(
      renderDeskLayout({
        title: "Home",
        doctypes,
        reports,
        body: renderDeskHome(doctypes, reports)
      })
    );
  });

  app.get("/desk/reports", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    return html(
      renderDeskLayout({
        title: "Reports",
        doctypes,
        reports,
        body: renderReportList(reports)
      })
    );
  });

  app.get("/desk/reports/:report", async (c) => {
    if (!options.reports) {
      throw new FrameworkError("REPORT_NOT_FOUND", "Reports are not enabled", { status: 404 });
    }
    const actor = await options.actor(c.req.raw);
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    const result = await options.reports.runReport(actor, c.req.param("report"), {
      filters: reportFiltersFromUrl(new URL(c.req.url)),
      limit: 100
    });
    return html(
      renderDeskLayout({
        title: result.report.label ?? result.report.name,
        activeReport: result.report.name,
        doctypes,
        reports,
        body: renderReportView(result)
      })
    );
  });

  app.get("/desk/print/:format/:name", async (c) => {
    if (!options.prints) {
      throw new FrameworkError("PRINT_FORMAT_NOT_FOUND", "Print formats are not enabled", { status: 404 });
    }
    const actor = await options.actor(c.req.raw);
    const view = await options.prints.printDocument(actor, c.req.param("format"), c.req.param("name"));
    return html(renderPrintDocument(view));
  });

  app.get("/desk/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    const filters = listFiltersFromUrl(url);
    const limit = parseOptionalInteger(url.searchParams.get("limit") ?? undefined);
    const offset = parseOptionalInteger(url.searchParams.get("offset") ?? undefined);
    const { listView, filters: effectiveFilters, result } = await options.queries.listDocumentsForView(actor, doctype.name, {
      filters,
      useDefaultFilters: url.searchParams.get("default_filters") !== "0",
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {})
    });
    return html(
      renderDeskLayout({
        title: doctype.label ?? doctype.name,
        active: doctype.name,
        doctypes,
        reports,
        body: renderListView(doctype, listView, result.data, effectiveFilters)
      })
    );
  });

  app.get("/desk/:doctype/new", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const formView = options.queries.getFormView(actor, doctype.name);
    const linkOptions = await linkOptionsForForm(options, actor, doctype, formView);
    const tableDefinitions = tableDefinitionsForForm(options, formView);
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    return html(
      renderDeskLayout({
        title: `New ${doctype.label ?? doctype.name}`,
        active: doctype.name,
        doctypes,
        reports,
        body: renderFormView(doctype, formView, { mode: "create", linkOptions, tableDefinitions })
      })
    );
  });

  app.post("/desk/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const formView = options.queries.getFormView(actor, doctype.name);
    try {
      const snapshot = await options.documents.create({
        actor,
        doctype: doctype.name,
        data: (await parseDeskForm(c.req.raw, doctype, formView, (name) => options.registry.get(name))).data,
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(snapshot.name)}`, 303);
    } catch (error) {
      return renderDeskError(options, c.req.raw, actor, doctype, "create", error);
    }
  });

  app.get("/desk/:doctype/:name", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    const printFormats = listPrintFormats(options, actor, doctype.name);
    const formView = options.queries.getFormView(actor, doctype.name);
    const document = await options.queries.getDocument(actor, doctype.name, c.req.param("name"));
    const linkOptions = await linkOptionsForForm(options, actor, doctype, formView);
    const tableDefinitions = tableDefinitionsForForm(options, formView);
    const lifecycleActions = lifecycleActionsFor(actor, doctype, document);
    const timeline = await options.timeline?.getTimeline(actor, doctype.name, document.name, { limit: 25 });
    const form = renderFormView(doctype, formView, {
      mode: "update",
      document,
      linkOptions,
      tableDefinitions,
      lifecycleActions,
      printFormats
    });
    return html(
      renderDeskLayout({
        title: document.name,
        active: doctype.name,
        doctypes,
        reports,
        body: `${form}${timeline ? renderDocumentTimeline(timeline) : ""}`
      })
    );
  });

  app.post("/desk/:doctype/:name", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const formView = options.queries.getFormView(actor, doctype.name);
    const name = c.req.param("name");
    try {
      const form = await parseDeskForm(c.req.raw, doctype, formView, (doctypeName) => options.registry.get(doctypeName));
      await options.documents.update({
        actor,
        doctype: doctype.name,
        name,
        patch: form.data,
        ...(form.expectedVersion !== undefined ? { expectedVersion: form.expectedVersion } : {}),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(name)}`, 303);
    } catch (error) {
      return renderDeskError(options, c.req.raw, actor, doctype, "update", error, name);
    }
  });

  app.post("/desk/:doctype/:name/command/:command", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const formView = options.queries.getFormView(actor, doctype.name);
    const name = c.req.param("name");
    try {
      const form = await parseDeskForm(c.req.raw, doctype, formView, (doctypeName) => options.registry.get(doctypeName));
      await options.documents.execute({
        actor,
        doctype: doctype.name,
        name,
        command: c.req.param("command"),
        input: form.data,
        ...(form.expectedVersion !== undefined ? { expectedVersion: form.expectedVersion } : {}),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(name)}`, 303);
    } catch (error) {
      return renderDeskError(options, c.req.raw, actor, doctype, "update", error, name);
    }
  });

  app.post("/desk/:doctype/:name/submit", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const name = c.req.param("name");
    try {
      const expectedVersion = await parseDeskExpectedVersion(c.req.raw);
      await options.documents.submit({
        actor,
        doctype: doctype.name,
        name,
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(name)}`, 303);
    } catch (error) {
      return renderDeskError(options, c.req.raw, actor, doctype, "update", error, name);
    }
  });

  app.post("/desk/:doctype/:name/cancel", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const name = c.req.param("name");
    try {
      const expectedVersion = await parseDeskExpectedVersion(c.req.raw);
      await options.documents.cancel({
        actor,
        doctype: doctype.name,
        name,
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(name)}`, 303);
    } catch (error) {
      return renderDeskError(options, c.req.raw, actor, doctype, "update", error, name);
    }
  });

  app.notFound((c) =>
    html(
      renderDeskLayout({
        title: "Not found",
        doctypes: [],
        reports: [],
        body: renderNotFound("Page not found")
      }),
      404
    )
  );

  return app;
}

async function renderDeskFailure(options: DeskAppOptions, request: Request, error: unknown): Promise<Response> {
  const status = error instanceof FrameworkError ? error.status : 500;
  const message = error instanceof FrameworkError ? error.message : error instanceof Error ? error.message : "Request failed";
  const doctypes = await Promise.resolve(options.actor(request))
    .then((actor) => options.queries.listDoctypes(actor))
    .catch(() => []);
  const reports = await Promise.resolve(options.actor(request))
    .then((actor) => listReports(options, actor))
    .catch(() => []);
  return html(
    renderDeskLayout({
      title: status === 404 ? "Not found" : "Request failed",
      doctypes,
      reports,
      body: status === 404 ? renderNotFound(message) : renderErrorPanel(message)
    }),
    status
  );
}

async function renderDeskError(
  options: DeskAppOptions,
  request: Request,
  actor: Actor,
  doctype: DocTypeDefinition,
  mode: "create" | "update",
  error: unknown,
  name?: string
): Promise<Response> {
  const doctypes = options.queries.listDoctypes(actor);
  const reports = listReports(options, actor);
  const formView = options.queries.getFormView(actor, doctype.name);
  const linkOptions = await linkOptionsForForm(options, actor, doctype, formView);
  const tableDefinitions = tableDefinitionsForForm(options, formView);
  const document = name ? await options.queries.getDocument(actor, doctype.name, name).catch(() => undefined) : undefined;
  const message = error instanceof FrameworkError ? error.message : error instanceof Error ? error.message : "Request failed";
  return html(
    renderDeskLayout({
      title: mode === "create" ? `New ${doctype.label ?? doctype.name}` : name ?? doctype.name,
      active: doctype.name,
      doctypes,
      reports,
      body: renderFormView(doctype, formView, {
        mode,
        ...(document ? { document } : {}),
        linkOptions,
        tableDefinitions,
        ...(document ? { lifecycleActions: lifecycleActionsFor(actor, doctype, document) } : {}),
        ...(document ? { printFormats: listPrintFormats(options, actor, doctype.name) } : {}),
        error: message
      })
    }),
    error instanceof FrameworkError ? error.status : 500
  );
}

function listReports(options: DeskAppOptions, actor: Actor) {
  return options.reports?.listReports(actor) ?? [];
}

function listPrintFormats(options: DeskAppOptions, actor: Actor, doctype?: string) {
  return options.prints?.listPrintFormats(actor, doctype) ?? [];
}

function lifecycleActionsFor(
  actor: Actor,
  doctype: DocTypeDefinition,
  document: DocumentSnapshot
): readonly FormLifecycleAction[] {
  if (document.docstatus === "draft" && can(actor, doctype, "submit", document)) {
    return ["submit"];
  }
  if (document.docstatus === "submitted" && can(actor, doctype, "cancel", document)) {
    return ["cancel"];
  }
  return [];
}

async function linkOptionsForForm(
  options: DeskAppOptions,
  actor: Actor,
  doctype: DocTypeDefinition,
  formView: ResolvedFormView
): Promise<FormLinkOptions> {
  const entries = await Promise.all(
    formView.fields.flatMap((field) => {
      if (field.type === "link") {
        return [
          async () => {
            const result = await options.queries.listLinkOptions(actor, doctype.name, field.name);
            return [field.name, result.options] as const;
          }
        ];
      }
      if (field.type === "table" && field.tableOf) {
        const child = options.registry.get(field.tableOf);
        return child.fields
          .filter((childField) => childField.type === "link")
          .map((childField) => async () => {
            const result = await options.queries.listLinkOptionsForField(actor, child, childField.name);
            return [`${field.name}.${childField.name}`, result.options] as const;
          });
      }
      return [];
    }).map((load) => load())
  );
  return Object.fromEntries(entries) as FormLinkOptions;
}

function tableDefinitionsForForm(options: DeskAppOptions, formView: ResolvedFormView): FormTableDefinitions {
  const entries = formView.fields
    .filter((field) => field.type === "table" && field.tableOf)
    .map((field) => [field.name, options.registry.get(field.tableOf!)] as const);
  return Object.fromEntries(entries) as FormTableDefinitions;
}

function reportFiltersFromUrl(url: URL): ReportFilters {
  const filters: Record<string, JsonPrimitive> = {};
  url.searchParams.forEach((value, key) => {
    if (key.startsWith("filter_")) {
      filters[key.slice("filter_".length)] = value;
    }
  });
  return filters;
}

interface ParsedDeskForm {
  readonly data: MutableDocumentData;
  readonly expectedVersion?: number;
}

async function parseDeskForm(
  request: Request,
  doctype: DocTypeDefinition,
  formView: ResolvedFormView,
  relatedDocType: (doctype: string) => DocTypeDefinition
): Promise<ParsedDeskForm> {
  const form = await request.formData();
  const fields = new Set(doctype.fields.map((field) => field.name));
  const entries = formView.fields
    .filter((field) => fields.has(field.name))
    .filter((field) => !field.hidden && !field.readOnly)
    .map((field) => [
      field.name,
      field.type === "table" && field.tableOf
        ? coerceTableFormValue(field, relatedDocType(field.tableOf), form)
        : coerceFormValue(field, form.get(field.name))
    ] as const)
    .filter(([, value]) => value !== undefined);
  const data = Object.fromEntries(entries) as MutableDocumentData;
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    data,
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskExpectedVersion(request: Request): Promise<number | undefined> {
  const form = await request.formData();
  return coerceExpectedVersion(form.get("expectedVersion"));
}

function coerceTableFormValue(
  field: FieldDefinition,
  child: DocTypeDefinition,
  form: FormData
): DocumentData[string] | undefined {
  const childFields = child.fields.filter((childField) => !childField.hidden && !childField.readOnly);
  const rows = tableRowIndexes(form, field.name)
    .filter((rowIndex) => !isEmptyTableRow(form, field.name, rowIndex, childFields))
    .map((rowIndex) => {
      const row = Object.fromEntries(
        childFields
          .map((childField) => [
            childField.name,
            coerceFormValue(childField, form.get(tableInputName(field.name, rowIndex, childField.name)))
          ] as const)
          .filter(([, value]) => value !== undefined)
      ) as MutableDocumentData;
      const origin = coerceChildRowOrigin(form.get(tableInputName(field.name, rowIndex, CHILD_TABLE_ROW_INDEX_FIELD)));
      if (origin !== undefined) {
        row[CHILD_TABLE_ROW_INDEX_FIELD] = origin;
      }
      return row;
    });
  const nonEmptyRows = rows.filter((row) => Object.keys(row).length > 0);
  if (nonEmptyRows.length === 0) {
    return field.required ? [] : undefined;
  }
  return nonEmptyRows as DocumentData[string];
}

function isEmptyTableRow(
  form: FormData,
  tableField: string,
  rowIndex: number,
  childFields: readonly FieldDefinition[]
): boolean {
  return childFields.every((childField) => {
    const value = form.get(tableInputName(tableField, rowIndex, childField.name));
    return value === null || value === "";
  });
}

function tableRowIndexes(form: FormData, tableField: string): readonly number[] {
  const indexes = new Set<number>();
  const pattern = new RegExp(`^${escapeRegExp(tableField)}\\[(\\d+)\\]\\.`);
  form.forEach((_, key) => {
    const match = key.match(pattern);
    if (match?.[1] !== undefined) {
      indexes.add(Number(match[1]));
    }
  });
  return [...indexes].sort((left, right) => left - right);
}

function tableInputName(tableField: string, rowIndex: number, childField: string): string {
  return `${tableField}[${rowIndex}].${childField}`;
}

function coerceChildRowOrigin(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function coerceFormValue(field: FieldDefinition, value: FormDataEntryValue | null): DocumentData[string] | undefined {
  if (value === null) {
    return field.type === "boolean" ? false : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  if (value === "" && !field.required) {
    return undefined;
  }
  if (field.type === "integer") {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : value;
  }
  if (field.type === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (field.type === "boolean") {
    return value === "on" || value === "true";
  }
  if (field.type === "json") {
    try {
      return JSON.parse(value) as DocumentData[string];
    } catch {
      return value;
    }
  }
  return value;
}

function coerceExpectedVersion(value: FormDataEntryValue | null): number | undefined {
  if (value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new FrameworkError("BAD_REQUEST", "expectedVersion must be an integer", { status: 400 });
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new FrameworkError("BAD_REQUEST", "expectedVersion must be an integer", { status: 400 });
  }
  return parsed;
}

function requestMetadata(request: Request): DocumentData {
  return {
    method: request.method,
    url: request.url
  };
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}
