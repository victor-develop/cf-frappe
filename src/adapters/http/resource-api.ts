import { Hono } from "hono";
import type { AuditService } from "../../application/audit-service";
import type { DocumentCommandExecutor } from "../../application/document-service";
import type { DocumentHistoryService } from "../../application/document-history-service";
import type { FileService } from "../../application/file-service";
import type { PrintService } from "../../application/print-service";
import { QueryService } from "../../application/query-service";
import type { ReportService } from "../../application/report-service";
import type { SavedListFilterService } from "../../application/saved-list-filter-service";
import type { ModelRegistry } from "../../core/registry";
import { badRequest } from "../../core/errors";
import type { DocumentData, JsonPrimitive, ListDocumentsFilter, MutableDocumentData } from "../../core/types";
import type { ActorResolver } from "./actor";
import { createAuditApi } from "./audit-api";
import { toErrorResponse } from "./errors";
import { createFileApi } from "./file-api";
import { createPrintApi } from "./print-api";
import { createReportApi } from "./report-api";
import { listFiltersFromUrl, parseOptionalInteger, readBoundedText, requestMetadata } from "./request";

export interface ResourceApiOptions {
  readonly registry: ModelRegistry;
  readonly documents: DocumentCommandExecutor;
  readonly queries: QueryService;
  readonly timeline?: DocumentHistoryService;
  readonly savedFilters?: SavedListFilterService;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
  readonly files?: FileService;
  readonly prints?: PrintService;
  readonly reports?: ReportService;
  readonly audit?: AuditService;
  readonly maxFileBytes?: number;
}

export function createResourceApi(options: ResourceApiOptions): Hono {
  const app = new Hono();
  const resolveActor = options.actor;
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.onError((error, c) => toErrorResponse(error, c));
  app.notFound((c) =>
    c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Route not found"
        }
      },
      404
    )
  );

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/api/meta/doctypes", async (c) => {
    const actor = await resolveActor(c.req.raw);
    return c.json({ data: options.queries.listDoctypes(actor) });
  });

  app.get("/api/meta/doctypes/:doctype", async (c) => {
    const actor = await resolveActor(c.req.raw);
    return c.json({ data: options.queries.getMeta(actor, c.req.param("doctype")) });
  });

  app.get("/api/link-options/:doctype/:field", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const q = c.req.query("q");
    const limit = parseOptionalInteger(c.req.query("limit"));
    const data = await options.queries.listLinkOptions(actor, c.req.param("doctype"), c.req.param("field"), {
      ...(q !== undefined ? { q } : {}),
      ...(limit !== undefined ? { limit } : {})
    });
    return c.json({ data });
  });

  if (options.files) {
    app.route(
      "/",
      createFileApi({
        files: options.files,
        actor: resolveActor,
        ...(options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes })
      })
    );
  }

  if (options.reports) {
    app.route(
      "/",
      createReportApi({
        reports: options.reports,
        actor: resolveActor
      })
    );
  }

  if (options.prints) {
    app.route(
      "/",
      createPrintApi({
        prints: options.prints,
        actor: resolveActor
      })
    );
  }

  if (options.audit) {
    app.route(
      "/",
      createAuditApi({
        audit: options.audit,
        actor: resolveActor
      })
    );
  }

  app.get("/api/resource/:doctype", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const url = new URL(c.req.url);
    const limit = parseOptionalInteger(c.req.query("limit"));
    const offset = parseOptionalInteger(c.req.query("offset"));
    const savedFilter = await savedFilterFromUrl(options, actor, c.req.param("doctype"), url);
    const urlFilters = listFiltersFromUrl(url);
    const filters = options.savedFilters?.mergeSavedFilter(savedFilter, urlFilters) ?? urlFilters;
    const { result } = await options.queries.listDocumentsForView(actor, c.req.param("doctype"), {
      filters,
      useDefaultFilters: savedFilter ? false : url.searchParams.get("default_filters") !== "0",
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {})
    });
    return c.json(result);
  });

  app.post("/api/resource/:doctype", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { maxJsonBytes });
    const documentData = withoutKeys(body, ["name", "expectedVersion"]);
    const name = stringValue(body.name);
    const snapshot = await options.documents.create({
      actor,
      doctype: c.req.param("doctype"),
      data: documentData,
      ...(name !== undefined ? { name } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot }, 201);
  });

  if (options.timeline) {
    const timeline = options.timeline;
    app.get("/api/resource/:doctype/:name/timeline", async (c) => {
      const actor = await resolveActor(c.req.raw);
      const limit = parseOptionalInteger(c.req.query("limit"));
      const beforeSequence = parseOptionalInteger(c.req.query("before_sequence"));
      const data = await timeline.getTimeline(actor, c.req.param("doctype"), c.req.param("name"), {
        ...(limit !== undefined ? { limit } : {}),
        ...(beforeSequence !== undefined ? { beforeSequence } : {})
      });
      return c.json({ data });
    });

    app.get("/api/resource/:doctype/:name/assignments", async (c) => {
      const actor = await resolveActor(c.req.raw);
      const data = await timeline.getAssignments(actor, c.req.param("doctype"), c.req.param("name"));
      return c.json({ data });
    });

    app.get("/api/resource/:doctype/:name/tags", async (c) => {
      const actor = await resolveActor(c.req.raw);
      const data = await timeline.getTags(actor, c.req.param("doctype"), c.req.param("name"));
      return c.json({ data });
    });
  }

  if (options.savedFilters) {
    const savedFilters = options.savedFilters;
    app.get("/api/resource/:doctype/saved-filters", async (c) => {
      const actor = await resolveActor(c.req.raw);
      const data = await savedFilters.list(actor, c.req.param("doctype"));
      return c.json({ data });
    });

    app.post("/api/resource/:doctype/saved-filters", async (c) => {
      const actor = await resolveActor(c.req.raw);
      const body = await readJson(c.req.raw, { maxJsonBytes });
      if (isRecord(body) && body.id !== undefined) {
        throw badRequest("Saved filter id is server-generated");
      }
      const data = await savedFilters.save({
        actor,
        doctype: c.req.param("doctype"),
        label: stringValue(body.label) ?? "",
        filters: filtersValue(body.filters)
      });
      return c.json({ data }, 201);
    });

    app.delete("/api/resource/:doctype/saved-filters/:filterId", async (c) => {
      const actor = await resolveActor(c.req.raw);
      await savedFilters.delete({
        actor,
        doctype: c.req.param("doctype"),
        id: c.req.param("filterId")
      });
      return c.body(null, 204);
    });
  }

  app.get("/api/resource/:doctype/:name", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const data = await options.queries.getDocument(actor, c.req.param("doctype"), c.req.param("name"));
    return c.json({ data });
  });

  app.put("/api/resource/:doctype/:name", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { maxJsonBytes });
    const patch = withoutKeys(body, ["expectedVersion"]);
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.update({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      patch,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
  });

  app.post("/api/resource/:doctype/:name/comments", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { maxJsonBytes });
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.comment({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      text: stringValue(body.text) ?? "",
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot }, 201);
  });

  app.post("/api/resource/:doctype/:name/activities", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { maxJsonBytes });
    const expectedVersion = numberValue(body.expectedVersion);
    const activityType = stringValue(body.activityType);
    const detail = stringValue(body.detail);
    const channel = stringValue(body.channel);
    const externalId = stringValue(body.externalId);
    const snapshot = await options.documents.recordActivity({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      ...(activityType !== undefined ? { activityType } : {}),
      subject: stringValue(body.subject) ?? "",
      ...(detail !== undefined ? { detail } : {}),
      ...(channel !== undefined ? { channel } : {}),
      ...(externalId !== undefined ? { externalId } : {}),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot }, 201);
  });

  app.post("/api/resource/:doctype/:name/assignments", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { maxJsonBytes });
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.assign({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      assignee: stringValue(body.assignee) ?? "",
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot }, 201);
  });

  app.delete("/api/resource/:doctype/:name/assignments/:assignee", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.unassign({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      assignee: c.req.param("assignee"),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
  });

  app.post("/api/resource/:doctype/:name/tags", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { maxJsonBytes });
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.tag({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      tag: stringValue(body.tag) ?? "",
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot }, 201);
  });

  app.delete("/api/resource/:doctype/:name/tags/:tag", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.untag({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      tag: c.req.param("tag"),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
  });

  app.post("/api/resource/:doctype/:name/transition/:action", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.transition({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      action: c.req.param("action"),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
  });

  app.post("/api/resource/:doctype/:name/submit", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.submit({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
  });

  app.post("/api/resource/:doctype/:name/cancel", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.cancel({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
  });

  app.post("/api/resource/:doctype/:name/command/:command", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const input = withoutKeys(body, ["expectedVersion"]);
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.execute({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      command: c.req.param("command"),
      input,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
  });

  app.delete("/api/resource/:doctype/:name", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.delete({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
  });

  return app;
}

async function readJson(
  request: Request,
  options: { readonly allowEmpty?: boolean; readonly maxJsonBytes: number }
): Promise<MutableDocumentData> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > options.maxJsonBytes) {
    throw badRequest(`JSON body exceeds ${options.maxJsonBytes} bytes`);
  }
  const text = await readBoundedText(request, options.maxJsonBytes, `JSON body exceeds ${options.maxJsonBytes} bytes`);
  if (!text.trim()) {
    if (options.allowEmpty) {
      return {};
    }
    throw badRequest("Request body must be JSON");
  }
  if (new TextEncoder().encode(text).byteLength > options.maxJsonBytes) {
    throw badRequest(`JSON body exceeds ${options.maxJsonBytes} bytes`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw badRequest("Request body contains malformed JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest("JSON body must be an object");
  }
  return value as MutableDocumentData;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest("expectedVersion must be an integer");
  }
  return value;
}

async function savedFilterFromUrl(
  options: ResourceApiOptions,
  actor: Awaited<ReturnType<ActorResolver>>,
  doctype: string,
  url: URL
) {
  const id = url.searchParams.get("saved_filter") ?? undefined;
  if (!id) {
    return undefined;
  }
  if (!options.savedFilters) {
    throw badRequest("Saved filters are not enabled");
  }
  return options.savedFilters.get(actor, doctype, id);
}

function filtersValue(value: unknown): readonly ListDocumentsFilter[] {
  if (!Array.isArray(value)) {
    throw badRequest("Saved filter filters must be an array");
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      throw badRequest("Saved filter entries must be objects");
    }
    const field = item.field;
    const operator = item.operator;
    const filterValue = item.value;
    if (typeof field !== "string") {
      throw badRequest("Saved filter field must be a string");
    }
    if (operator !== undefined && operator !== "eq" && operator !== "contains" && operator !== "gte" && operator !== "lte") {
      throw badRequest("Saved filter operator is invalid");
    }
    if (!isJsonPrimitive(filterValue)) {
      throw badRequest("Saved filter value must be scalar");
    }
    return {
      field,
      ...(operator === undefined || operator === "eq" ? {} : { operator }),
      value: filterValue
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function withoutKeys(data: MutableDocumentData, keys: readonly string[]): MutableDocumentData {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(data).filter(([key]) => !blocked.has(key))) as MutableDocumentData;
}
