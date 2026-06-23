import { Hono } from "hono";
import type { DataPatchAdminPort, DataPatchApplyPlan } from "../../application/data-patch-service.js";
import type { DocumentShareService } from "../../application/document-share-service.js";
import type { DocumentCommandExecutor } from "../../application/document-service.js";
import type { DocumentHistoryService } from "../../application/document-history-service.js";
import type { FileService } from "../../application/file-service.js";
import type { JobHistoryService } from "../../application/job-history-service.js";
import type { JobRetryPort } from "../../application/job-retry-service.js";
import type { JobScheduleService } from "../../application/job-schedule-service.js";
import type { PrintService } from "../../application/print-service.js";
import { QueryService } from "../../application/query-service.js";
import type { ReportService } from "../../application/report-service.js";
import type { RoleService } from "../../application/role-service.js";
import type { SavedListFilterService } from "../../application/saved-list-filter-service.js";
import type { SavedReportDefinition, SavedReportService } from "../../application/saved-report-service.js";
import type { UserAccountService } from "../../application/user-account-service.js";
import type { UserNotificationService } from "../../application/user-notification-service.js";
import type { UserPermissionService } from "../../application/user-permission-service.js";
import type { UserProfileService } from "../../application/user-profile-service.js";
import { DOCUMENT_SHARE_PERMISSIONS, documentSharePermissionsForActor } from "../../core/document-shares.js";
import { FrameworkError } from "../../core/errors.js";
import { can } from "../../core/permissions.js";
import type { ModelRegistry } from "../../core/registry.js";
import { USER_PROFILE_FIELDS, type UserProfileInput } from "../../core/user-profiles.js";
import { allowedWorkflowTransitions } from "../../core/workflow.js";
import {
  CHILD_TABLE_ROW_INDEX_FIELD,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentSnapshot,
  type FieldDefinition,
  type FieldType,
  type ListDocumentsFilter,
  type MutableDocumentData,
  type ResolvedFormView
} from "../../core/types.js";
import type { ActorResolver } from "../http/actor.js";
import { listFiltersFromUrl, parseOptionalInteger, readBoundedText } from "../http/request.js";
import { writeReportCsvHeaders } from "../http/report-export.js";
import { reportFiltersFromUrl, reportOrderingFromUrl } from "../report-request.js";
import { renderPrintDocument } from "../print/index.js";
import { DESK_CLIENT_SCRIPT_PATH, renderDeskClientScript } from "./client.js";
import {
  deskReportFieldLabel,
  deskReportSumSummaryLabel,
  deskReportSumSummaryName,
  isDeskGroupableReportField,
  isDeskNumericReportField
} from "./report-builder.js";
import {
  renderDeskHome,
  renderDeskLayout,
  renderErrorPanel,
  renderFileAttachmentPanel,
  renderFileManager,
  renderDataPatchAdmin,
  renderDocumentPresencePanel,
  renderDocumentTimeline,
  renderFormView,
  renderJobAdmin,
  renderJobScheduleAdmin,
  renderListView,
  renderNotFound,
  renderReportList,
  renderReportView,
  renderRoleAdmin,
  renderSavedReportBuilder,
  renderSavedReportView,
  renderUserNotificationInbox,
  renderUserAccountAdmin,
  renderUserPermissionAdmin,
  type DeskLayoutOptions,
  type DeskNavLink,
  type FormLifecycleAction,
  type FormLinkOptions,
  type FormTableDefinitions,
  type FormWorkflowAction
} from "./render.js";

const MAX_DESK_FORM_BYTES = 1_048_576;
const DEFAULT_DESK_REPORT_GROUP_MAX_ROWS = 50;
const DEFAULT_DESK_REPORT_CHART_MAX_POINTS = 50;
const MAX_DESK_REPORT_CHART_POINTS = 50;
const REPORT_CHART_TYPES = ["bar", "line", "pie"] as const;
const REPORT_CHART_ORDER_BY = ["key", "label", "value"] as const;
const REPORT_CHART_ORDERS = ["asc", "desc"] as const;

type DeskReportChartType = (typeof REPORT_CHART_TYPES)[number];
type DeskReportChartOrderBy = (typeof REPORT_CHART_ORDER_BY)[number];
type DeskReportChartOrder = (typeof REPORT_CHART_ORDERS)[number];
type SavedReportSummaryDefinition = NonNullable<SavedReportDefinition["summaries"]>[number];
type SavedReportGroupDefinition = NonNullable<SavedReportDefinition["groups"]>[number];
type SavedReportChartDefinition = NonNullable<SavedReportDefinition["charts"]>[number];

interface ParsedDeskReportChartControls {
  readonly type: DeskReportChartType;
  readonly summary: string;
  readonly maxPoints: number;
  readonly orderBy?: DeskReportChartOrderBy;
  readonly order?: DeskReportChartOrder;
}

export interface DeskAppOptions {
  readonly registry: ModelRegistry;
  readonly documents: DocumentCommandExecutor;
  readonly prints?: PrintService;
  readonly files?: FileService;
  readonly queries: QueryService;
  readonly documentShares?: DocumentShareService;
  readonly timeline?: DocumentHistoryService;
  readonly savedFilters?: SavedListFilterService;
  readonly savedReports?: SavedReportService;
  readonly roles?: RoleService;
  readonly userAccounts?: UserAccountService;
  readonly notifications?: UserNotificationService;
  readonly userProfiles?: UserProfileService;
  readonly userPermissions?: UserPermissionService;
  readonly reports?: ReportService;
  readonly dataPatches?: DataPatchAdminPort;
  readonly jobs?: JobHistoryService;
  readonly jobRetry?: JobRetryPort;
  readonly jobSchedules?: JobScheduleService;
  readonly realtime?: boolean | { readonly route?: string };
  readonly maxFileBytes?: number;
  readonly actor: ActorResolver;
}

export function createDeskApp(options: DeskAppOptions): Hono {
  const app = new Hono();

  app.onError((error, c) => renderDeskFailure(options, c.req.raw, error));

  app.get(DESK_CLIENT_SCRIPT_PATH, () =>
    new Response(renderDeskClientScript(), {
      headers: {
        "cache-control": "public, max-age=3600",
        "content-type": "application/javascript; charset=utf-8"
      }
    })
  );

  app.get("/desk", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    return html(
      renderDeskLayoutFor(options, {
        title: "Home",
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        showNotifications: options.notifications !== undefined,
        showFiles: options.files !== undefined,
        body: renderDeskHome(doctypes, reports)
      })
    );
  });

  app.get("/desk/notifications", async (c) => {
    const notifications = requireNotifications(options);
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const limit = parseOptionalInteger(url.searchParams.get("limit") ?? undefined);
    const inbox = await notifications.inbox(actor, {
      ...(limit === undefined ? {} : { limit }),
      unreadOnly: truthyDeskParam(url.searchParams.get("unread")),
      includeDismissed: truthyDeskParam(url.searchParams.get("include_dismissed"))
    });
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    return html(
      renderDeskLayoutFor(options, {
        title: "Notifications",
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        showNotifications: true,
        showFiles: options.files !== undefined,
        body: renderUserNotificationInbox(inbox)
      })
    );
  });

  app.post("/desk/notifications/:notificationId/read", async (c) => {
    const notifications = requireNotifications(options);
    const actor = await options.actor(c.req.raw);
    await notifications.markRead(actor, c.req.param("notificationId"), { metadata: requestMetadata(c.req.raw) });
    return c.redirect("/desk/notifications", 303);
  });

  app.post("/desk/notifications/:notificationId/dismiss", async (c) => {
    const notifications = requireNotifications(options);
    const actor = await options.actor(c.req.raw);
    await notifications.dismiss(actor, c.req.param("notificationId"), { metadata: requestMetadata(c.req.raw) });
    return c.redirect("/desk/notifications", 303);
  });

  app.get("/desk/reports", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    return html(
      renderDeskLayoutFor(options, {
        title: "Reports",
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        showFiles: options.files !== undefined,
        body: renderReportList(reports, {
          ...(options.savedReports === undefined ? {} : { builderDoctypes: doctypes })
        })
      })
    );
  });

  app.get("/desk/files", async (c) => {
    const files = requireFiles(options);
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const limit = parseOptionalInteger(url.searchParams.get("limit") ?? undefined);
    const attachedToDoctype = url.searchParams.get("attached_to_doctype") ?? undefined;
    const attachedToName = url.searchParams.get("attached_to_name") ?? undefined;
    const dashboard = await files.dashboard(actor, {
      ...(attachedToDoctype === undefined ? {} : { attachedToDoctype }),
      ...(attachedToName === undefined ? {} : { attachedToName }),
      ...(limit === undefined ? {} : { limit })
    });
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    return html(
      renderDeskLayoutFor(options, {
        title: "Files",
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        showFiles: true,
        body: renderFileManager(dashboard)
      })
    );
  });

  app.post("/desk/files", async (c) => {
    const files = requireFiles(options);
    const actor = await options.actor(c.req.raw);
    try {
      preflightDeskFileUpload(c.req.raw, options.maxFileBytes ?? 25 * 1024 * 1024);
      const form = await parseDeskFileUpload(c.req.raw);
      await files.upload({
        actor,
        filename: form.filename,
        body: form.body,
        contentType: form.contentType,
        isPrivate: form.isPrivate,
        ...(form.attachedTo === undefined ? {} : { attachedTo: form.attachedTo }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect("/desk/files", 303);
    } catch (error) {
      return renderDeskFileFailure(options, c.req.raw, actor, error);
    }
  });

  app.post("/desk/files/:name/metadata", async (c) => {
    const files = requireFiles(options);
    const actor = await options.actor(c.req.raw);
    try {
      const form = await parseDeskFileMetadataUpdate(c.req.raw);
      await files.updateMetadata({
        actor,
        name: c.req.param("name"),
        filename: form.filename,
        isPrivate: form.isPrivate,
        attachedTo: form.attachedTo,
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect("/desk/files", 303);
    } catch (error) {
      return renderDeskFileFailure(options, c.req.raw, actor, error);
    }
  });

  app.get("/desk/files/:name/content", async (c) => {
    const files = requireFiles(options);
    const actor = await options.actor(c.req.raw);
    const downloaded = await files.download({ actor, name: c.req.param("name") });
    const headers = new Headers();
    headers.set("content-type", downloaded.object.metadata.contentType ?? "application/octet-stream");
    headers.set("content-length", String(downloaded.object.metadata.size));
    if (downloaded.object.metadata.httpEtag) {
      headers.set("etag", downloaded.object.metadata.httpEtag);
    }
    const filename = typeof downloaded.snapshot.data.filename === "string"
      ? downloaded.snapshot.data.filename
      : downloaded.snapshot.name;
    headers.set("content-disposition", `attachment; filename="${filename.replace(/["\\]/g, "_")}"`);
    return new Response(downloaded.object.body, { headers });
  });

  app.post("/desk/files/:name/delete", async (c) => {
    const files = requireFiles(options);
    const actor = await options.actor(c.req.raw);
    const expectedVersion = await parseDeskExpectedVersion(c.req.raw);
    await files.delete({
      actor,
      name: c.req.param("name"),
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.redirect("/desk/files", 303);
  });

  app.get("/desk/admin/user-permissions", async (c) => {
    const userPermissions = requireUserPermissions(options);
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const userId = url.searchParams.get("user") ?? actor.id;
    const state = await userPermissions.getUserPermissions(actor, userId);
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    return html(
      renderDeskLayoutFor(options, {
        title: "User Permissions",
        activeAdmin: "user-permissions",
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        body: renderUserPermissionAdmin(state)
      })
    );
  });

  app.get("/desk/admin/users", async (c) => {
    const userAccounts = requireUserAccounts(options);
    const actor = await options.actor(c.req.raw);
    userAccounts.authorizeAdministration(actor);
    const url = new URL(c.req.url);
    const selectedUserId = url.searchParams.get("user")?.trim() ?? "";
    if (!selectedUserId) {
      return renderDeskUserAccountPage(options, actor, { selectedUserId });
    }
    try {
      const account = await userAccounts.get(actor, selectedUserId);
      return renderDeskUserAccountPage(options, actor, { selectedUserId, account });
    } catch (error) {
      if (error instanceof FrameworkError && error.status === 404) {
        return renderDeskUserAccountPage(options, actor, {
          selectedUserId,
          error: error.message
        });
      }
      throw error;
    }
  });

  app.get("/desk/admin/roles", async (c) => {
    const roles = requireRoles(options);
    const actor = await options.actor(c.req.raw);
    const state = await roles.list(actor);
    return renderDeskRolePage(options, actor, state);
  });

  app.get("/desk/admin/jobs", async (c) => {
    const jobs = requireJobs(options);
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const jobName = url.searchParams.get("job") ?? undefined;
    const runId = url.searchParams.get("run_id") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;
    const limit = parseOptionalInteger(url.searchParams.get("limit") ?? undefined);
    const dashboard = await jobs.dashboard(actor, {
      ...(jobName === undefined ? {} : { jobName }),
      ...(runId === undefined ? {} : { runId }),
      ...(status === undefined ? {} : { status }),
      ...(limit === undefined ? {} : { limit })
    });
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    return html(
      renderDeskLayoutFor(options, {
        title: "Jobs",
        activeAdmin: "jobs",
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        body: renderJobAdmin(dashboard, {
          allowRetry: options.jobRetry !== undefined,
          showSchedulesLink: options.jobSchedules !== undefined
        })
      })
    );
  });

  app.get("/desk/admin/data-patches", async (c) => {
    const dataPatches = requireDataPatches(options);
    const actor = await options.actor(c.req.raw);
    const dashboard = await dataPatches.dashboard(actor);
    return renderDeskDataPatchPage(options, actor, dashboard);
  });

  app.post("/desk/admin/data-patches/apply", async (c) => {
    const dataPatches = requireDataPatches(options);
    const actor = await options.actor(c.req.raw);
    try {
      const form = await parseDeskDataPatchApply(c.req.raw);
      await dataPatches.apply(actor, form.limit === undefined ? {} : { limit: form.limit });
      return c.redirect("/desk/admin/data-patches", 303);
    } catch (error) {
      return renderDeskDataPatchFailure(options, actor, dataPatches, error);
    }
  });

  app.post("/desk/admin/data-patches/plan", async (c) => {
    const dataPatches = requireDataPatches(options);
    const actor = await options.actor(c.req.raw);
    try {
      const form = await parseDeskDataPatchApply(c.req.raw);
      const plan = await dataPatches.planApply(actor, form.limit === undefined ? {} : { limit: form.limit });
      const dashboard = await dataPatches.dashboard(actor);
      return renderDeskDataPatchPage(options, actor, dashboard, 200, undefined, plan);
    } catch (error) {
      return renderDeskDataPatchFailure(options, actor, dataPatches, error);
    }
  });

  app.post("/desk/admin/data-patches/:id/apply", async (c) => {
    const dataPatches = requireDataPatches(options);
    const actor = await options.actor(c.req.raw);
    try {
      await dataPatches.apply(actor, { patchIds: [c.req.param("id")] });
      return c.redirect("/desk/admin/data-patches", 303);
    } catch (error) {
      return renderDeskDataPatchFailure(options, actor, dataPatches, error);
    }
  });

  app.post("/desk/admin/data-patches/:id/plan", async (c) => {
    const dataPatches = requireDataPatches(options);
    const actor = await options.actor(c.req.raw);
    try {
      const plan = await dataPatches.planApply(actor, { patchIds: [c.req.param("id")] });
      const dashboard = await dataPatches.dashboard(actor);
      return renderDeskDataPatchPage(options, actor, dashboard, 200, undefined, plan);
    } catch (error) {
      return renderDeskDataPatchFailure(options, actor, dataPatches, error);
    }
  });

  app.get("/desk/admin/jobs/schedules", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const cron = url.searchParams.get("cron") ?? undefined;
    const jobName = url.searchParams.get("job") ?? undefined;
    const dashboard = await schedules.dashboard(actor, {
      ...(cron === undefined ? {} : { cron }),
      ...(jobName === undefined ? {} : { jobName })
    });
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    return html(
      renderDeskLayoutFor(options, {
        title: "Job Schedules",
        activeAdmin: "job-schedules",
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        body: renderJobScheduleAdmin(dashboard, {
          allowRun: schedules.canDispatch(),
          allowOverride: schedules.canOverride(),
          allowEdit: schedules.canEditDefinitions(),
          showHistoryLink: options.jobs !== undefined
        })
      })
    );
  });

  app.post("/desk/admin/jobs/schedules", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    await schedules.save(actor, {
      ...await parseDeskJobScheduleDefinition(c.req.raw),
      preserveExistingFields: true,
      eventMetadata: requestMetadata(c.req.raw)
    });
    return c.redirect("/desk/admin/jobs/schedules", 303);
  });

  app.post("/desk/admin/jobs/schedules/:scheduleId/run", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    await schedules.dispatch(actor, c.req.param("scheduleId"));
    return c.redirect("/desk/admin/jobs/schedules", 303);
  });

  app.post("/desk/admin/jobs/schedules/:scheduleId/delete", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    await schedules.delete(actor, c.req.param("scheduleId"), { metadata: requestMetadata(c.req.raw) });
    return c.redirect("/desk/admin/jobs/schedules", 303);
  });

  app.post("/desk/admin/jobs/schedules/:scheduleId/enable", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    await schedules.enable(actor, c.req.param("scheduleId"), { metadata: requestMetadata(c.req.raw) });
    return c.redirect("/desk/admin/jobs/schedules", 303);
  });

  app.post("/desk/admin/jobs/schedules/:scheduleId/disable", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    await schedules.disable(actor, c.req.param("scheduleId"), { metadata: requestMetadata(c.req.raw) });
    return c.redirect("/desk/admin/jobs/schedules", 303);
  });

  app.post("/desk/admin/jobs/schedules/:scheduleId/reset", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    await schedules.clearOverride(actor, c.req.param("scheduleId"), { metadata: requestMetadata(c.req.raw) });
    return c.redirect("/desk/admin/jobs/schedules", 303);
  });

  app.post("/desk/admin/jobs/:idempotencyKey/retry", async (c) => {
    const retry = requireJobRetry(options);
    const actor = await options.actor(c.req.raw);
    await retry.retry(actor, c.req.param("idempotencyKey"));
    return c.redirect("/desk/admin/jobs?status=failed", 303);
  });

  app.post("/desk/admin/user-permissions", async (c) => {
    const userPermissions = requireUserPermissions(options);
    const actor = await options.actor(c.req.raw);
    const form = await parseDeskUserPermission(c.req.raw);
    await userPermissions.allow({
      actor,
      userId: form.userId,
      targetDoctype: form.targetDoctype,
      targetName: form.targetName,
      ...(form.applicableDoctypes.length > 0 ? { applicableDoctypes: form.applicableDoctypes } : {}),
      ...(form.expectedVersion !== undefined ? { expectedVersion: form.expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.redirect(`/desk/admin/user-permissions?user=${encodeURIComponent(form.userId)}`, 303);
  });

  app.post("/desk/admin/user-permissions/revoke", async (c) => {
    const userPermissions = requireUserPermissions(options);
    const actor = await options.actor(c.req.raw);
    const form = await parseDeskUserPermission(c.req.raw);
    await userPermissions.revoke({
      actor,
      userId: form.userId,
      targetDoctype: form.targetDoctype,
      targetName: form.targetName,
      ...(form.applicableDoctypes.length > 0 ? { applicableDoctypes: form.applicableDoctypes } : {}),
      ...(form.expectedVersion !== undefined ? { expectedVersion: form.expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.redirect(`/desk/admin/user-permissions?user=${encodeURIComponent(form.userId)}`, 303);
  });

  app.post("/desk/admin/users", async (c) => {
    const userAccounts = requireUserAccounts(options);
    const actor = await options.actor(c.req.raw);
    userAccounts.authorizeAdministration(actor);
    let form: ParsedDeskCreateUserAccount | undefined;
    try {
      form = await parseDeskCreateUserAccount(c.req.raw);
      await userAccounts.create({
        actor,
        userId: form.userId,
        ...(form.email === undefined ? {} : { email: form.email }),
        password: form.password,
        roles: form.roles,
        ...(form.enabled === undefined ? {} : { enabled: form.enabled }),
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/admin/users?user=${encodeURIComponent(form.userId)}`, 303);
    } catch (error) {
      return renderDeskUserAccountFailure(options, actor, userAccounts, form?.userId ?? "", error);
    }
  });

  app.post("/desk/admin/users/password", async (c) => {
    const userAccounts = requireUserAccounts(options);
    const actor = await options.actor(c.req.raw);
    userAccounts.authorizeAdministration(actor);
    let form: ParsedDeskChangeUserPassword | undefined;
    try {
      form = await parseDeskChangeUserPassword(c.req.raw);
      await userAccounts.changePassword({
        actor,
        userId: form.userId,
        password: form.password,
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/admin/users?user=${encodeURIComponent(form.userId)}`, 303);
    } catch (error) {
      return renderDeskUserAccountFailure(options, actor, userAccounts, form?.userId ?? "", error);
    }
  });

  app.post("/desk/admin/users/roles", async (c) => {
    const userAccounts = requireUserAccounts(options);
    const actor = await options.actor(c.req.raw);
    userAccounts.authorizeAdministration(actor);
    let form: ParsedDeskChangeUserRoles | undefined;
    try {
      form = await parseDeskChangeUserRoles(c.req.raw);
      await userAccounts.changeRoles({
        actor,
        userId: form.userId,
        roles: form.roles,
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/admin/users?user=${encodeURIComponent(form.userId)}`, 303);
    } catch (error) {
      return renderDeskUserAccountFailure(options, actor, userAccounts, form?.userId ?? "", error);
    }
  });

  app.post("/desk/admin/users/profile", async (c) => {
    const userAccounts = requireUserAccounts(options);
    const userProfiles = requireUserProfiles(options);
    const actor = await options.actor(c.req.raw);
    userAccounts.authorizeAdministration(actor);
    let form: ParsedDeskChangeUserProfile | undefined;
    try {
      form = await parseDeskChangeUserProfile(c.req.raw);
      await userProfiles.change({
        actor,
        userId: form.userId,
        profile: form.profile,
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/admin/users?user=${encodeURIComponent(form.userId)}`, 303);
    } catch (error) {
      return renderDeskUserAccountFailure(options, actor, userAccounts, form?.userId ?? "", error);
    }
  });

  app.post("/desk/admin/users/enable", async (c) => {
    const userAccounts = requireUserAccounts(options);
    const actor = await options.actor(c.req.raw);
    userAccounts.authorizeAdministration(actor);
    let form: ParsedDeskSetUserEnabled | undefined;
    try {
      form = await parseDeskSetUserEnabled(c.req.raw);
      await userAccounts.enable({
        actor,
        userId: form.userId,
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/admin/users?user=${encodeURIComponent(form.userId)}`, 303);
    } catch (error) {
      return renderDeskUserAccountFailure(options, actor, userAccounts, form?.userId ?? "", error);
    }
  });

  app.post("/desk/admin/users/disable", async (c) => {
    const userAccounts = requireUserAccounts(options);
    const actor = await options.actor(c.req.raw);
    userAccounts.authorizeAdministration(actor);
    let form: ParsedDeskSetUserEnabled | undefined;
    try {
      form = await parseDeskSetUserEnabled(c.req.raw);
      await userAccounts.disable({
        actor,
        userId: form.userId,
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/admin/users?user=${encodeURIComponent(form.userId)}`, 303);
    } catch (error) {
      return renderDeskUserAccountFailure(options, actor, userAccounts, form?.userId ?? "", error);
    }
  });

  app.post("/desk/admin/roles", async (c) => {
    const roles = requireRoles(options);
    const actor = await options.actor(c.req.raw);
    roles.authorizeAdministration(actor);
    try {
      const form = await parseDeskCreateRole(c.req.raw);
      await roles.create({
        actor,
        role: form.role,
        ...(form.description === undefined ? {} : { description: form.description }),
        ...(form.enabled === undefined ? {} : { enabled: form.enabled }),
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect("/desk/admin/roles", 303);
    } catch (error) {
      return renderDeskRoleFailure(options, actor, roles, error);
    }
  });

  app.post("/desk/admin/roles/:role/description", async (c) => {
    const roles = requireRoles(options);
    const actor = await options.actor(c.req.raw);
    roles.authorizeAdministration(actor);
    try {
      const form = await parseDeskRoleDescription(c.req.raw);
      await roles.changeDescription({
        actor,
        role: c.req.param("role"),
        ...(form.description === undefined ? {} : { description: form.description }),
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect("/desk/admin/roles", 303);
    } catch (error) {
      return renderDeskRoleFailure(options, actor, roles, error);
    }
  });

  app.post("/desk/admin/roles/:role/enable", async (c) => {
    const roles = requireRoles(options);
    const actor = await options.actor(c.req.raw);
    roles.authorizeAdministration(actor);
    try {
      const form = await parseDeskRoleStatus(c.req.raw);
      await roles.enable({
        actor,
        role: c.req.param("role"),
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect("/desk/admin/roles", 303);
    } catch (error) {
      return renderDeskRoleFailure(options, actor, roles, error);
    }
  });

  app.post("/desk/admin/roles/:role/disable", async (c) => {
    const roles = requireRoles(options);
    const actor = await options.actor(c.req.raw);
    roles.authorizeAdministration(actor);
    try {
      const form = await parseDeskRoleStatus(c.req.raw);
      await roles.disable({
        actor,
        role: c.req.param("role"),
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect("/desk/admin/roles", 303);
    } catch (error) {
      return renderDeskRoleFailure(options, actor, roles, error);
    }
  });

  app.get("/desk/report-builder/:doctype", async (c) => {
    const savedReports = requireSavedReports(options);
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    const saved = await savedReports.list(actor, doctype.name);
    return html(
      renderDeskLayoutFor(options, {
        title: `${doctype.label ?? doctype.name} Report Builder`,
        adminLinks: adminLinksFor(options, actor),
        active: doctype.name,
        doctypes,
        reports,
        showFiles: options.files !== undefined,
        body: renderSavedReportBuilder(doctype, saved)
      })
    );
  });

  app.post("/desk/report-builder/:doctype", async (c) => {
    const savedReports = requireSavedReports(options);
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    try {
      const form = await parseDeskSavedReport(c.req.raw, doctype);
      const saved = await savedReports.save({
        actor,
        doctype: doctype.name,
        label: form.label,
        definition: form.definition
      });
      return c.redirect(
        `/desk/report-builder/${encodeURIComponent(doctype.name)}/${encodeURIComponent(saved.id)}`,
        303
      );
    } catch (error) {
      return renderDeskSavedReportBuilderFailure(options, c.req.raw, actor, doctype, error);
    }
  });

  app.get("/desk/report-builder/:doctype/:id/export.csv", async (c) => {
    const savedReports = requireSavedReports(options);
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const limit = parseOptionalInteger(url.searchParams.get("limit") ?? undefined);
    const csv = await savedReports.exportCsv({
      actor,
      doctype: c.req.param("doctype"),
      id: c.req.param("id"),
      options: {
        filters: reportFiltersFromUrl(url),
        ...reportOrderingFromUrl(url),
        ...(limit !== undefined ? { limit } : {})
      }
    });
    writeReportCsvHeaders(c, csv);
    return c.body(csv.body);
  });

  app.post("/desk/report-builder/:doctype/:id/delete", async (c) => {
    const savedReports = requireSavedReports(options);
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    await savedReports.delete({
      actor,
      doctype: doctype.name,
      id: c.req.param("id")
    });
    return c.redirect(`/desk/report-builder/${encodeURIComponent(doctype.name)}`, 303);
  });

  app.get("/desk/report-builder/:doctype/:id", async (c) => {
    const savedReports = requireSavedReports(options);
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    const saved = await savedReports.get(actor, doctype.name, c.req.param("id"));
    const result = await savedReports.run({
      actor,
      doctype: doctype.name,
      id: saved.id,
      options: {
        filters: reportFiltersFromUrl(url),
        ...reportOrderingFromUrl(url),
        limit: 100
      }
    });
    const base = `/desk/report-builder/${encodeURIComponent(doctype.name)}/${encodeURIComponent(saved.id)}`;
    return html(
      renderDeskLayoutFor(options, {
        title: saved.label,
        adminLinks: adminLinksFor(options, actor),
        active: doctype.name,
        doctypes,
        reports,
        showFiles: options.files !== undefined,
        body: renderSavedReportView(saved, result, {
          listHref: `/desk/report-builder/${encodeURIComponent(doctype.name)}`,
          exportHref: `${base}/export.csv${url.search}`,
          deleteAction: `${base}/delete`
        })
      })
    );
  });

  app.get("/desk/reports/:report", async (c) => {
    if (!options.reports) {
      throw new FrameworkError("REPORT_NOT_FOUND", "Reports are not enabled", { status: 404 });
    }
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    const result = await options.reports.runReport(actor, c.req.param("report"), {
      filters: reportFiltersFromUrl(url),
      ...reportOrderingFromUrl(url),
      limit: 100
    });
    const exportHref = `/desk/reports/${encodeURIComponent(result.report.name)}/export.csv${url.search}`;
    return html(
      renderDeskLayoutFor(options, {
        title: result.report.label ?? result.report.name,
        adminLinks: adminLinksFor(options, actor),
        activeReport: result.report.name,
        doctypes,
        reports,
        body: renderReportView(result, { exportHref })
      })
    );
  });

  app.get("/desk/reports/:report/export.csv", async (c) => {
    if (!options.reports) {
      throw new FrameworkError("REPORT_NOT_FOUND", "Reports are not enabled", { status: 404 });
    }
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const limit = parseOptionalInteger(url.searchParams.get("limit") ?? undefined);
    const csv = await options.reports.exportReportCsv(actor, c.req.param("report"), {
      filters: reportFiltersFromUrl(url),
      ...reportOrderingFromUrl(url),
      ...(limit !== undefined ? { limit } : {})
    });
    writeReportCsvHeaders(c, csv);
    return c.body(csv.body);
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
    const savedFilterId = url.searchParams.get("saved_filter") ?? undefined;
    const savedFilter = savedFilterId && options.savedFilters
      ? await options.savedFilters.get(actor, doctype.name, savedFilterId)
      : undefined;
    const effectiveRequestedFilters = options.savedFilters?.mergeSavedFilter(savedFilter, filters) ?? filters;
    const limit = parseOptionalInteger(url.searchParams.get("limit") ?? undefined);
    const offset = parseOptionalInteger(url.searchParams.get("offset") ?? undefined);
    const { listView, filters: effectiveFilters, result } = await options.queries.listDocumentsForView(actor, doctype.name, {
      filters: effectiveRequestedFilters,
      useDefaultFilters: savedFilter ? false : url.searchParams.get("default_filters") !== "0",
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {})
    });
    const savedFilters = await options.savedFilters?.list(actor, doctype.name);
    return html(
      renderDeskLayoutFor(options, {
        title: doctype.label ?? doctype.name,
        adminLinks: adminLinksFor(options, actor),
        active: doctype.name,
        doctypes,
        reports,
        body: renderListView(doctype, listView, result.data, effectiveFilters, {
          ...(savedFilters ? { savedFilters } : {}),
          ...(savedFilter ? { selectedSavedFilterId: savedFilter.id } : {}),
          clientScripts: options.registry.listClientScripts(doctype.name, "list"),
          ...deskRealtimeRouteOption(options)
        })
      })
    );
  });

  app.post("/desk/:doctype/saved-filters", async (c) => {
    if (!options.savedFilters) {
      throw new FrameworkError("DOCUMENT_NOT_FOUND", "Saved filters are not enabled", { status: 404 });
    }
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    try {
      const form = await parseDeskSavedFilter(c.req.raw);
      const saved = await options.savedFilters.save({
        actor,
        doctype: doctype.name,
        label: form.label,
        filters: form.filters
      });
      return c.redirect(`/desk/${encodeURIComponent(doctype.name)}?saved_filter=${encodeURIComponent(saved.id)}`, 303);
    } catch (error) {
      return renderDeskFailure(options, c.req.raw, error);
    }
  });

  app.post("/desk/:doctype/saved-filters/:filterId/delete", async (c) => {
    if (!options.savedFilters) {
      throw new FrameworkError("DOCUMENT_NOT_FOUND", "Saved filters are not enabled", { status: 404 });
    }
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    await options.savedFilters.delete({
      actor,
      doctype: doctype.name,
      id: c.req.param("filterId")
    });
    return c.redirect(`/desk/${encodeURIComponent(doctype.name)}`, 303);
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
      renderDeskLayoutFor(options, {
        title: `New ${doctype.label ?? doctype.name}`,
        adminLinks: adminLinksFor(options, actor),
        active: doctype.name,
        doctypes,
        reports,
        body: renderFormView(doctype, formView, {
          mode: "create",
          linkOptions,
          tableDefinitions,
          clientScripts: options.registry.listClientScripts(doctype.name, "form"),
          ...deskRealtimeRouteOption(options)
        })
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
    return renderDeskDocumentPage(options, actor, doctype, c.req.param("name"));
  });

  app.post("/desk/:doctype/:name/files", async (c) => {
    const files = requireFiles(options);
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const name = c.req.param("name");
    try {
      preflightDeskFileUpload(c.req.raw, options.maxFileBytes ?? 25 * 1024 * 1024);
      const form = await parseDeskFileUpload(c.req.raw);
      await files.upload({
        actor,
        filename: form.filename,
        body: form.body,
        contentType: form.contentType,
        isPrivate: form.isPrivate,
        attachedTo: { doctype: doctype.name, name },
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(name)}`, 303);
    } catch (error) {
      return renderDeskDocumentPage(options, actor, doctype, name, {
        attachmentError: error instanceof FrameworkError ? error.message : error instanceof Error ? error.message : "Request failed",
        status: error instanceof FrameworkError ? error.status : 500
      });
    }
  });

  app.post("/desk/:doctype/:name/files/:fileName/delete", async (c) => {
    const files = requireFiles(options);
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const name = c.req.param("name");
    const fileName = c.req.param("fileName");
    const file = await files.get(actor, fileName);
    if (file.attachedTo?.doctype !== doctype.name || file.attachedTo.name !== name) {
      throw new FrameworkError("DOCUMENT_NOT_FOUND", `${fileName} is not attached to ${doctype.name}/${name}`, {
        status: 404
      });
    }
    const expectedVersion = await parseDeskExpectedVersion(c.req.raw);
    await files.delete({
      actor,
      name: fileName,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(name)}`, 303);
  });

  app.post("/desk/:doctype/:name/comments", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const name = c.req.param("name");
    try {
      const form = await parseDeskComment(c.req.raw);
      await options.documents.comment({
        actor,
        doctype: doctype.name,
        name,
        text: form.text,
        ...(form.expectedVersion !== undefined ? { expectedVersion: form.expectedVersion } : {}),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(name)}`, 303);
    } catch (error) {
      return renderDeskError(options, c.req.raw, actor, doctype, "update", error, name);
    }
  });

  app.post("/desk/:doctype/:name/assignments", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const name = c.req.param("name");
    try {
      const form = await parseDeskAssignment(c.req.raw);
      await options.documents.assign({
        actor,
        doctype: doctype.name,
        name,
        assignee: form.assignee,
        ...(form.expectedVersion !== undefined ? { expectedVersion: form.expectedVersion } : {}),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(name)}`, 303);
    } catch (error) {
      return renderDeskError(options, c.req.raw, actor, doctype, "update", error, name);
    }
  });

  app.post("/desk/:doctype/:name/assignments/:assignee/remove", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const name = c.req.param("name");
    try {
      const expectedVersion = await parseDeskExpectedVersion(c.req.raw);
      await options.documents.unassign({
        actor,
        doctype: doctype.name,
        name,
        assignee: c.req.param("assignee"),
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(name)}`, 303);
    } catch (error) {
      return renderDeskError(options, c.req.raw, actor, doctype, "update", error, name);
    }
  });

  app.post("/desk/:doctype/:name/tags", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const name = c.req.param("name");
    try {
      const form = await parseDeskTag(c.req.raw);
      await options.documents.tag({
        actor,
        doctype: doctype.name,
        name,
        tag: form.tag,
        ...(form.expectedVersion !== undefined ? { expectedVersion: form.expectedVersion } : {}),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(name)}`, 303);
    } catch (error) {
      return renderDeskError(options, c.req.raw, actor, doctype, "update", error, name);
    }
  });

  app.post("/desk/:doctype/:name/tags/:tag/remove", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const name = c.req.param("name");
    try {
      const expectedVersion = await parseDeskExpectedVersion(c.req.raw);
      await options.documents.untag({
        actor,
        doctype: doctype.name,
        name,
        tag: c.req.param("tag"),
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(name)}`, 303);
    } catch (error) {
      return renderDeskError(options, c.req.raw, actor, doctype, "update", error, name);
    }
  });

  app.post("/desk/:doctype/:name/followers", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const name = c.req.param("name");
    try {
      const expectedVersion = await parseDeskExpectedVersion(c.req.raw);
      await options.documents.follow({
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

  app.post("/desk/:doctype/:name/followers/:follower/remove", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const name = c.req.param("name");
    try {
      const expectedVersion = await parseDeskExpectedVersion(c.req.raw);
      await options.documents.unfollow({
        actor,
        doctype: doctype.name,
        name,
        follower: c.req.param("follower"),
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(name)}`, 303);
    } catch (error) {
      return renderDeskError(options, c.req.raw, actor, doctype, "update", error, name);
    }
  });

  if (options.documentShares) {
    app.post("/desk/:doctype/:name/shares", async (c) => {
      const actor = await options.actor(c.req.raw);
      const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
      const name = c.req.param("name");
      try {
        const form = await parseDeskShare(c.req.raw);
        await options.documents.share({
          actor,
          doctype: doctype.name,
          name,
          userId: form.userId,
          permissions: form.permissions,
          ...(form.expectedVersion !== undefined ? { expectedVersion: form.expectedVersion } : {}),
          metadata: requestMetadata(c.req.raw)
        });
        return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(name)}`, 303);
      } catch (error) {
        return renderDeskError(options, c.req.raw, actor, doctype, "update", error, name);
      }
    });

    app.post("/desk/:doctype/:name/shares/:userId/remove", async (c) => {
      const actor = await options.actor(c.req.raw);
      const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
      const name = c.req.param("name");
      try {
        const expectedVersion = await parseDeskExpectedVersion(c.req.raw);
        await options.documents.revokeShare({
          actor,
          doctype: doctype.name,
          name,
          userId: c.req.param("userId"),
          ...(expectedVersion !== undefined ? { expectedVersion } : {}),
          metadata: requestMetadata(c.req.raw)
        });
        return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(name)}`, 303);
      } catch (error) {
        return renderDeskError(options, c.req.raw, actor, doctype, "update", error, name);
      }
    });
  }

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
      const commandName = c.req.param("command");
      const commandDefinition = doctype.commands?.find((item) => item.name === commandName);
      if (commandDefinition?.internal) {
        throw new FrameworkError("BAD_REQUEST", `${doctype.name} command '${commandName}' is internal`, {
          status: 400
        });
      }
      const form = await parseDeskForm(c.req.raw, doctype, formView, (doctypeName) => options.registry.get(doctypeName));
      await options.documents.execute({
        actor,
        doctype: doctype.name,
        name,
        command: commandName,
        input: form.data,
        ...(form.expectedVersion !== undefined ? { expectedVersion: form.expectedVersion } : {}),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(name)}`, 303);
    } catch (error) {
      return renderDeskError(options, c.req.raw, actor, doctype, "update", error, name);
    }
  });

  app.post("/desk/:doctype/:name/transition/:action", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const name = c.req.param("name");
    try {
      const expectedVersion = await parseDeskExpectedVersion(c.req.raw);
      await options.documents.transition({
        actor,
        doctype: doctype.name,
        name,
        action: c.req.param("action"),
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
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
      renderDeskLayoutFor(options, {
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
  const actor = await Promise.resolve().then(() => options.actor(request)).catch(() => undefined);
  const doctypes = actor === undefined ? [] : options.queries.listDoctypes(actor);
  const reports = actor === undefined ? [] : listReports(options, actor);
  return html(
    renderDeskLayoutFor(options, {
      title: status === 404 ? "Not found" : "Request failed",
      ...(actor === undefined ? {} : { adminLinks: adminLinksFor(options, actor) }),
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
    renderDeskLayoutFor(options, {
      title: mode === "create" ? `New ${doctype.label ?? doctype.name}` : name ?? doctype.name,
      adminLinks: adminLinksFor(options, actor),
      active: doctype.name,
      doctypes,
      reports,
      body: renderFormView(doctype, formView, {
        mode,
        ...(document ? { document } : {}),
        linkOptions,
        tableDefinitions,
        ...(document ? { lifecycleActions: lifecycleActionsFor(actor, doctype, document) } : {}),
        ...(document ? { workflowActions: workflowActionsFor(actor, doctype, document) } : {}),
        ...(document ? { printFormats: listPrintFormats(options, actor, doctype.name) } : {}),
        clientScripts: options.registry.listClientScripts(doctype.name, "form"),
        ...deskRealtimeRouteOption(options),
        error: message
      })
    }),
    error instanceof FrameworkError ? error.status : 500
  );
}

function listReports(options: DeskAppOptions, actor: Actor) {
  return options.reports?.listReports(actor) ?? [];
}

function deskRealtimeRoute(options: DeskAppOptions): string | undefined {
  if (!options.realtime) {
    return undefined;
  }
  return typeof options.realtime === "object" ? options.realtime.route ?? "/api/realtime" : "/api/realtime";
}

function deskRealtimeRouteOption(options: DeskAppOptions): { readonly realtimeRoute: string } | Record<string, never> {
  const route = deskRealtimeRoute(options);
  return route === undefined ? {} : { realtimeRoute: route };
}

function adminLinksFor(options: DeskAppOptions, actor: Actor): readonly DeskNavLink[] {
  if (!actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return [];
  }
  return [
    ...(options.userAccounts === undefined ? [] : [{ id: "users", label: "Users", href: "/desk/admin/users" }]),
    ...(options.roles === undefined ? [] : [{ id: "roles", label: "Roles", href: "/desk/admin/roles" }]),
    ...(options.userPermissions === undefined
      ? []
      : [{ id: "user-permissions", label: "User Permissions", href: "/desk/admin/user-permissions" }]),
    ...(options.dataPatches === undefined
      ? []
      : [{ id: "data-patches", label: "Data Patches", href: "/desk/admin/data-patches" }]),
    ...(options.jobs === undefined ? [] : [{ id: "jobs", label: "Jobs", href: "/desk/admin/jobs" }]),
    ...(options.jobSchedules === undefined
      ? []
      : [{ id: "job-schedules", label: "Job Schedules", href: "/desk/admin/jobs/schedules" }])
  ];
}

function listPrintFormats(options: DeskAppOptions, actor: Actor, doctype?: string) {
  return options.prints?.listPrintFormats(actor, doctype) ?? [];
}

function requireUserPermissions(options: DeskAppOptions): UserPermissionService {
  if (!options.userPermissions) {
    throw new FrameworkError("DOCUMENT_NOT_FOUND", "User permissions are not enabled", { status: 404 });
  }
  return options.userPermissions;
}

function requireUserAccounts(options: DeskAppOptions): UserAccountService {
  if (!options.userAccounts) {
    throw new FrameworkError("DOCUMENT_NOT_FOUND", "User accounts are not enabled", { status: 404 });
  }
  return options.userAccounts;
}

function requireUserProfiles(options: DeskAppOptions): UserProfileService {
  if (!options.userProfiles) {
    throw new FrameworkError("DOCUMENT_NOT_FOUND", "User profiles are not enabled", { status: 404 });
  }
  return options.userProfiles;
}

function requireRoles(options: DeskAppOptions): RoleService {
  if (!options.roles) {
    throw new FrameworkError("DOCUMENT_NOT_FOUND", "Roles are not enabled", { status: 404 });
  }
  return options.roles;
}

function requireJobs(options: DeskAppOptions): JobHistoryService {
  if (!options.jobs) {
    throw new FrameworkError("JOB_NOT_FOUND", "Jobs are not enabled", { status: 404 });
  }
  return options.jobs;
}

function requireDataPatches(options: DeskAppOptions): DataPatchAdminPort {
  if (!options.dataPatches) {
    throw new FrameworkError("DATA_PATCH_NOT_FOUND", "Data patches are not enabled", { status: 404 });
  }
  return options.dataPatches;
}

function requireJobRetry(options: DeskAppOptions): JobRetryPort {
  if (!options.jobRetry) {
    throw new FrameworkError("JOB_NOT_FOUND", "Job retry is not enabled", { status: 404 });
  }
  return options.jobRetry;
}

function requireJobSchedules(options: DeskAppOptions): JobScheduleService {
  if (!options.jobSchedules) {
    throw new FrameworkError("JOB_SCHEDULE_NOT_FOUND", "Job schedules are not enabled", { status: 404 });
  }
  return options.jobSchedules;
}

function requireNotifications(options: DeskAppOptions): UserNotificationService {
  if (!options.notifications) {
    throw new FrameworkError("DOCUMENT_NOT_FOUND", "Notifications are not enabled", { status: 404 });
  }
  return options.notifications;
}

function renderDeskLayoutFor(options: DeskAppOptions, layout: DeskLayoutOptions): string {
  return renderDeskLayout({
    ...layout,
    showNotifications: layout.showNotifications ?? options.notifications !== undefined,
    showFiles: layout.showFiles ?? options.files !== undefined
  });
}

function requireSavedReports(options: DeskAppOptions): SavedReportService {
  if (!options.savedReports) {
    throw new FrameworkError("REPORT_NOT_FOUND", "Saved reports are not enabled", { status: 404 });
  }
  return options.savedReports;
}

function requireFiles(options: DeskAppOptions): FileService {
  if (!options.files) {
    throw new FrameworkError("DOCUMENT_NOT_FOUND", "Files are not enabled", { status: 404 });
  }
  return options.files;
}

function preflightDeskFileUpload(request: Request, maxFileBytes: number): void {
  const contentLength = request.headers.get("content-length");
  if (contentLength === null) {
    throw new FrameworkError("BAD_REQUEST", "content-length is required for file uploads", { status: 411 });
  }
  const parsed = Number(contentLength);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new FrameworkError("BAD_REQUEST", "content-length must be a non-negative number", { status: 400 });
  }
  if (parsed > maxFileBytes) {
    throw new FrameworkError("BAD_REQUEST", `File exceeds ${maxFileBytes} bytes`, { status: 400 });
  }
}

async function renderDeskFileFailure(
  options: DeskAppOptions,
  request: Request,
  actor: Actor,
  error: unknown
): Promise<Response> {
  const files = requireFiles(options);
  const dashboard = await files.dashboard(actor).catch(() => ({ files: [], limit: 50, filters: {} }));
  const doctypes = options.queries.listDoctypes(actor);
  const reports = listReports(options, actor);
  const message = error instanceof FrameworkError ? error.message : error instanceof Error ? error.message : "Request failed";
  return html(
    renderDeskLayoutFor(options, {
      title: "Files",
      adminLinks: adminLinksFor(options, actor),
      doctypes,
      reports,
      showFiles: true,
      body: renderFileManager(dashboard, { error: message })
    }),
    error instanceof FrameworkError ? error.status : 500
  );
}

async function renderDeskDataPatchPage(
  options: DeskAppOptions,
  actor: Actor,
  dashboard: Parameters<typeof renderDataPatchAdmin>[0],
  status = 200,
  error?: string,
  plan?: DataPatchApplyPlan
): Promise<Response> {
  const doctypes = options.queries.listDoctypes(actor);
  const reports = listReports(options, actor);
  return html(
    renderDeskLayoutFor(options, {
      title: "Data Patches",
      activeAdmin: "data-patches",
      adminLinks: adminLinksFor(options, actor),
      doctypes,
      reports,
      showFiles: options.files !== undefined,
      body: renderDataPatchAdmin(dashboard, {
        ...(error === undefined ? {} : { error }),
        ...(plan === undefined ? {} : { plan })
      })
    }),
    status
  );
}

async function renderDeskDataPatchFailure(
  options: DeskAppOptions,
  actor: Actor,
  dataPatches: DataPatchAdminPort,
  error: unknown
): Promise<Response> {
  if (error instanceof FrameworkError && error.status === 403) {
    throw error;
  }
  const dashboard = await dataPatches.dashboard(actor);
  const message = error instanceof FrameworkError ? error.message : error instanceof Error ? error.message : "Request failed";
  return renderDeskDataPatchPage(
    options,
    actor,
    dashboard,
    error instanceof FrameworkError ? error.status : 500,
    message
  );
}

async function renderDeskSavedReportBuilderFailure(
  options: DeskAppOptions,
  request: Request,
  actor: Actor,
  doctype: DocTypeDefinition,
  error: unknown
): Promise<Response> {
  const savedReports = requireSavedReports(options);
  const saved = await savedReports.list(actor, doctype.name).catch(() => []);
  const doctypes = options.queries.listDoctypes(actor);
  const reports = listReports(options, actor);
  const message = error instanceof FrameworkError ? error.message : error instanceof Error ? error.message : "Request failed";
  return html(
    renderDeskLayoutFor(options, {
      title: `${doctype.label ?? doctype.name} Report Builder`,
      adminLinks: adminLinksFor(options, actor),
      active: doctype.name,
      doctypes,
      reports,
      showFiles: options.files !== undefined,
      body: renderSavedReportBuilder(doctype, saved, { error: message })
    }),
    error instanceof FrameworkError ? error.status : 500
  );
}

async function renderDeskUserAccountPage(
  options: DeskAppOptions,
  actor: Actor,
  state: Parameters<typeof renderUserAccountAdmin>[0],
  status = 200
): Promise<Response> {
  const doctypes = options.queries.listDoctypes(actor);
  const reports = listReports(options, actor);
  const profile = state.account && options.userProfiles
    ? await options.userProfiles.get(actor, state.account.userId).catch(() => undefined)
    : undefined;
  return html(
    renderDeskLayoutFor(options, {
      title: "Users",
      activeAdmin: "users",
      adminLinks: adminLinksFor(options, actor),
      doctypes,
      reports,
      body: renderUserAccountAdmin({
        ...state,
        ...(profile === undefined ? {} : { profile })
      })
    }),
    status
  );
}

async function renderDeskUserAccountFailure(
  options: DeskAppOptions,
  actor: Actor,
  userAccounts: UserAccountService,
  selectedUserId: string,
  error: unknown
): Promise<Response> {
  if (error instanceof FrameworkError && error.status === 403) {
    throw error;
  }
  const account = selectedUserId
    ? await userAccounts.get(actor, selectedUserId).catch(() => undefined)
    : undefined;
  const message = error instanceof FrameworkError ? error.message : error instanceof Error ? error.message : "Request failed";
  return renderDeskUserAccountPage(
    options,
    actor,
    {
      selectedUserId,
      ...(account === undefined ? {} : { account }),
      error: message
    },
    error instanceof FrameworkError ? error.status : 500
  );
}

async function renderDeskRolePage(
  options: DeskAppOptions,
  actor: Actor,
  state: Parameters<typeof renderRoleAdmin>[0],
  status = 200,
  error?: string
): Promise<Response> {
  const doctypes = options.queries.listDoctypes(actor);
  const reports = listReports(options, actor);
  return html(
    renderDeskLayoutFor(options, {
      title: "Roles",
      activeAdmin: "roles",
      adminLinks: adminLinksFor(options, actor),
      doctypes,
      reports,
      body: renderRoleAdmin(state, error === undefined ? {} : { error })
    }),
    status
  );
}

async function renderDeskRoleFailure(
  options: DeskAppOptions,
  actor: Actor,
  roles: RoleService,
  error: unknown
): Promise<Response> {
  if (error instanceof FrameworkError && error.status === 403) {
    throw error;
  }
  const state = await roles.list(actor);
  const message = error instanceof FrameworkError ? error.message : error instanceof Error ? error.message : "Request failed";
  return renderDeskRolePage(options, actor, state, error instanceof FrameworkError ? error.status : 500, message);
}

async function renderDeskDocumentPage(
  options: DeskAppOptions,
  actor: Actor,
  doctype: DocTypeDefinition,
  name: string,
  result: { readonly attachmentError?: string; readonly status?: number } = {}
): Promise<Response> {
  const doctypes = options.queries.listDoctypes(actor);
  const reports = listReports(options, actor);
  const printFormats = listPrintFormats(options, actor, doctype.name);
  const formView = options.queries.getFormView(actor, doctype.name);
  const document = await options.queries.getDocument(actor, doctype.name, name);
  const linkOptions = await linkOptionsForForm(options, actor, doctype, formView);
  const tableDefinitions = tableDefinitionsForForm(options, formView);
  const lifecycleActions = lifecycleActionsFor(actor, doctype, document);
  const workflowActions = workflowActionsFor(actor, doctype, document);
  const timeline = await options.timeline?.getTimeline(actor, doctype.name, document.name, { limit: 25 });
  const assignments = await options.timeline?.getAssignments(actor, doctype.name, document.name);
  const tags = await options.timeline?.getTags(actor, doctype.name, document.name);
  const followers = await options.timeline?.getFollowers(actor, doctype.name, document.name);
  const shares = await documentSharesForDesk(options, actor, doctype, document);
  const canComment = can(actor, doctype, "comment", document);
  const canAssign = can(actor, doctype, "assign", document);
  const canTag = can(actor, doctype, "tag", document);
  const canFollow = can(actor, doctype, "follow", document);
  const form = renderFormView(doctype, formView, {
    mode: "update",
    document,
    linkOptions,
    tableDefinitions,
    lifecycleActions,
    workflowActions,
    printFormats,
    clientScripts: options.registry.listClientScripts(doctype.name, "form"),
    ...deskRealtimeRouteOption(options)
  });
  const attachments = options.files === undefined
    ? ""
    : renderFileAttachmentPanel(
        doctype.name,
        document.name,
        await options.files.dashboard(actor, {
          attachedToDoctype: doctype.name,
          attachedToName: document.name,
          limit: 25
        }),
        result.attachmentError === undefined ? {} : { error: result.attachmentError }
      );
  const realtimeRoute = deskRealtimeRoute(options);
  const presence = realtimeRoute ? renderDocumentPresencePanel(document, { realtimeRoute }) : "";
  return html(
    renderDeskLayoutFor(options, {
      title: document.name,
      adminLinks: adminLinksFor(options, actor),
      active: doctype.name,
      doctypes,
      reports,
      showFiles: options.files !== undefined,
      body: `${form}${presence}${attachments}${
        timeline
          ? renderDocumentTimeline(timeline, {
              allowComment: canComment,
              allowAssign: canAssign,
              allowTag: canTag,
              allowFollow: canFollow,
              actorId: actor.id,
              ...(assignments ? { assignments } : {}),
              ...(tags ? { tags } : {}),
              ...(followers ? { followers } : {}),
              ...(shares ? { shares, allowShare: true } : {})
            })
          : ""
      }`
    }),
    result.status ?? 200
  );
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

async function documentSharesForDesk(
  options: DeskAppOptions,
  actor: Actor,
  doctype: DocTypeDefinition,
  document: DocumentSnapshot
) {
  if (options.documentShares === undefined) {
    return undefined;
  }
  try {
    const state = await options.documentShares.getDocumentShares(actor, doctype, document);
    return {
      ...state,
      delegablePermissions: can(actor, doctype, "share", document)
        ? DOCUMENT_SHARE_PERMISSIONS
        : documentSharePermissionsForActor(actor, state.grants)
    };
  } catch (error) {
    if (error instanceof FrameworkError && error.status === 403) {
      return undefined;
    }
    throw error;
  }
}

function workflowActionsFor(
  actor: Actor,
  doctype: DocTypeDefinition,
  document: DocumentSnapshot
): readonly FormWorkflowAction[] {
  const workflow = doctype.workflow;
  if (!workflow || document.docstatus !== "draft" || !can(actor, doctype, "transition", document)) {
    return [];
  }
  return allowedWorkflowTransitions({ actor, workflow, document })
    .map((transition) => ({
      action: transition.action,
      label: transition.action,
      to: transition.to
    }));
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

interface ParsedDeskForm {
  readonly data: MutableDocumentData;
  readonly expectedVersion?: number;
}

interface ParsedDeskComment {
  readonly text: string;
  readonly expectedVersion?: number;
}

interface ParsedDeskAssignment {
  readonly assignee: string;
  readonly expectedVersion?: number;
}

interface ParsedDeskTag {
  readonly tag: string;
  readonly expectedVersion?: number;
}

interface ParsedDeskShare {
  readonly userId: string;
  readonly permissions: readonly string[];
  readonly expectedVersion?: number;
}

interface ParsedDeskSavedFilter {
  readonly label: string;
  readonly filters: readonly ListDocumentsFilter[];
}

interface ParsedDeskSavedReport {
  readonly label: string;
  readonly definition: SavedReportDefinition;
}

interface ParsedDeskUserPermission {
  readonly userId: string;
  readonly targetDoctype: string;
  readonly targetName: string;
  readonly applicableDoctypes: readonly string[];
  readonly expectedVersion?: number;
}

interface ParsedDeskCreateUserAccount {
  readonly userId: string;
  readonly email?: string;
  readonly password: string;
  readonly roles: readonly string[];
  readonly enabled?: boolean;
  readonly expectedVersion?: number;
}

interface ParsedDeskChangeUserPassword {
  readonly userId: string;
  readonly password: string;
  readonly expectedVersion?: number;
}

interface ParsedDeskChangeUserRoles {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly expectedVersion?: number;
}

interface ParsedDeskChangeUserProfile {
  readonly userId: string;
  readonly profile: UserProfileInput;
  readonly expectedVersion?: number;
}

interface ParsedDeskSetUserEnabled {
  readonly userId: string;
  readonly expectedVersion?: number;
}

interface ParsedDeskCreateRole {
  readonly role: string;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly expectedVersion?: number;
}

interface ParsedDeskRoleDescription {
  readonly description?: string;
  readonly expectedVersion?: number;
}

interface ParsedDeskRoleStatus {
  readonly expectedVersion?: number;
}

interface ParsedDeskFileUpload {
  readonly filename: string;
  readonly body: Blob;
  readonly contentType: string;
  readonly isPrivate: boolean;
  readonly attachedTo?: {
    readonly doctype: string;
    readonly name: string;
  };
}

interface ParsedDeskFileMetadataUpdate {
  readonly filename: string;
  readonly isPrivate: boolean;
  readonly attachedTo:
    | {
        readonly doctype: string;
        readonly name: string;
      }
    | null;
  readonly expectedVersion?: number;
}

interface ParsedDeskDataPatchApply {
  readonly limit?: number;
}

interface ParsedDeskJobScheduleDefinition {
  readonly id?: string;
  readonly cron: string;
  readonly jobName: string;
  readonly enabled: boolean;
  readonly delaySeconds?: number;
}

async function parseDeskJobScheduleDefinition(request: Request): Promise<ParsedDeskJobScheduleDefinition> {
  const form = await readUrlEncodedDeskForm(request);
  const id = stringSearchParamValue(form, "id");
  const cron = stringSearchParamValue(form, "cron");
  const jobName = stringSearchParamValue(form, "jobName");
  const delay = stringSearchParamValue(form, "delaySeconds");
  if (cron === undefined) {
    throw new FrameworkError("BAD_REQUEST", "cron is required", { status: 400 });
  }
  if (jobName === undefined) {
    throw new FrameworkError("BAD_REQUEST", "jobName is required", { status: 400 });
  }
  const parsedDelay = delay === undefined ? undefined : Number(delay);
  if (parsedDelay !== undefined && (!Number.isInteger(parsedDelay) || parsedDelay < 0)) {
    throw new FrameworkError("BAD_REQUEST", "delaySeconds must be a non-negative integer", { status: 400 });
  }
  return {
    ...(id === undefined ? {} : { id }),
    cron,
    jobName,
    enabled: form.get("enabled") !== null,
    ...(parsedDelay === undefined ? {} : { delaySeconds: parsedDelay })
  };
}

async function parseDeskDataPatchApply(request: Request): Promise<ParsedDeskDataPatchApply> {
  const form = await readUrlEncodedDeskForm(request);
  const limit = stringSearchParamValue(form, "limit");
  if (limit === undefined) {
    return {};
  }
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new FrameworkError("BAD_REQUEST", "Data patch apply limit must be a positive integer", { status: 400 });
  }
  return { limit: parsed };
}

async function parseDeskFileUpload(request: Request): Promise<ParsedDeskFileUpload> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    throw new FrameworkError("BAD_REQUEST", "file is required", { status: 400 });
  }
  const filename = fileNameFromFormValue(file);
  const attachedToDoctype = stringFormValue(form, "attached_to_doctype").trim();
  const attachedToName = stringFormValue(form, "attached_to_name").trim();
  if ((attachedToDoctype && !attachedToName) || (!attachedToDoctype && attachedToName)) {
    throw new FrameworkError("BAD_REQUEST", "attached_to_doctype and attached_to_name must be provided together", {
      status: 400
    });
  }
  return {
    filename,
    body: file,
    contentType: file.type || "application/octet-stream",
    isPrivate: form.get("is_private") !== null,
    ...(attachedToDoctype && attachedToName
      ? { attachedTo: { doctype: attachedToDoctype, name: attachedToName } }
      : {})
  };
}

async function parseDeskFileMetadataUpdate(request: Request): Promise<ParsedDeskFileMetadataUpdate> {
  const form = await request.formData();
  const filename = stringFormValue(form, "filename");
  const attachedToDoctype = stringFormValue(form, "attached_to_doctype").trim();
  const attachedToName = stringFormValue(form, "attached_to_name").trim();
  if ((attachedToDoctype && !attachedToName) || (!attachedToDoctype && attachedToName)) {
    throw new FrameworkError("BAD_REQUEST", "attached_to_doctype and attached_to_name must be provided together", {
      status: 400
    });
  }
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    filename,
    isPrivate: form.get("is_private") !== null,
    attachedTo: attachedToDoctype && attachedToName ? { doctype: attachedToDoctype, name: attachedToName } : null,
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

function fileNameFromFormValue(file: Blob): string {
  const value = (file as Blob & { readonly name?: string }).name;
  if (typeof value !== "string" || value.trim() === "") {
    throw new FrameworkError("BAD_REQUEST", "filename is required", { status: 400 });
  }
  return value;
}

async function parseDeskComment(request: Request): Promise<ParsedDeskComment> {
  const form = await request.formData();
  const text = form.get("comment_text");
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    text: typeof text === "string" ? text : "",
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskSavedFilter(request: Request): Promise<ParsedDeskSavedFilter> {
  const form = await request.formData();
  const label = form.get("saved_filter_label");
  const params = new URLSearchParams();
  form.forEach((value, key) => {
    if (typeof value === "string") {
      params.append(key, value);
    }
  });
  return {
    label: typeof label === "string" ? label : "",
    filters: listFiltersFromUrl(new URL(`https://desk.local/?${params.toString()}`))
  };
}

async function parseDeskSavedReport(
  request: Request,
  doctype: DocTypeDefinition
): Promise<ParsedDeskSavedReport> {
  const form = await readUrlEncodedDeskForm(request);
  const fields = new Map(doctype.fields.map((field) => [field.name, field]));
  const columnNames = uniqueFormValues(form, "column");
  const filterNames = uniqueFormValues(form, "filter");
  const summaryNames = uniqueFormValues(form, "summary");
  const columns = columnNames.map((name) => reportColumnFor(fields, name));
  const filters = filterNames.map((name) => reportFilterFor(fields, name));
  const sumSummaries = summaryNames.map((name) => reportSumSummaryFor(fields, name));
  const summaries = [
    ...(form.get("summaryCount") === "1" ? [reportRecordCountSummary()] : []),
    ...sumSummaries
  ];
  const chartControls = parseReportChartControls(form);
  const groupBy = stringSearchParamValue(form, "groupBy") ?? stringSearchParamValue(form, "group");
  const groupSummaries = reportGroupSummariesFor(fields, sumSummaries, chartControls?.summary);
  const group = groupBy === undefined
    ? undefined
    : reportGroupFor(fields, groupBy, groupSummaries);
  const chart = reportChartFor(chartControls, group);
  const orderBy = stringSearchParamValue(form, "orderBy");
  const order = stringSearchParamValue(form, "order");
  return {
    label: form.get("label") ?? "",
    definition: {
      columns,
      ...(filters.length === 0 ? {} : { filters }),
      ...(summaries.length === 0 ? {} : { summaries }),
      ...(group === undefined ? {} : { groups: [group] }),
      ...(chart === undefined ? {} : { charts: [chart] }),
      ...(orderBy && columnNames.includes(orderBy) ? { orderBy } : {}),
      ...(order === "asc" || order === "desc" ? { order } : {})
    }
  };
}

async function parseDeskAssignment(request: Request): Promise<ParsedDeskAssignment> {
  const form = await request.formData();
  const assignee = form.get("assignee");
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    assignee: typeof assignee === "string" ? assignee : "",
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskTag(request: Request): Promise<ParsedDeskTag> {
  const form = await request.formData();
  const tag = form.get("tag");
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    tag: typeof tag === "string" ? tag : "",
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskShare(request: Request): Promise<ParsedDeskShare> {
  const form = await request.formData();
  const userId = form.get("user");
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    userId: typeof userId === "string" ? userId : "",
    permissions: form.getAll("permission").filter((permission): permission is string => typeof permission === "string"),
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskUserPermission(request: Request): Promise<ParsedDeskUserPermission> {
  const form = await request.formData();
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    userId: stringFormValue(form, "user"),
    targetDoctype: stringFormValue(form, "targetDoctype"),
    targetName: stringFormValue(form, "targetName"),
    applicableDoctypes: commaListFormValue(form.get("applicableDoctypes")),
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskCreateUserAccount(request: Request): Promise<ParsedDeskCreateUserAccount> {
  const form = await readUrlEncodedDeskForm(request);
  const email = stringSearchParamValue(form, "email");
  const enabled = optionalBooleanSearchParamValue(form, "enabled", "enabled");
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    userId: form.get("user") ?? "",
    ...(email === undefined ? {} : { email }),
    password: form.get("password") ?? "",
    roles: commaListFormValue(form.get("roles")),
    ...(enabled === undefined ? {} : { enabled }),
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskChangeUserPassword(request: Request): Promise<ParsedDeskChangeUserPassword> {
  const form = await readUrlEncodedDeskForm(request);
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    userId: form.get("user") ?? "",
    password: form.get("password") ?? "",
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskChangeUserRoles(request: Request): Promise<ParsedDeskChangeUserRoles> {
  const form = await readUrlEncodedDeskForm(request);
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    userId: form.get("user") ?? "",
    roles: commaListFormValue(form.get("roles")),
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskChangeUserProfile(request: Request): Promise<ParsedDeskChangeUserProfile> {
  const form = await readUrlEncodedDeskForm(request);
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  const profile: Record<string, string | null> = {};
  for (const field of USER_PROFILE_FIELDS) {
    if (form.has(field)) {
      const value = form.get(field) ?? "";
      profile[field] = value === "" ? null : value;
    }
  }
  return {
    userId: form.get("user") ?? "",
    profile,
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskSetUserEnabled(request: Request): Promise<ParsedDeskSetUserEnabled> {
  const form = await readUrlEncodedDeskForm(request);
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    userId: form.get("user") ?? "",
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskCreateRole(request: Request): Promise<ParsedDeskCreateRole> {
  const form = await readUrlEncodedDeskForm(request);
  const description = stringSearchParamValue(form, "description");
  const enabled = optionalBooleanSearchParamValue(form, "enabled", "enabled");
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    role: form.get("role") ?? "",
    ...(description === undefined ? {} : { description }),
    ...(enabled === undefined ? {} : { enabled }),
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskRoleDescription(request: Request): Promise<ParsedDeskRoleDescription> {
  const form = await readUrlEncodedDeskForm(request);
  const description = stringSearchParamValue(form, "description");
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    ...(description === undefined ? {} : { description }),
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskRoleStatus(request: Request): Promise<ParsedDeskRoleStatus> {
  const form = await readUrlEncodedDeskForm(request);
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
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

function stringFormValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function commaListFormValue(value: FormDataEntryValue | null): readonly string[] {
  if (typeof value !== "string") {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

async function parseDeskExpectedVersion(request: Request): Promise<number | undefined> {
  const form = await request.formData();
  return coerceExpectedVersion(form.get("expectedVersion"));
}

async function readUrlEncodedDeskForm(request: Request): Promise<URLSearchParams> {
  const text = await readBoundedText(
    request,
    MAX_DESK_FORM_BYTES,
    `Form body exceeds ${MAX_DESK_FORM_BYTES} bytes`
  );
  return new URLSearchParams(text);
}

function uniqueFormValues(form: URLSearchParams, key: string): readonly string[] {
  return [...new Set(form.getAll(key).map((value) => value.trim()).filter(Boolean))];
}

function stringSearchParamValue(form: URLSearchParams, key: string): string | undefined {
  const value = form.get(key)?.trim();
  return value ? value : undefined;
}

function optionalBooleanSearchParamValue(form: URLSearchParams, key: string, label: string): boolean | undefined {
  const value = stringSearchParamValue(form, key);
  if (value === undefined) {
    return undefined;
  }
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  throw new FrameworkError("BAD_REQUEST", `${label} must be true or false`, { status: 400 });
}

function truthyDeskParam(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function reportColumnFor(
  fields: ReadonlyMap<string, FieldDefinition>,
  name: string
): SavedReportDefinition["columns"][number] {
  const field = fields.get(name);
  if (!field || field.hidden) {
    throw new FrameworkError("BAD_REQUEST", `Unknown report column '${name}'`, { status: 400 });
  }
  return {
    name: field.name,
    label: deskReportFieldLabel(field),
    type: field.type
  };
}

function reportFilterFor(
  fields: ReadonlyMap<string, FieldDefinition>,
  name: string
): NonNullable<SavedReportDefinition["filters"]>[number] {
  const field = fields.get(name);
  if (!field || field.hidden || field.type === "json" || field.type === "table") {
    throw new FrameworkError("BAD_REQUEST", `Unknown report filter '${name}'`, { status: 400 });
  }
  return {
    name: field.name,
    label: deskReportFieldLabel(field),
    field: field.name,
    type: field.type as Exclude<FieldType, "json" | "table">,
    ...(field.type === "text" || field.type === "longText" ? { operator: "contains" } : {})
  };
}

function reportRecordCountSummary(): SavedReportSummaryDefinition {
  return {
    name: "record_count",
    label: "Records",
    aggregate: "count",
    type: "integer"
  };
}

function reportSumSummaryFor(
  fields: ReadonlyMap<string, FieldDefinition>,
  name: string
): SavedReportSummaryDefinition {
  const field = fields.get(name);
  if (!field || field.hidden || !isDeskNumericReportField(field)) {
    throw new FrameworkError("BAD_REQUEST", `Unknown report summary '${name}'`, { status: 400 });
  }
  return {
    name: deskReportSumSummaryName(field),
    label: deskReportSumSummaryLabel(field),
    aggregate: "sum",
    field: field.name,
    type: field.type
  };
}

function reportGroupFor(
  fields: ReadonlyMap<string, FieldDefinition>,
  name: string,
  summaries: readonly SavedReportSummaryDefinition[]
): SavedReportGroupDefinition {
  const field = fields.get(name);
  if (!field || field.hidden || !isDeskGroupableReportField(field)) {
    throw new FrameworkError("BAD_REQUEST", `Unknown report group '${name}'`, { status: 400 });
  }
  return {
    name: `by_${field.name}`,
    label: `By ${deskReportFieldLabel(field)}`,
    field: field.name,
    summaries,
    maxRows: DEFAULT_DESK_REPORT_GROUP_MAX_ROWS
  };
}

function reportGroupSummariesFor(
  fields: ReadonlyMap<string, FieldDefinition>,
  sumSummaries: readonly SavedReportSummaryDefinition[],
  chartSummaryName: string | undefined
): readonly SavedReportSummaryDefinition[] {
  const summaries = [reportRecordCountSummary(), ...sumSummaries];
  if (chartSummaryName === undefined || chartSummaryName === "record_count") {
    return summaries;
  }
  const chartSummary = reportChartSumSummaryFor(fields, chartSummaryName);
  return summaries.some((summary) => summary.name === chartSummary.name)
    ? summaries
    : [...summaries, chartSummary];
}

function reportChartSumSummaryFor(
  fields: ReadonlyMap<string, FieldDefinition>,
  summaryName: string
): SavedReportSummaryDefinition {
  for (const field of fields.values()) {
    if (!field.hidden && isDeskNumericReportField(field) && deskReportSumSummaryName(field) === summaryName) {
      return reportSumSummaryFor(fields, field.name);
    }
  }
  throw new FrameworkError("BAD_REQUEST", `Unknown report chart summary '${summaryName}'`, { status: 400 });
}

function parseReportChartControls(form: URLSearchParams): ParsedDeskReportChartControls | undefined {
  const chartType = optionalEnumSearchParamValue(form, "chartType", REPORT_CHART_TYPES, "Report chart type");
  if (chartType === undefined) {
    return undefined;
  }
  const orderBy = optionalEnumSearchParamValue(form, "chartOrderBy", REPORT_CHART_ORDER_BY, "Report chart orderBy");
  const order = optionalEnumSearchParamValue(form, "chartOrder", REPORT_CHART_ORDERS, "Report chart order");
  const maxPoints = boundedPositiveIntegerSearchParamValue(
    form,
    "chartMaxPoints",
    "Report chart max points",
    MAX_DESK_REPORT_CHART_POINTS
  ) ?? DEFAULT_DESK_REPORT_CHART_MAX_POINTS;
  return {
    type: chartType,
    summary: stringSearchParamValue(form, "chartSummary") ?? "record_count",
    maxPoints,
    ...(orderBy === undefined ? {} : { orderBy }),
    ...(order === undefined ? {} : { order })
  };
}

function reportChartFor(
  controls: ParsedDeskReportChartControls | undefined,
  group: SavedReportGroupDefinition | undefined
): SavedReportChartDefinition | undefined {
  if (controls === undefined) {
    return undefined;
  }
  if (group === undefined) {
    throw new FrameworkError("BAD_REQUEST", "Report chart requires a group", { status: 400 });
  }
  if (!group.summaries.some((summary) => summary.name === controls.summary)) {
    throw new FrameworkError("BAD_REQUEST", `Unknown report chart summary '${controls.summary}'`, { status: 400 });
  }
  return {
    name: "builder_chart",
    label: "Chart",
    type: controls.type,
    group: group.name,
    summary: controls.summary,
    maxPoints: controls.maxPoints,
    ...(controls.orderBy === undefined ? {} : { orderBy: controls.orderBy }),
    ...(controls.order === undefined ? {} : { order: controls.order }),
    showValues: true
  };
}

function optionalEnumSearchParamValue<TValue extends DeskReportChartType | DeskReportChartOrderBy | DeskReportChartOrder>(
  form: URLSearchParams,
  key: string,
  allowed: readonly TValue[],
  label: string
): TValue | undefined {
  const value = stringSearchParamValue(form, key);
  if (value === undefined) {
    return undefined;
  }
  if ((allowed as readonly string[]).includes(value)) {
    return value as TValue;
  }
  throw new FrameworkError("BAD_REQUEST", `${label} '${value}' is invalid`, { status: 400 });
}

function boundedPositiveIntegerSearchParamValue(
  form: URLSearchParams,
  key: string,
  label: string,
  max: number
): number | undefined {
  const value = stringSearchParamValue(form, key);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new FrameworkError("BAD_REQUEST", `${label} must be a positive integer`, { status: 400 });
  }
  if (parsed > max) {
    throw new FrameworkError("BAD_REQUEST", `${label} must be at most ${String(max)}`, { status: 400 });
  }
  return parsed;
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
