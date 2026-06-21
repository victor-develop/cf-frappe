import { Hono } from "hono";
import type { DocumentCommandExecutor } from "../../application/document-service";
import type { PrintService } from "../../application/print-service";
import { QueryService } from "../../application/query-service";
import type { ReportFilters, ReportService } from "../../application/report-service";
import { FrameworkError } from "../../core/errors";
import type { ModelRegistry } from "../../core/registry";
import type { Actor, DocTypeDefinition, DocumentData, FieldDefinition, JsonPrimitive, MutableDocumentData } from "../../core/types";
import type { ActorResolver } from "../http/actor";
import { renderPrintDocument } from "../print";
import {
  renderDeskHome,
  renderDeskLayout,
  renderErrorPanel,
  renderFormView,
  renderListView,
  renderNotFound,
  renderReportList,
  renderReportView
} from "./render";

export interface DeskAppOptions {
  readonly registry: ModelRegistry;
  readonly documents: DocumentCommandExecutor;
  readonly prints?: PrintService;
  readonly queries: QueryService;
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
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    const result = await options.queries.listDocuments(actor, doctype.name, { limit: 100 });
    return html(
      renderDeskLayout({
        title: doctype.label ?? doctype.name,
        active: doctype.name,
        doctypes,
        reports,
        body: renderListView(doctype, result.data)
      })
    );
  });

  app.get("/desk/:doctype/new", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    return html(
      renderDeskLayout({
        title: `New ${doctype.label ?? doctype.name}`,
        active: doctype.name,
        doctypes,
        reports,
        body: renderFormView(doctype, { mode: "create" })
      })
    );
  });

  app.post("/desk/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    try {
      const snapshot = await options.documents.create({
        actor,
        doctype: doctype.name,
        data: (await parseDeskForm(c.req.raw, doctype, "create")).data,
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
    const document = await options.queries.getDocument(actor, doctype.name, c.req.param("name"));
    return html(
      renderDeskLayout({
        title: document.name,
        active: doctype.name,
        doctypes,
        reports,
        body: renderFormView(doctype, { mode: "update", document, printFormats })
      })
    );
  });

  app.post("/desk/:doctype/:name", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const name = c.req.param("name");
    try {
      const form = await parseDeskForm(c.req.raw, doctype, "update");
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
    const name = c.req.param("name");
    try {
      const form = await parseDeskForm(c.req.raw, doctype, "update");
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
  const document = name ? await options.queries.getDocument(actor, doctype.name, name).catch(() => undefined) : undefined;
  const message = error instanceof FrameworkError ? error.message : error instanceof Error ? error.message : "Request failed";
  return html(
    renderDeskLayout({
      title: mode === "create" ? `New ${doctype.label ?? doctype.name}` : name ?? doctype.name,
      active: doctype.name,
      doctypes,
      reports,
      body: renderFormView(doctype, {
        mode,
        ...(document ? { document } : {}),
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
  mode: "create" | "update"
): Promise<ParsedDeskForm> {
  const form = await request.formData();
  const entries = doctype.fields
    .filter((field) => !field.hidden && !field.readOnly)
    .map((field) => [field.name, coerceFormValue(field, form.get(field.name))] as const)
    .filter(([, value]) => value !== undefined);
  const data = Object.fromEntries(entries) as MutableDocumentData;
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    data,
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
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
