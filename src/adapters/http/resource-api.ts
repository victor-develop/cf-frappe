import { Hono } from "hono";
import type { AuditService } from "../../application/audit-service.js";
import type { CustomFieldService } from "../../application/custom-field-service.js";
import type {
  DataPatchQueuePort,
  DataPatchRollbackQueuePort,
  DataPatchRollbackRetryQueuePort
} from "../../application/data-patch-jobs.js";
import type { DataPatchAdminPort } from "../../application/data-patch-service.js";
import type { DocumentShareService } from "../../application/document-share-service.js";
import type { BulkDocumentSelection, DocumentCommandExecutor } from "../../application/document-service.js";
import type { DocumentHistoryService } from "../../application/document-history-service.js";
import type { FileService } from "../../application/file-service.js";
import type { JobHistoryService } from "../../application/job-history-service.js";
import type { JobRetryPort } from "../../application/job-retry-service.js";
import type { JobScheduleService } from "../../application/job-schedule-service.js";
import type { PrintSettingsService } from "../../application/print-settings-service.js";
import type { PrintService } from "../../application/print-service.js";
import { QueryService } from "../../application/query-service.js";
import type { ReportService } from "../../application/report-service.js";
import type { RoleService } from "../../application/role-service.js";
import type { SavedListFilterService } from "../../application/saved-list-filter-service.js";
import type { SavedReportService } from "../../application/saved-report-service.js";
import type { UserAccountService } from "../../application/user-account-service.js";
import type { UserNotificationService } from "../../application/user-notification-service.js";
import type { UserPermissionService } from "../../application/user-permission-service.js";
import type { UserProfileService } from "../../application/user-profile-service.js";
import { badRequest, permissionDenied } from "../../core/errors.js";
import { isListFilterOperator } from "../../core/list-view.js";
import { can } from "../../core/permissions.js";
import { canReadReport } from "../../core/reports.js";
import type { ModelRegistry } from "../../core/registry.js";
import type { Actor, DocumentData, JsonPrimitive, ListDocumentsFilter, MutableDocumentData } from "../../core/types.js";
import { SYSTEM_MANAGER_ROLE } from "../../core/types.js";
import type { PrintPdfRenderer } from "../../ports/print-pdf-renderer.js";
import {
  canReadWorkspace,
  canReadWorkspaceShortcut,
  type WorkspaceDefinition,
  type WorkspaceShortcutDefinition
} from "../../core/workspace.js";
import type { ActorResolver } from "./actor.js";
import { createAuthApi, type AuthSessionOptions } from "./auth-api.js";
import { createAuditApi } from "./audit-api.js";
import { createCustomFieldApi } from "./custom-field-api.js";
import { createDataPatchApi } from "./data-patch-api.js";
import { toErrorResponse } from "./errors.js";
import { createFileApi } from "./file-api.js";
import { createJobApi } from "./job-api.js";
import { createNotificationApi } from "./notification-api.js";
import { createPrintApi } from "./print-api.js";
import { createReportApi } from "./report-api.js";
import { listFiltersFromUrl, parseOptionalInteger, readJsonObject, requestMetadata } from "./request.js";
import { createRoleApi } from "./role-api.js";
import { createSavedReportApi } from "./saved-report-api.js";
import { createUserAccountApi } from "./user-account-api.js";
import { createUserPermissionApi } from "./user-permission-api.js";
import { createUserProfileApi } from "./user-profile-api.js";

export interface ResourceApiOptions {
  readonly registry: ModelRegistry;
  readonly documents: DocumentCommandExecutor;
  readonly documentShares?: DocumentShareService;
  readonly queries: QueryService;
  readonly timeline?: DocumentHistoryService;
  readonly savedFilters?: SavedListFilterService;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
  readonly files?: FileService;
  readonly prints?: PrintService;
  readonly printSettings?: PrintSettingsService;
  readonly printPdfRenderer?: PrintPdfRenderer;
  readonly reports?: ReportService;
  readonly roles?: RoleService;
  readonly savedReports?: SavedReportService;
  readonly audit?: AuditService;
  readonly dataPatches?: DataPatchAdminPort;
  readonly dataPatchQueue?: DataPatchQueuePort;
  readonly dataPatchRollbackQueue?: DataPatchRollbackQueuePort;
  readonly dataPatchRollbackRetryQueue?: DataPatchRollbackRetryQueuePort;
  readonly jobs?: JobHistoryService;
  readonly jobRetry?: JobRetryPort;
  readonly jobSchedules?: JobScheduleService;
  readonly notifications?: UserNotificationService;
  readonly userAccounts?: UserAccountService;
  readonly userProfiles?: UserProfileService;
  readonly auth?: AuthSessionOptions;
  readonly userPermissions?: UserPermissionService;
  readonly customFields?: CustomFieldService;
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

  if (options.notifications) {
    app.route(
      "/",
      createNotificationApi({
        notifications: options.notifications,
        actor: resolveActor
      })
    );
  }

  if (options.userAccounts) {
    if (options.auth) {
      app.route(
        "/",
        createAuthApi({
          userAccounts: options.userAccounts,
          actor: resolveActor,
          session: options.auth,
          maxJsonBytes
        })
      );
    }
    app.route(
      "/",
      createUserAccountApi({
        userAccounts: options.userAccounts,
        actor: resolveActor,
        maxJsonBytes
      })
    );
  }

  if (options.userProfiles) {
    app.route(
      "/",
      createUserProfileApi({
        userProfiles: options.userProfiles,
        actor: resolveActor,
        maxJsonBytes
      })
    );
  }

  app.get("/api/meta/doctypes", async (c) => {
    const actor = await resolveActor(c.req.raw);
    return c.json({ data: await options.queries.listEffectiveDoctypes(actor) });
  });

  app.get("/api/meta/doctypes/:doctype", async (c) => {
    const actor = await resolveActor(c.req.raw);
    return c.json({ data: await options.queries.getEffectiveMeta(actor, c.req.param("doctype")) });
  });

  app.get("/api/meta/doctypes/:doctype/list-view", async (c) => {
    const actor = await resolveActor(c.req.raw);
    return c.json({ data: await options.queries.getEffectiveListView(actor, c.req.param("doctype")) });
  });

  app.get("/api/meta/workspaces", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const access = workspaceMetadataAccess(options, actor);
    return c.json({
      data: options.registry
        .listWorkspaces()
        .filter((workspace) => canReadWorkspace(actor, workspace))
        .map((workspace) => workspaceMetadataForActor(actor, workspace, access))
    });
  });

  app.get("/api/meta/workspaces/:workspace", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const workspace = options.registry.getWorkspace(c.req.param("workspace"));
    if (!canReadWorkspace(actor, workspace)) {
      throw permissionDenied(`Actor '${actor.id}' cannot read workspace '${workspace.name}'`);
    }
    return c.json({ data: workspaceMetadataForActor(actor, workspace, workspaceMetadataAccess(options, actor)) });
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
        maxJsonBytes,
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

  if (options.roles) {
    app.route(
      "/",
      createRoleApi({
        roles: options.roles,
        actor: resolveActor,
        maxJsonBytes
      })
    );
  }

  if (options.savedReports) {
    app.route(
      "/",
      createSavedReportApi({
        savedReports: options.savedReports,
        actor: resolveActor,
        maxJsonBytes
      })
    );
  }

  if (options.prints) {
    app.route(
      "/",
      createPrintApi({
        prints: options.prints,
        ...(options.printSettings === undefined ? {} : { printSettings: options.printSettings }),
        ...(options.printPdfRenderer === undefined ? {} : { pdfRenderer: options.printPdfRenderer }),
        actor: resolveActor,
        maxJsonBytes
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

  if (options.dataPatches) {
    app.route(
      "/",
      createDataPatchApi({
        dataPatches: options.dataPatches,
        ...(options.dataPatchQueue === undefined ? {} : { dataPatchQueue: options.dataPatchQueue }),
        ...(options.dataPatchRollbackQueue === undefined
          ? {}
          : { dataPatchRollbackQueue: options.dataPatchRollbackQueue }),
        ...(options.dataPatchRollbackRetryQueue === undefined
          ? {}
          : { dataPatchRollbackRetryQueue: options.dataPatchRollbackRetryQueue }),
        actor: resolveActor,
        maxJsonBytes
      })
    );
  }

  if (options.jobs || options.jobSchedules) {
    app.route(
      "/",
      createJobApi({
        ...(options.jobs === undefined ? {} : { jobs: options.jobs }),
        ...(options.jobRetry === undefined ? {} : { retry: options.jobRetry }),
        ...(options.jobSchedules === undefined ? {} : { schedules: options.jobSchedules }),
        actor: resolveActor,
        maxJsonBytes
      })
    );
  }

  if (options.userPermissions) {
    app.route(
      "/",
      createUserPermissionApi({
        userPermissions: options.userPermissions,
        actor: resolveActor,
        maxJsonBytes
      })
    );
  }

  if (options.customFields) {
    app.route(
      "/",
      createCustomFieldApi({
        customFields: options.customFields,
        actor: resolveActor,
        maxJsonBytes
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

  app.post("/api/resource/:doctype/delete", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { maxJsonBytes });
    const result = await options.documents.bulkDelete({
      actor,
      doctype: c.req.param("doctype"),
      documents: documentSelectionsValue(body.documents),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: result });
  });

  app.post("/api/resource/:doctype/bulk-submit", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { maxJsonBytes });
    const result = await options.documents.bulkSubmit({
      actor,
      doctype: c.req.param("doctype"),
      documents: documentSelectionsValue(body.documents),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: result });
  });

  app.post("/api/resource/:doctype/bulk-cancel", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { maxJsonBytes });
    const result = await options.documents.bulkCancel({
      actor,
      doctype: c.req.param("doctype"),
      documents: documentSelectionsValue(body.documents),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: result });
  });

  app.post("/api/resource/:doctype/bulk-transition/:action", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { maxJsonBytes });
    const result = await options.documents.bulkTransition({
      actor,
      doctype: c.req.param("doctype"),
      action: c.req.param("action"),
      documents: documentSelectionsValue(body.documents),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: result });
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

    app.get("/api/resource/:doctype/:name/followers", async (c) => {
      const actor = await resolveActor(c.req.raw);
      const data = await timeline.getFollowers(actor, c.req.param("doctype"), c.req.param("name"));
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

  if (options.documentShares) {
    const documentShares = options.documentShares;
    app.get("/api/resource/:doctype/:name/shares", async (c) => {
      const actor = await resolveActor(c.req.raw);
      const doctype = options.registry.get(c.req.param("doctype"));
      const document = await options.queries.getDocument(actor, doctype.name, c.req.param("name"));
      const data = await documentShares.getDocumentShares(actor, doctype, document);
      return c.json({ data });
    });

    app.post("/api/resource/:doctype/:name/shares", async (c) => {
      const actor = await resolveActor(c.req.raw);
      const body = await readJson(c.req.raw, { maxJsonBytes });
      const expectedVersion = numberValue(body.expectedVersion);
      const snapshot = await options.documents.share({
        actor,
        doctype: c.req.param("doctype"),
        name: c.req.param("name"),
        userId: stringValue(body.userId) ?? "",
        permissions: permissionsValue(body.permissions),
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        metadata: requestMetadata(c.req.raw)
      });
      return c.json({ data: snapshot }, 201);
    });

    app.delete("/api/resource/:doctype/:name/shares/:userId", async (c) => {
      const actor = await resolveActor(c.req.raw);
      const body = await readJson(c.req.raw, { allowEmpty: true, maxJsonBytes });
      const expectedVersion = numberValue(body.expectedVersion);
      const snapshot = await options.documents.revokeShare({
        actor,
        doctype: c.req.param("doctype"),
        name: c.req.param("name"),
        userId: c.req.param("userId"),
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        metadata: requestMetadata(c.req.raw)
      });
      return c.json({ data: snapshot });
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

  app.post("/api/resource/:doctype/:name/duplicate", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const expectedVersion = numberValue(body.expectedVersion);
    const data = objectValue(body.data, "Duplicate data");
    const newName = stringValue(body.newName);
    const snapshot = await options.documents.duplicate({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      ...(data === undefined ? {} : { data }),
      ...(newName === undefined ? {} : { newName }),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot }, 201);
  });

  app.post("/api/resource/:doctype/:name/amend", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const expectedVersion = numberValue(body.expectedVersion);
    const data = objectValue(body.data, "Amendment data");
    const newName = stringValue(body.newName);
    const snapshot = await options.documents.amend({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      ...(data === undefined ? {} : { data }),
      ...(newName === undefined ? {} : { newName }),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot }, 201);
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

  app.post("/api/resource/:doctype/:name/followers", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const expectedVersion = numberValue(body.expectedVersion);
    const follower = stringValue(body.follower);
    const snapshot = await options.documents.follow({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      ...(follower !== undefined ? { follower } : {}),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot }, 201);
  });

  app.delete("/api/resource/:doctype/:name/followers/:follower", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.unfollow({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      follower: c.req.param("follower"),
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
    const doctype = options.registry.get(c.req.param("doctype"));
    const commandName = c.req.param("command");
    const commandDefinition = doctype.commands?.find((item) => item.name === commandName);
    if (commandDefinition?.internal) {
      throw badRequest(`${doctype.name} command '${commandName}' is internal`);
    }
    const body = await readJson(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const input = withoutKeys(body, ["expectedVersion"]);
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.execute({
      actor,
      doctype: doctype.name,
      name: c.req.param("name"),
      command: commandName,
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

interface WorkspaceMetadataAccess {
  readonly doctypes: ReadonlySet<string>;
  readonly reports: ReadonlySet<string>;
  readonly files: boolean;
  readonly notifications: boolean;
  readonly adminTargets: ReadonlySet<string>;
}

function workspaceMetadataAccess(options: ResourceApiOptions, actor: Actor): WorkspaceMetadataAccess {
  return {
    doctypes: new Set(options.queries.listDoctypes(actor).map((doctype) => doctype.name)),
    reports: new Set(
      options.registry
        .listReports()
        .filter((report) => canReadReport(actor, report) && can(actor, options.registry.get(report.doctype), report.permissionAction ?? "read"))
        .map((report) => report.name)
    ),
    files: options.files !== undefined,
    notifications: options.notifications !== undefined,
    adminTargets: workspaceAdminTargets(options, actor)
  };
}

function workspaceAdminTargets(options: ResourceApiOptions, actor: Actor): ReadonlySet<string> {
  if (!actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return new Set();
  }
  return new Set([
    ...(options.userAccounts === undefined ? [] : ["users"]),
    ...(options.roles === undefined ? [] : ["roles"]),
    ...(options.userPermissions === undefined ? [] : ["user-permissions"]),
    ...(options.dataPatches === undefined ? [] : ["data-patches"]),
    ...(options.jobs === undefined ? [] : ["jobs"]),
    ...(options.jobSchedules === undefined ? [] : ["job-schedules"])
  ]);
}

function workspaceMetadataForActor(
  actor: Actor,
  workspace: WorkspaceDefinition,
  access: WorkspaceMetadataAccess
): WorkspaceDefinition {
  return {
    ...workspace,
    sections: workspace.sections.map((section) => ({
      ...section,
      shortcuts: section.shortcuts.filter(
        (shortcut) => canReadWorkspaceShortcut(actor, shortcut) && canReadWorkspaceShortcutTarget(shortcut, access)
      )
    }))
  };
}

function canReadWorkspaceShortcutTarget(
  shortcut: WorkspaceShortcutDefinition,
  access: WorkspaceMetadataAccess
): boolean {
  if (shortcut.kind === "doctype") {
    return access.doctypes.has(shortcut.target ?? "");
  }
  if (shortcut.kind === "report") {
    return access.reports.has(shortcut.target ?? "");
  }
  if (shortcut.kind === "file") {
    return access.files;
  }
  if (shortcut.kind === "notifications") {
    return access.notifications;
  }
  if (shortcut.kind === "admin") {
    return access.adminTargets.has(shortcut.target ?? "");
  }
  return true;
}

async function readJson(
  request: Request,
  options: { readonly allowEmpty?: boolean; readonly maxJsonBytes: number }
): Promise<MutableDocumentData> {
  return readJsonObject(request, options);
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

function objectValue(value: unknown, label: string): MutableDocumentData | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw badRequest(`${label} must be an object`);
  }
  return value as MutableDocumentData;
}

function documentSelectionsValue(value: unknown): readonly BulkDocumentSelection[] {
  if (!Array.isArray(value)) {
    throw badRequest("documents must be an array");
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      throw badRequest("document selections must be objects");
    }
    const name = stringValue(item.name);
    if (name === undefined) {
      throw badRequest("document name is required");
    }
    const expectedVersion = numberValue(item.expectedVersion);
    return {
      name,
      ...(expectedVersion === undefined ? {} : { expectedVersion })
    };
  });
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
    if (operator !== undefined && !isListFilterOperator(operator)) {
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

function permissionsValue(value: unknown): readonly string[] {
  if (value === undefined) {
    return ["read"];
  }
  if (!Array.isArray(value)) {
    throw badRequest("Share permissions must be an array");
  }
  if (!value.every((item) => typeof item === "string")) {
    throw badRequest("Share permissions must be strings");
  }
  return value;
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
