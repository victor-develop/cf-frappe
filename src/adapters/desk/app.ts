import { Hono } from "hono";
import type { AssignmentRuleService } from "../../application/assignment-rule-service.js";
import type { CalendarService } from "../../application/calendar-service.js";
import type { CustomFieldService } from "../../application/custom-field-service.js";
import type { DashboardService } from "../../application/dashboard-service.js";
import type {
  DataPatchQueueOptions,
  DataPatchQueuePort,
  DataPatchRollbackQueueOptions,
  DataPatchRollbackQueuePort,
  DataPatchRollbackRetryQueueOptions,
  DataPatchRollbackRetryQueuePort
} from "../../application/data-patch-jobs.js";
import type {
  DataPatchAdminPort,
  DataPatchApplyPlan,
  DataPatchRollbackPlan
} from "../../application/data-patch-service.js";
import type { DocumentShareService } from "../../application/document-share-service.js";
import type { DocumentCommandExecutor } from "../../application/document-service.js";
import type { DocumentHistoryService } from "../../application/document-history-service.js";
import {
  canImportDocuments,
  DocumentImportService,
  documentImportTemplate,
  type DocumentImportMode,
  type DocumentImportResult
} from "../../application/document-import-service.js";
import type { FieldPropertyService } from "../../application/field-property-service.js";
import type {
  FileDashboard,
  FileDashboardQuery,
  FileService,
  UpdateFileMetadataCommand
} from "../../application/file-service.js";
import { isPreviewableFileContentType } from "../../application/file-service.js";
import type { JobHistoryService } from "../../application/job-history-service.js";
import type { JobRetryPort } from "../../application/job-retry-service.js";
import type { JobScheduleService } from "../../application/job-schedule-service.js";
import type { KanbanService } from "../../application/kanban-service.js";
import type { NotificationRuleService } from "../../application/notification-rule-service.js";
import type { PrintService } from "../../application/print-service.js";
import type { PrintSettingsService } from "../../application/print-settings-service.js";
import { QueryService } from "../../application/query-service.js";
import type { ReportCsvExportOptions, ReportRunOptions, ReportService } from "../../application/report-service.js";
import type { RoleService } from "../../application/role-service.js";
import type { SavedListFilterService } from "../../application/saved-list-filter-service.js";
import type { SavedReportDefinition, SavedReportService } from "../../application/saved-report-service.js";
import type { UserAccountService } from "../../application/user-account-service.js";
import type { UserNotificationService } from "../../application/user-notification-service.js";
import type { UserPermissionService } from "../../application/user-permission-service.js";
import type { UserProfileService } from "../../application/user-profile-service.js";
import type { WorkflowService } from "../../application/workflow-service.js";
import { DOCUMENT_SHARE_PERMISSIONS, documentSharePermissionsForActor } from "../../core/document-shares.js";
import { FrameworkError, badRequest, conflict } from "../../core/errors.js";
import { can } from "../../core/permissions.js";
import type { ModelRegistry } from "../../core/registry.js";
import {
  isReportChartColor,
  isReportFilterGroup,
  REPORT_FORMULA_MAX_DEPTH,
  type ReportFilterExpression,
  type ReportFilterOperator,
  type ReportFormulaOperand
} from "../../core/reports.js";
import { USER_PROFILE_FIELDS, type UserProfileInput } from "../../core/user-profiles.js";
import {
  canReadWorkspace,
  canReadWorkspaceShortcut,
  type WorkspaceDefinition,
  type WorkspaceShortcutDefinition
} from "../../core/workspace.js";
import { allowedWorkflowTransitions } from "../../core/workflow.js";
import { MAX_JOB_QUEUE_DELAY_SECONDS, MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH } from "../../ports/job-queue.js";
import type { PrintPdfRenderer } from "../../ports/print-pdf-renderer.js";
import {
  PRINT_PAGE_ORIENTATIONS,
  PRINT_PAGE_SIZE_NAMES,
  type PrintLayoutDefinition,
  type PrintPageOrientation,
  type PrintPageSizeName
} from "../../core/print-format.js";
import type { PrintSettingsInput } from "../../core/print-settings.js";
import {
  CHILD_TABLE_ROW_INDEX_FIELD,
  FIELD_TYPES,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type AssignmentRuleAssigneeDefinition,
  type AssignmentRuleDefinition,
  type AssignmentRuleEventKind,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentSnapshot,
  type FieldDefinition,
  type FieldPropertyOverrides,
  type FieldType,
  type JsonPrimitive,
  type JsonValue,
  type LinkOption,
  type ListDocumentsFilter,
  type ListFilterExpression,
  type MutableDocumentData,
  type NotificationRuleChannel,
  type NotificationRuleDefinition,
  type NotificationRuleEventKind,
  type NotificationRuleRecipientDefinition,
  type ResolvedFormView,
  type WorkflowDefinition,
  type WorkflowTransition
} from "../../core/types.js";
import { fileContentHeaders } from "../file-content.js";
import type { ActorResolver } from "../http/actor.js";
import {
  listFilterExpressionFromUrl,
  listFiltersFromUrl,
  listOrderFromUrl,
  parseOptionalInteger,
  readBoundedText
} from "../http/request.js";
import { writeCsvDownloadHeaders, writeCsvExportHeaders, writeReportCsvHeaders } from "../http/report-export.js";
import {
  reportFilterExpressionFromUrl,
  reportFilterExpressionFromValue,
  reportFiltersFromUrl,
  reportOrderingFromUrl
} from "../report-request.js";
import {
  defaultPrintLayoutFor,
  printPdfResponseBody,
  printPdfResponseHeaders,
  renderPrintDocument,
  renderPrintPdfDocument,
  renderPrintPdfReport,
  renderPrintReport
} from "../print/index.js";
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
  renderDashboardList,
  renderDashboardView,
  renderCalendarList,
  renderCalendarView,
  renderErrorPanel,
  renderFileAttachmentPanel,
  renderFileManager,
  renderFieldPropertyAdmin,
  renderDataPatchAdmin,
  renderCustomFieldAdmin,
  renderDocumentPresencePanel,
  renderDocumentTimeline,
  renderFormView,
  renderGlobalSearchPage,
  renderJobAdmin,
  renderJobScheduleAdmin,
  renderKanbanList,
  renderKanbanView,
  renderListView,
  renderNotFound,
  renderAssignmentRuleAdmin,
  renderNotificationRuleAdmin,
  renderPrintSettingsAdmin,
  renderReportList,
  renderReportView,
  renderRoleAdmin,
  renderSavedReportBuilder,
  renderSavedReportView,
  renderUserNotificationInbox,
  renderUserAccountAdmin,
  renderUserPermissionAdmin,
  renderWorkflowAdmin,
  renderWorkspacePage,
  type DeskLayoutOptions,
  type DeskNavLink,
  type FormDomainCommandAction,
  type FormLifecycleAction,
  type FormLinkOptions,
  type FormTableDefinitions,
  type FormWorkflowAction,
  type ListBulkAction,
  type WorkspacePageView,
  type WorkspaceShortcutView
} from "./render.js";

const MAX_DESK_FORM_BYTES = 1_048_576;
const DEFAULT_DESK_REPORT_GROUP_MAX_ROWS = 50;
const DEFAULT_DESK_REPORT_CHART_MAX_POINTS = 50;
const MAX_DESK_REPORT_CHART_POINTS = 50;
const REPORT_CHART_TYPES = ["bar", "line", "pie"] as const;
const REPORT_CHART_ORDER_BY = ["key", "label", "value"] as const;
const REPORT_CHART_ORDERS = ["asc", "desc"] as const;
const REPORT_FORMULA_OPERATORS = ["add", "subtract", "multiply", "divide"] as const;
const REPORT_FORMULA_ROOT_OPERAND_DEPTH = 2;

type DeskReportChartType = (typeof REPORT_CHART_TYPES)[number];
type DeskReportChartOrderBy = (typeof REPORT_CHART_ORDER_BY)[number];
type DeskReportChartOrder = (typeof REPORT_CHART_ORDERS)[number];
type SavedReportColumnDefinition = SavedReportDefinition["columns"][number];
type SavedReportSummaryDefinition = NonNullable<SavedReportDefinition["summaries"]>[number];
type SavedReportGroupDefinition = NonNullable<SavedReportDefinition["groups"]>[number];
type SavedReportChartDefinition = NonNullable<SavedReportDefinition["charts"]>[number];
type DeskFormulaOperandKind = "field" | "literal" | "nested";

interface ParsedDeskReportChartControls {
  readonly type: DeskReportChartType;
  readonly summary: string;
  readonly maxPoints: number;
  readonly orderBy?: DeskReportChartOrderBy;
  readonly order?: DeskReportChartOrder;
  readonly colors?: readonly string[];
  readonly showValues: boolean;
  readonly xAxisLabel?: string;
  readonly yAxisLabel?: string;
}

interface ParsedDeskPrintSettings {
  readonly expectedVersion?: number;
  readonly settings: PrintSettingsInput;
}

interface ParsedDeskNotificationRule {
  readonly doctype: string;
  readonly rule: NotificationRuleDefinition;
  readonly expectedVersion?: number;
}

interface ParsedDeskNotificationRuleClear {
  readonly expectedVersion?: number;
}

interface ParsedDeskAssignmentRule {
  readonly doctype: string;
  readonly rule: AssignmentRuleDefinition;
  readonly expectedVersion?: number;
}

interface ParsedDeskAssignmentRuleClear {
  readonly expectedVersion?: number;
}

interface ParsedDeskCsvImport {
  readonly mode?: DocumentImportMode;
  readonly csv: string;
  readonly returnUrl?: URL;
}

export interface DeskAppOptions {
  readonly registry: ModelRegistry;
  readonly documents: DocumentCommandExecutor;
  readonly prints?: PrintService;
  readonly printSettings?: PrintSettingsService;
  readonly printPdfRenderer?: PrintPdfRenderer;
  readonly files?: FileService;
  readonly queries: QueryService;
  readonly adminRoles?: readonly string[];
  readonly documentShares?: DocumentShareService;
  readonly timeline?: DocumentHistoryService;
  readonly savedFilters?: SavedListFilterService;
  readonly savedReports?: SavedReportService;
  readonly roles?: RoleService;
  readonly customFields?: CustomFieldService;
  readonly fieldProperties?: FieldPropertyService;
  readonly workflows?: WorkflowService;
  readonly userAccounts?: UserAccountService;
  readonly notifications?: UserNotificationService;
  readonly notificationRules?: NotificationRuleService;
  readonly assignmentRules?: AssignmentRuleService;
  readonly userProfiles?: UserProfileService;
  readonly userPermissions?: UserPermissionService;
  readonly reports?: ReportService;
  readonly dashboards?: DashboardService;
  readonly kanbans?: KanbanService;
  readonly calendars?: CalendarService;
  readonly dataPatches?: DataPatchAdminPort;
  readonly dataPatchQueue?: DataPatchQueuePort;
  readonly dataPatchRollbackQueue?: DataPatchRollbackQueuePort;
  readonly dataPatchRollbackRetryQueue?: DataPatchRollbackRetryQueuePort;
  readonly jobs?: JobHistoryService;
  readonly jobRetry?: JobRetryPort;
  readonly jobSchedules?: JobScheduleService;
  readonly realtime?: boolean | { readonly route?: string };
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
    const dashboards = await listDashboards(options, actor);
    const kanbans = await listKanbans(options, actor);
    const calendars = await listCalendars(options, actor);
    const workspaces = listWorkspaces(options, actor);
    return html(
      renderDeskLayoutFor(options, {
        title: "Home",
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        dashboards,
        kanbans,
        calendars,
        workspaces,
        showNotifications: options.notifications !== undefined,
        showFiles: options.files !== undefined,
        body: renderDeskHome(doctypes, reports, workspaces, dashboards, kanbans, calendars)
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

  app.get("/desk/search", async (c) => {
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    const limit = parseOptionalInteger(url.searchParams.get("limit") ?? undefined);
    const tenant = url.searchParams.get("tenant")?.trim() || undefined;
    const result = query
      ? await options.queries.search(actor, {
          q: query,
          ...(limit === undefined ? {} : { limit }),
          ...(tenant === undefined ? {} : { tenantId: tenant })
        })
      : undefined;
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    const dashboards = await listDashboards(options, actor);
    const kanbans = await listKanbans(options, actor);
    const calendars = await listCalendars(options, actor);
    const workspaces = listWorkspaces(options, actor);
    const searchPage = renderGlobalSearchPage({
      query,
      ...(limit === undefined ? {} : { limit }),
      ...(tenant === undefined ? {} : { tenant }),
      ...(result === undefined ? {} : { result })
    });
    return html(
      renderDeskLayoutFor(options, {
        title: "Search",
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        dashboards,
        kanbans,
        calendars,
        workspaces,
        activeSearch: true,
        showNotifications: options.notifications !== undefined,
        showFiles: options.files !== undefined,
        body: searchPage
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
    const dashboards = await listDashboards(options, actor);
    const kanbans = await listKanbans(options, actor);
    const calendars = await listCalendars(options, actor);
    const workspaces = listWorkspaces(options, actor);
    return html(
      renderDeskLayoutFor(options, {
        title: "Reports",
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        dashboards,
        kanbans,
        calendars,
        workspaces,
        showFiles: options.files !== undefined,
        body: renderReportList(reports, {
          ...(options.savedReports === undefined ? {} : { builderDoctypes: doctypes })
        })
      })
    );
  });

  app.get("/desk/dashboards", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    const dashboards = await listDashboards(options, actor);
    const kanbans = await listKanbans(options, actor);
    const calendars = await listCalendars(options, actor);
    const workspaces = listWorkspaces(options, actor);
    return html(
      renderDeskLayoutFor(options, {
        title: "Dashboards",
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        dashboards,
        kanbans,
        calendars,
        workspaces,
        showFiles: options.files !== undefined,
        body: renderDashboardList(dashboards)
      })
    );
  });

  app.get("/desk/kanbans", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    const dashboards = await listDashboards(options, actor);
    const kanbans = await listKanbans(options, actor);
    const calendars = await listCalendars(options, actor);
    const workspaces = listWorkspaces(options, actor);
    return html(
      renderDeskLayoutFor(options, {
        title: "Kanban",
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        dashboards,
        kanbans,
        calendars,
        workspaces,
        showFiles: options.files !== undefined,
        body: renderKanbanList(kanbans)
      })
    );
  });

  app.get("/desk/kanbans/:kanban", async (c) => {
    const kanbansService = requireKanbans(options);
    const actor = await options.actor(c.req.raw);
    const result = await kanbansService.runKanban(actor, c.req.param("kanban"));
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    const dashboards = await listDashboards(options, actor);
    const kanbans = await listKanbans(options, actor);
    const calendars = await listCalendars(options, actor);
    const workspaces = listWorkspaces(options, actor);
    return html(
      renderDeskLayoutFor(options, {
        title: result.board.label ?? result.board.name,
        activeKanban: result.board.name,
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        dashboards,
        kanbans,
        calendars,
        workspaces,
        showFiles: options.files !== undefined,
        body: renderKanbanView(result)
      })
    );
  });

  app.get("/desk/calendars", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    const dashboards = await listDashboards(options, actor);
    const kanbans = await listKanbans(options, actor);
    const calendars = await listCalendars(options, actor);
    const workspaces = listWorkspaces(options, actor);
    return html(
      renderDeskLayoutFor(options, {
        title: "Calendars",
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        dashboards,
        kanbans,
        calendars,
        workspaces,
        showFiles: options.files !== undefined,
        body: renderCalendarList(calendars)
      })
    );
  });

  app.get("/desk/calendars/:calendar", async (c) => {
    const calendarsService = requireCalendars(options);
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;
    const limit = parseOptionalInteger(url.searchParams.get("limit") ?? undefined);
    const result = await calendarsService.runCalendar(actor, c.req.param("calendar"), {
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      ...(limit === undefined ? {} : { limit })
    });
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    const dashboards = await listDashboards(options, actor);
    const kanbans = await listKanbans(options, actor);
    const calendars = await listCalendars(options, actor);
    const workspaces = listWorkspaces(options, actor);
    return html(
      renderDeskLayoutFor(options, {
        title: result.calendar.label ?? result.calendar.name,
        activeCalendar: result.calendar.name,
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        dashboards,
        kanbans,
        calendars,
        workspaces,
        showFiles: options.files !== undefined,
        body: renderCalendarView(result)
      })
    );
  });

  app.get("/desk/dashboards/:dashboard", async (c) => {
    const dashboardsService = requireDashboards(options);
    const actor = await options.actor(c.req.raw);
    const result = await dashboardsService.runDashboard(actor, c.req.param("dashboard"));
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    const dashboards = await listDashboards(options, actor);
    const kanbans = await listKanbans(options, actor);
    const calendars = await listCalendars(options, actor);
    const workspaces = listWorkspaces(options, actor);
    return html(
      renderDeskLayoutFor(options, {
        title: result.dashboard.label ?? result.dashboard.name,
        activeDashboard: result.dashboard.name,
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        dashboards,
        kanbans,
        calendars,
        workspaces,
        showFiles: options.files !== undefined,
        body: renderDashboardView(result)
      })
    );
  });

  app.get("/desk/workspaces/:workspace", async (c) => {
    const actor = await options.actor(c.req.raw);
    const workspace = options.registry.getWorkspace(c.req.param("workspace"));
    if (!canReadWorkspace(actor, workspace)) {
      throw new FrameworkError("PERMISSION_DENIED", `Actor '${actor.id}' cannot read workspace '${workspace.name}'`, {
        status: 403
      });
    }
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    const dashboards = await listDashboards(options, actor);
    const kanbans = await listKanbans(options, actor);
    const calendars = await listCalendars(options, actor);
    const workspaces = listWorkspaces(options, actor);
    const page = workspacePageFor(options, actor, workspace, doctypes, reports, dashboards, kanbans, calendars);
    return html(
      renderDeskLayoutFor(options, {
        title: workspace.label ?? workspace.name,
        activeWorkspace: workspace.name,
        adminLinks: adminLinksFor(options, actor),
        doctypes,
        reports,
        dashboards,
        kanbans,
        calendars,
        workspaces,
        showFiles: options.files !== undefined,
        body: renderWorkspacePage(page)
      })
    );
  });

  app.get("/desk/files", async (c) => {
    const files = requireFiles(options);
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const dashboard = await files.dashboard(actor, fileDashboardQueryFromUrl(url));
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
      preflightDeskFileUpload(c.req.raw, files.maxUploadBytes);
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

  app.post("/desk/files/bulk-delete", async (c) => {
    const files = requireFiles(options);
    const actor = await options.actor(c.req.raw);
    try {
      const form = await parseDeskBulkFileDelete(c.req.raw);
      const result = await files.bulkDelete({
        actor,
        files: form.files,
        metadata: requestMetadata(c.req.raw)
      });
      if (result.failed.length > 0) {
        return renderDeskFileFailure(
          options,
          c.req.raw,
          actor,
          new FrameworkError("BAD_REQUEST", bulkFileDeleteFailureMessage(result.failed.length), { status: 400 })
        );
      }
      return c.redirect("/desk/files", 303);
    } catch (error) {
      return renderDeskFileFailure(options, c.req.raw, actor, error);
    }
  });

  app.post("/desk/files/bulk-metadata", async (c) => {
    const files = requireFiles(options);
    const actor = await options.actor(c.req.raw);
    try {
      const form = await parseDeskBulkFileMetadata(c.req.raw);
      const result = await files.bulkUpdateMetadata({
        actor,
        files: form.files,
        ...(form.isPrivate === undefined ? {} : { isPrivate: form.isPrivate }),
        ...(form.attachedTo === undefined ? {} : { attachedTo: form.attachedTo }),
        metadata: requestMetadata(c.req.raw)
      });
      if (result.failed.length > 0) {
        return renderDeskFileFailure(
          options,
          c.req.raw,
          actor,
          new FrameworkError("BAD_REQUEST", bulkFileMetadataFailureMessage(result.failed.length), { status: 400 })
        );
      }
      return c.redirect("/desk/files", 303);
    } catch (error) {
      return renderDeskFileFailure(options, c.req.raw, actor, error);
    }
  });

  app.get("/desk/files/:name/content", async (c) => {
    const files = requireFiles(options);
    const actor = await options.actor(c.req.raw);
    const downloaded = await files.download({ actor, name: c.req.param("name") });
    return new Response(downloaded.object.body, { headers: fileContentHeaders(downloaded, "attachment") });
  });

  app.get("/desk/files/:name/preview", async (c) => {
    const files = requireFiles(options);
    const actor = await options.actor(c.req.raw);
    const downloaded = await files.download({ actor, name: c.req.param("name") });
    const contentType = downloaded.object.metadata.contentType ?? "application/octet-stream";
    if (!isPreviewableFileContentType(contentType)) {
      throw new FrameworkError("BAD_REQUEST", `File '${downloaded.snapshot.name}' cannot be previewed`, { status: 400 });
    }
    return new Response(downloaded.object.body, { headers: fileContentHeaders(downloaded, "inline") });
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

  app.get("/desk/admin/custom-fields", async (c) => {
    const customFields = requireCustomFields(options);
    const actor = await options.actor(c.req.raw);
    customFields.authorizeAdministration(actor);
    const url = new URL(c.req.url);
    const doctypes = options.queries.listDoctypes(actor);
    const selectedDoctype = url.searchParams.get("doctype")?.trim() || doctypes[0]?.name || "";
    const state = selectedDoctype ? await customFields.list(actor, selectedDoctype) : undefined;
    return renderDeskCustomFieldPage(options, actor, selectedDoctype, state);
  });

  app.get("/desk/admin/field-properties", async (c) => {
    const fieldProperties = requireFieldProperties(options);
    const actor = await options.actor(c.req.raw);
    fieldProperties.authorizeAdministration(actor);
    const url = new URL(c.req.url);
    const doctypes = options.queries.listDoctypes(actor);
    const selectedDoctype = url.searchParams.get("doctype")?.trim() || doctypes[0]?.name || "";
    const doctype = selectedDoctype ? await options.queries.getEffectiveMeta(actor, selectedDoctype) : undefined;
    const selectedField = url.searchParams.get("field")?.trim() || doctype?.fields[0]?.name || "";
    const state = selectedDoctype ? await fieldProperties.list(actor, selectedDoctype) : undefined;
    return renderDeskFieldPropertyPage(options, actor, selectedDoctype, selectedField, doctype, state);
  });

  app.get("/desk/admin/workflows", async (c) => {
    const workflows = requireWorkflows(options);
    const actor = await options.actor(c.req.raw);
    workflows.authorizeAdministration(actor);
    const url = new URL(c.req.url);
    const doctypes = options.queries.listDoctypes(actor);
    const selectedDoctype = url.searchParams.get("doctype")?.trim() || doctypes[0]?.name || "";
    const state = selectedDoctype ? await workflows.list(actor, selectedDoctype) : undefined;
    return renderDeskWorkflowPage(options, actor, selectedDoctype, state);
  });

  app.get("/desk/admin/notification-rules", async (c) => {
    const notificationRules = requireNotificationRules(options);
    const actor = await options.actor(c.req.raw);
    notificationRules.authorizeAdministration(actor);
    const url = new URL(c.req.url);
    const doctypes = options.queries.listDoctypes(actor);
    const selectedDoctype = url.searchParams.get("doctype")?.trim() || doctypes[0]?.name || "";
    const selectedRule = url.searchParams.get("rule")?.trim() || undefined;
    const state = selectedDoctype ? await notificationRules.list(actor, selectedDoctype) : undefined;
    return renderDeskNotificationRulePage(options, actor, selectedDoctype, state, 200, undefined, selectedRule);
  });

  app.get("/desk/admin/assignment-rules", async (c) => {
    const assignmentRules = requireAssignmentRules(options);
    const actor = await options.actor(c.req.raw);
    assignmentRules.authorizeAdministration(actor);
    const url = new URL(c.req.url);
    const doctypes = options.queries.listDoctypes(actor);
    const selectedDoctype = url.searchParams.get("doctype")?.trim() || doctypes[0]?.name || "";
    const selectedRule = url.searchParams.get("rule")?.trim() || undefined;
    const state = selectedDoctype ? await assignmentRules.list(actor, selectedDoctype) : undefined;
    return renderDeskAssignmentRulePage(options, actor, selectedDoctype, state, 200, undefined, selectedRule);
  });

  app.get("/desk/admin/print-settings", async (c) => {
    const printSettings = requirePrintSettings(options);
    const actor = await options.actor(c.req.raw);
    const state = await printSettings.get(actor);
    return renderDeskPrintSettingsPage(options, actor, state);
  });

  app.post("/desk/admin/print-settings", async (c) => {
    const printSettings = requirePrintSettings(options);
    const actor = await options.actor(c.req.raw);
    try {
      const form = await parseDeskPrintSettings(c.req.raw);
      await printSettings.change({
        actor,
        settings: form.settings,
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect("/desk/admin/print-settings", 303);
    } catch (error) {
      return renderDeskPrintSettingsFailure(options, actor, printSettings, error);
    }
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
    return renderDeskDataPatchPage(
      options,
      actor,
      dashboard,
      200,
      undefined,
      undefined,
      dataPatchQueuedMessageFromUrl(c.req.url)
    );
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

  app.post("/desk/admin/data-patches/enqueue", async (c) => {
    const dataPatches = requireDataPatches(options);
    const dataPatchQueue = requireDataPatchQueue(options);
    const actor = await options.actor(c.req.raw);
    try {
      const form = await parseDeskDataPatchQueue(c.req.raw);
      const result = await dataPatchQueue.enqueue(actor, form);
      return c.redirect(dataPatchQueuedLocation("data patch", result.message), 303);
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
      return renderDeskDataPatchPage(options, actor, dashboard, 200, undefined, { kind: "apply", plan });
    } catch (error) {
      return renderDeskDataPatchFailure(options, actor, dataPatches, error);
    }
  });

  app.post("/desk/admin/data-patches/rollback-plan", async (c) => {
    const dataPatches = requireDataPatches(options);
    const actor = await options.actor(c.req.raw);
    try {
      const form = await parseDeskDataPatchApply(c.req.raw);
      const plan = await dataPatches.planRollback(actor, form.limit === undefined ? {} : { limit: form.limit });
      const dashboard = await dataPatches.dashboard(actor);
      return renderDeskDataPatchPage(options, actor, dashboard, 200, undefined, { kind: "rollback", plan });
    } catch (error) {
      return renderDeskDataPatchFailure(options, actor, dataPatches, error);
    }
  });

  app.post("/desk/admin/data-patches/rollback", async (c) => {
    const dataPatches = requireDataPatches(options);
    const actor = await options.actor(c.req.raw);
    try {
      const form = await parseDeskDataPatchApply(c.req.raw);
      await dataPatches.rollback(actor, form.limit === undefined ? {} : { limit: form.limit });
      return c.redirect("/desk/admin/data-patches", 303);
    } catch (error) {
      return renderDeskDataPatchFailure(options, actor, dataPatches, error);
    }
  });

  app.post("/desk/admin/data-patches/rollback-enqueue", async (c) => {
    const dataPatches = requireDataPatches(options);
    const dataPatchRollbackQueue = requireDataPatchRollbackQueue(options);
    const actor = await options.actor(c.req.raw);
    try {
      const form = await parseDeskDataPatchQueue(c.req.raw);
      const result = await dataPatchRollbackQueue.enqueueRollback(actor, form);
      return c.redirect(dataPatchQueuedLocation("data patch rollback", result.message), 303);
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

  app.post("/desk/admin/data-patches/:id/enqueue", async (c) => {
    const dataPatches = requireDataPatches(options);
    const dataPatchQueue = requireDataPatchQueue(options);
    const actor = await options.actor(c.req.raw);
    try {
      const delivery = await parseDeskDataPatchQueueDelivery(c.req.raw);
      const result = await dataPatchQueue.enqueue(actor, {
        patchIds: [c.req.param("id")],
        ...delivery
      });
      return c.redirect(dataPatchQueuedLocation("data patch", result.message), 303);
    } catch (error) {
      return renderDeskDataPatchFailure(options, actor, dataPatches, error);
    }
  });

  app.post("/desk/admin/data-patches/:id/retry", async (c) => {
    const dataPatches = requireDataPatches(options);
    const actor = await options.actor(c.req.raw);
    try {
      await dataPatches.retryFailed(actor, c.req.param("id"));
      return c.redirect("/desk/admin/data-patches", 303);
    } catch (error) {
      return renderDeskDataPatchFailure(options, actor, dataPatches, error);
    }
  });

  app.post("/desk/admin/data-patches/:id/rollback-retry", async (c) => {
    const dataPatches = requireDataPatches(options);
    const actor = await options.actor(c.req.raw);
    try {
      await dataPatches.retryRollbackFailed(actor, c.req.param("id"));
      return c.redirect("/desk/admin/data-patches", 303);
    } catch (error) {
      return renderDeskDataPatchFailure(options, actor, dataPatches, error);
    }
  });

  app.post("/desk/admin/data-patches/:id/rollback-retry-enqueue", async (c) => {
    const dataPatches = requireDataPatches(options);
    const dataPatchRollbackRetryQueue = requireDataPatchRollbackRetryQueue(options);
    const actor = await options.actor(c.req.raw);
    try {
      const delivery = await parseDeskDataPatchQueueDelivery(c.req.raw);
      const result = await dataPatchRollbackRetryQueue.enqueueRollbackRetry(
        actor,
        c.req.param("id"),
        delivery
      );
      return c.redirect(dataPatchQueuedLocation("data patch rollback retry", result.message), 303);
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
      return renderDeskDataPatchPage(options, actor, dashboard, 200, undefined, { kind: "apply", plan });
    } catch (error) {
      return renderDeskDataPatchFailure(options, actor, dataPatches, error);
    }
  });

  app.post("/desk/admin/data-patches/:id/rollback-plan", async (c) => {
    const dataPatches = requireDataPatches(options);
    const actor = await options.actor(c.req.raw);
    try {
      const plan = await dataPatches.planRollback(actor, { patchIds: [c.req.param("id")] });
      const dashboard = await dataPatches.dashboard(actor);
      return renderDeskDataPatchPage(options, actor, dashboard, 200, undefined, { kind: "rollback", plan });
    } catch (error) {
      return renderDeskDataPatchFailure(options, actor, dataPatches, error);
    }
  });

  app.post("/desk/admin/data-patches/:id/rollback", async (c) => {
    const dataPatches = requireDataPatches(options);
    const actor = await options.actor(c.req.raw);
    try {
      await dataPatches.rollback(actor, { patchIds: [c.req.param("id")] });
      return c.redirect("/desk/admin/data-patches", 303);
    } catch (error) {
      return renderDeskDataPatchFailure(options, actor, dataPatches, error);
    }
  });

  app.post("/desk/admin/data-patches/:id/rollback-enqueue", async (c) => {
    const dataPatches = requireDataPatches(options);
    const dataPatchRollbackQueue = requireDataPatchRollbackQueue(options);
    const actor = await options.actor(c.req.raw);
    try {
      const delivery = await parseDeskDataPatchQueueDelivery(c.req.raw);
      const result = await dataPatchRollbackQueue.enqueueRollback(actor, {
        patchIds: [c.req.param("id")],
        ...delivery
      });
      return c.redirect(dataPatchQueuedLocation("data patch rollback", result.message), 303);
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
    const form = await parseDeskJobScheduleForm(c.req.raw);
    await schedules.save(actor, {
      ...form.definition,
      preserveExistingFields: true,
      eventMetadata: requestMetadata(c.req.raw)
    });
    return c.redirect(jobScheduleAdminLocation(form.returnFilters), 303);
  });

  app.post("/desk/admin/jobs/schedules/:scheduleId/run", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    const returnFilters = await parseDeskJobScheduleReturnFilters(c.req.raw);
    await schedules.dispatch(actor, c.req.param("scheduleId"));
    return c.redirect(jobScheduleAdminLocation(returnFilters), 303);
  });

  app.post("/desk/admin/jobs/schedules/:scheduleId/delete", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    const returnFilters = await parseDeskJobScheduleReturnFilters(c.req.raw);
    await schedules.delete(actor, c.req.param("scheduleId"), { metadata: requestMetadata(c.req.raw) });
    return c.redirect(jobScheduleAdminLocation(returnFilters), 303);
  });

  app.post("/desk/admin/jobs/schedules/:scheduleId/enable", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    const returnFilters = await parseDeskJobScheduleReturnFilters(c.req.raw);
    await schedules.enable(actor, c.req.param("scheduleId"), { metadata: requestMetadata(c.req.raw) });
    return c.redirect(jobScheduleAdminLocation(returnFilters), 303);
  });

  app.post("/desk/admin/jobs/schedules/:scheduleId/disable", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    const returnFilters = await parseDeskJobScheduleReturnFilters(c.req.raw);
    await schedules.disable(actor, c.req.param("scheduleId"), { metadata: requestMetadata(c.req.raw) });
    return c.redirect(jobScheduleAdminLocation(returnFilters), 303);
  });

  app.post("/desk/admin/jobs/schedules/:scheduleId/pause", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    const form = await parseDeskJobSchedulePauseForm(c.req.raw);
    await schedules.pause(actor, c.req.param("scheduleId"), {
      pausedUntil: form.pausedUntil,
      metadata: requestMetadata(c.req.raw)
    });
    return c.redirect(jobScheduleAdminLocation(form.returnFilters), 303);
  });

  app.post("/desk/admin/jobs/schedules/:scheduleId/reset", async (c) => {
    const schedules = requireJobSchedules(options);
    const actor = await options.actor(c.req.raw);
    const returnFilters = await parseDeskJobScheduleReturnFilters(c.req.raw);
    await schedules.clearOverride(actor, c.req.param("scheduleId"), { metadata: requestMetadata(c.req.raw) });
    return c.redirect(jobScheduleAdminLocation(returnFilters), 303);
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

  app.post("/desk/admin/users/provider-sync", async (c) => {
    const userAccounts = requireUserAccounts(options);
    const actor = await options.actor(c.req.raw);
    userAccounts.authorizeAdministration(actor);
    let form: ParsedDeskSyncAuthProviderAccount | undefined;
    try {
      form = await parseDeskSyncAuthProviderAccount(c.req.raw);
      await userAccounts.syncProvider({
        actor,
        userId: form.userId,
        provider: form.provider,
        subject: form.subject,
        ...(form.email === undefined ? {} : { email: form.email }),
        ...(form.roles.length === 0 ? {} : { roles: form.roles }),
        ...(form.enabled === undefined ? {} : { enabled: form.enabled }),
        ...(form.emailVerified === undefined ? {} : { emailVerified: form.emailVerified }),
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

  app.post("/desk/admin/custom-fields", async (c) => {
    const customFields = requireCustomFields(options);
    const actor = await options.actor(c.req.raw);
    customFields.authorizeAdministration(actor);
    let form: ParsedDeskCustomField | undefined;
    try {
      form = await parseDeskCustomField(c.req.raw);
      await customFields.saveField({
        actor,
        doctype: form.doctype,
        field: form.field,
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(customFieldAdminHref(form.doctype), 303);
    } catch (error) {
      return renderDeskCustomFieldFailure(options, actor, customFields, form?.doctype ?? "", error);
    }
  });

  app.post("/desk/admin/custom-fields/:doctype/:field/disable", async (c) => {
    const customFields = requireCustomFields(options);
    const actor = await options.actor(c.req.raw);
    customFields.authorizeAdministration(actor);
    try {
      const form = await parseDeskCustomFieldDisable(c.req.raw);
      await customFields.disableField({
        actor,
        doctype: c.req.param("doctype"),
        fieldName: c.req.param("field"),
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(customFieldAdminHref(c.req.param("doctype")), 303);
    } catch (error) {
      return renderDeskCustomFieldFailure(options, actor, customFields, c.req.param("doctype"), error);
    }
  });

  app.post("/desk/admin/field-properties", async (c) => {
    const fieldProperties = requireFieldProperties(options);
    const actor = await options.actor(c.req.raw);
    fieldProperties.authorizeAdministration(actor);
    let form: ParsedDeskFieldPropertyOverride | undefined;
    try {
      form = await parseDeskFieldPropertyOverride(c.req.raw);
      await fieldProperties.save({
        actor,
        doctype: form.doctype,
        fieldName: form.fieldName,
        overrides: form.overrides,
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(fieldPropertyAdminHref(form.doctype, form.fieldName), 303);
    } catch (error) {
      return renderDeskFieldPropertyFailure(options, actor, fieldProperties, form?.doctype ?? "", form?.fieldName ?? "", error);
    }
  });

  app.post("/desk/admin/field-properties/:doctype/:field/clear", async (c) => {
    const fieldProperties = requireFieldProperties(options);
    const actor = await options.actor(c.req.raw);
    fieldProperties.authorizeAdministration(actor);
    try {
      const form = await parseDeskFieldPropertyOverrideClear(c.req.raw);
      await fieldProperties.clear({
        actor,
        doctype: c.req.param("doctype"),
        fieldName: c.req.param("field"),
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(fieldPropertyAdminHref(c.req.param("doctype"), c.req.param("field")), 303);
    } catch (error) {
      return renderDeskFieldPropertyFailure(options, actor, fieldProperties, c.req.param("doctype"), c.req.param("field"), error);
    }
  });

  app.post("/desk/admin/workflows", async (c) => {
    const workflows = requireWorkflows(options);
    const actor = await options.actor(c.req.raw);
    workflows.authorizeAdministration(actor);
    let form: ParsedDeskWorkflow | undefined;
    try {
      form = await parseDeskWorkflow(c.req.raw);
      await workflows.save({
        actor,
        doctype: form.doctype,
        workflow: form.workflow,
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(workflowAdminHref(form.doctype), 303);
    } catch (error) {
      return renderDeskWorkflowFailure(options, actor, workflows, form?.doctype ?? "", error);
    }
  });

  app.post("/desk/admin/workflows/:doctype/clear", async (c) => {
    const workflows = requireWorkflows(options);
    const actor = await options.actor(c.req.raw);
    workflows.authorizeAdministration(actor);
    try {
      const form = await parseDeskWorkflowClear(c.req.raw);
      await workflows.clear({
        actor,
        doctype: c.req.param("doctype"),
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(workflowAdminHref(c.req.param("doctype")), 303);
    } catch (error) {
      return renderDeskWorkflowFailure(options, actor, workflows, c.req.param("doctype"), error);
    }
  });

  app.post("/desk/admin/notification-rules", async (c) => {
    const notificationRules = requireNotificationRules(options);
    const actor = await options.actor(c.req.raw);
    notificationRules.authorizeAdministration(actor);
    let form: ParsedDeskNotificationRule | undefined;
    try {
      form = await parseDeskNotificationRule(c.req.raw);
      await notificationRules.save({
        actor,
        doctype: form.doctype,
        rule: form.rule,
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(notificationRuleAdminHref(form.doctype, form.rule.name), 303);
    } catch (error) {
      return renderDeskNotificationRuleFailure(options, actor, notificationRules, form?.doctype ?? "", error);
    }
  });

  app.post("/desk/admin/notification-rules/:doctype/:rule/clear", async (c) => {
    const notificationRules = requireNotificationRules(options);
    const actor = await options.actor(c.req.raw);
    notificationRules.authorizeAdministration(actor);
    try {
      const form = await parseDeskNotificationRuleClear(c.req.raw);
      await notificationRules.clear({
        actor,
        doctype: c.req.param("doctype"),
        ruleName: c.req.param("rule"),
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(notificationRuleAdminHref(c.req.param("doctype")), 303);
    } catch (error) {
      return renderDeskNotificationRuleFailure(options, actor, notificationRules, c.req.param("doctype"), error);
    }
  });

  app.post("/desk/admin/notification-rules/:doctype/:rule/enable", async (c) => {
    const notificationRules = requireNotificationRules(options);
    const actor = await options.actor(c.req.raw);
    notificationRules.authorizeAdministration(actor);
    try {
      const form = await parseDeskNotificationRuleClear(c.req.raw);
      await saveDeskNotificationRuleStatus({
        notificationRules,
        actor,
        doctype: c.req.param("doctype"),
        ruleName: c.req.param("rule"),
        enabled: true,
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(notificationRuleAdminHref(c.req.param("doctype"), c.req.param("rule")), 303);
    } catch (error) {
      return renderDeskNotificationRuleFailure(options, actor, notificationRules, c.req.param("doctype"), error);
    }
  });

  app.post("/desk/admin/notification-rules/:doctype/:rule/disable", async (c) => {
    const notificationRules = requireNotificationRules(options);
    const actor = await options.actor(c.req.raw);
    notificationRules.authorizeAdministration(actor);
    try {
      const form = await parseDeskNotificationRuleClear(c.req.raw);
      await saveDeskNotificationRuleStatus({
        notificationRules,
        actor,
        doctype: c.req.param("doctype"),
        ruleName: c.req.param("rule"),
        enabled: false,
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(notificationRuleAdminHref(c.req.param("doctype"), c.req.param("rule")), 303);
    } catch (error) {
      return renderDeskNotificationRuleFailure(options, actor, notificationRules, c.req.param("doctype"), error);
    }
  });

  app.post("/desk/admin/assignment-rules", async (c) => {
    const assignmentRules = requireAssignmentRules(options);
    const actor = await options.actor(c.req.raw);
    assignmentRules.authorizeAdministration(actor);
    let form: ParsedDeskAssignmentRule | undefined;
    try {
      form = await parseDeskAssignmentRule(c.req.raw);
      await assignmentRules.save({
        actor,
        doctype: form.doctype,
        rule: form.rule,
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(assignmentRuleAdminHref(form.doctype, form.rule.name), 303);
    } catch (error) {
      return renderDeskAssignmentRuleFailure(options, actor, assignmentRules, form?.doctype ?? "", error);
    }
  });

  app.post("/desk/admin/assignment-rules/:doctype/:rule/clear", async (c) => {
    const assignmentRules = requireAssignmentRules(options);
    const actor = await options.actor(c.req.raw);
    assignmentRules.authorizeAdministration(actor);
    try {
      const form = await parseDeskAssignmentRuleClear(c.req.raw);
      await assignmentRules.clear({
        actor,
        doctype: c.req.param("doctype"),
        ruleName: c.req.param("rule"),
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(assignmentRuleAdminHref(c.req.param("doctype")), 303);
    } catch (error) {
      return renderDeskAssignmentRuleFailure(options, actor, assignmentRules, c.req.param("doctype"), error);
    }
  });

  app.post("/desk/admin/assignment-rules/:doctype/:rule/enable", async (c) => {
    const assignmentRules = requireAssignmentRules(options);
    const actor = await options.actor(c.req.raw);
    assignmentRules.authorizeAdministration(actor);
    try {
      const form = await parseDeskAssignmentRuleClear(c.req.raw);
      await assignmentRules.setEnabled({
        actor,
        doctype: c.req.param("doctype"),
        ruleName: c.req.param("rule"),
        enabled: true,
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(assignmentRuleAdminHref(c.req.param("doctype"), c.req.param("rule")), 303);
    } catch (error) {
      return renderDeskAssignmentRuleFailure(options, actor, assignmentRules, c.req.param("doctype"), error);
    }
  });

  app.post("/desk/admin/assignment-rules/:doctype/:rule/disable", async (c) => {
    const assignmentRules = requireAssignmentRules(options);
    const actor = await options.actor(c.req.raw);
    assignmentRules.authorizeAdministration(actor);
    try {
      const form = await parseDeskAssignmentRuleClear(c.req.raw);
      await assignmentRules.setEnabled({
        actor,
        doctype: c.req.param("doctype"),
        ruleName: c.req.param("rule"),
        enabled: false,
        ...(form.expectedVersion === undefined ? {} : { expectedVersion: form.expectedVersion }),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(assignmentRuleAdminHref(c.req.param("doctype"), c.req.param("rule")), 303);
    } catch (error) {
      return renderDeskAssignmentRuleFailure(options, actor, assignmentRules, c.req.param("doctype"), error);
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
    const csv = await savedReports.exportCsv({
      actor,
      doctype: c.req.param("doctype"),
      id: c.req.param("id"),
      options: deskReportCsvOptionsFromUrl(url)
    });
    writeReportCsvHeaders(c, csv);
    return c.body(csv.body);
  });

  app.get("/desk/report-builder/:doctype/:id/pdf", async (c) => {
    const savedReports = requireSavedReports(options);
    if (!options.printPdfRenderer) {
      throw badRequest("PDF print rendering is not configured");
    }
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const saved = await savedReports.get(actor, doctype.name, c.req.param("id"));
    const result = await savedReports.run({
      actor,
      doctype: doctype.name,
      id: saved.id,
      options: deskReportRunOptionsFromUrl(url, 100)
    });
    const layout = await defaultPrintLayoutFor(options.printSettings, actor);
    const pdf = await renderPrintPdfReport({
      actor,
      renderer: options.printPdfRenderer,
      result,
      title: saved.label,
      ...(layout === undefined ? {} : { layout })
    });
    return new Response(printPdfResponseBody(pdf.body), { headers: printPdfResponseHeaders(pdf) });
  });

  app.get("/desk/report-builder/:doctype/:id/print", async (c) => {
    const savedReports = requireSavedReports(options);
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const saved = await savedReports.get(actor, doctype.name, c.req.param("id"));
    const result = await savedReports.run({
      actor,
      doctype: doctype.name,
      id: saved.id,
      options: deskReportRunOptionsFromUrl(url, 100)
    });
    const layout = await defaultPrintLayoutFor(options.printSettings, actor);
    return html(renderPrintReport(result, { title: saved.label, ...(layout === undefined ? {} : { layout }) }));
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
      options: deskReportRunOptionsFromUrl(url, 100)
    });
    const base = `/desk/report-builder/${encodeURIComponent(doctype.name)}/${encodeURIComponent(saved.id)}`;
    const printHref = `${base}/print${url.search}`;
    const pdfHref = options.printPdfRenderer === undefined ? undefined : `${base}/pdf${url.search}`;
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
          printHref,
          ...(pdfHref === undefined ? {} : { pdfHref }),
          deleteAction: `${base}/delete`,
          drilldownBaseHref: `${base}${url.search}`
        })
      })
    );
  });

  app.get("/desk/reports/:report/print", async (c) => {
    if (!options.reports) {
      throw new FrameworkError("REPORT_NOT_FOUND", "Reports are not enabled", { status: 404 });
    }
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const result = await options.reports.runReport(actor, c.req.param("report"), {
      ...deskReportRunOptionsFromUrl(url, 100)
    });
    const layout = await defaultPrintLayoutFor(options.printSettings, actor);
    return html(renderPrintReport(result, layout === undefined ? {} : { layout }));
  });

  app.get("/desk/reports/:report/pdf", async (c) => {
    if (!options.reports) {
      throw new FrameworkError("REPORT_NOT_FOUND", "Reports are not enabled", { status: 404 });
    }
    if (!options.printPdfRenderer) {
      throw badRequest("PDF print rendering is not configured");
    }
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const result = await options.reports.runReport(actor, c.req.param("report"), {
      ...deskReportRunOptionsFromUrl(url, 100)
    });
    const layout = await defaultPrintLayoutFor(options.printSettings, actor);
    const pdf = await renderPrintPdfReport({
      actor,
      renderer: options.printPdfRenderer,
      result,
      ...(layout === undefined ? {} : { layout })
    });
    return new Response(printPdfResponseBody(pdf.body), { headers: printPdfResponseHeaders(pdf) });
  });

  app.get("/desk/reports/:report", async (c) => {
    if (!options.reports) {
      throw new FrameworkError("REPORT_NOT_FOUND", "Reports are not enabled", { status: 404 });
    }
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const doctypes = options.queries.listDoctypes(actor);
    const reports = listReports(options, actor);
    const dashboards = await listDashboards(options, actor);
    const result = await options.reports.runReport(actor, c.req.param("report"), {
      ...deskReportRunOptionsFromUrl(url, 100)
    });
    const exportHref = `/desk/reports/${encodeURIComponent(result.report.name)}/export.csv${url.search}`;
    const printHref = `/desk/reports/${encodeURIComponent(result.report.name)}/print${url.search}`;
    const pdfHref = options.printPdfRenderer === undefined
      ? undefined
      : `/desk/reports/${encodeURIComponent(result.report.name)}/pdf${url.search}`;
    const drilldownBaseHref = `/desk/reports/${encodeURIComponent(result.report.name)}${url.search}`;
    return html(
      renderDeskLayoutFor(options, {
        title: result.report.label ?? result.report.name,
        adminLinks: adminLinksFor(options, actor),
        activeReport: result.report.name,
        doctypes,
        reports,
        dashboards,
        body: renderReportView(result, {
          exportHref,
          printHref,
          ...(pdfHref === undefined ? {} : { pdfHref }),
          drilldownBaseHref
        })
      })
    );
  });

  app.get("/desk/reports/:report/export.csv", async (c) => {
    if (!options.reports) {
      throw new FrameworkError("REPORT_NOT_FOUND", "Reports are not enabled", { status: 404 });
    }
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const csv = await options.reports.exportReportCsv(actor, c.req.param("report"), deskReportCsvOptionsFromUrl(url));
    writeReportCsvHeaders(c, csv);
    return c.body(csv.body);
  });

  app.get("/desk/print/:format/:name/pdf", async (c) => {
    if (!options.prints) {
      throw new FrameworkError("PRINT_FORMAT_NOT_FOUND", "Print formats are not enabled", { status: 404 });
    }
    if (!options.printPdfRenderer) {
      throw badRequest("PDF print rendering is not configured");
    }
    const actor = await options.actor(c.req.raw);
    const view = await options.prints.printDocument(actor, c.req.param("format"), c.req.param("name"));
    const pdf = await renderPrintPdfDocument({ actor, renderer: options.printPdfRenderer, view });
    return new Response(printPdfResponseBody(pdf.body), { headers: printPdfResponseHeaders(pdf) });
  });

  app.get("/desk/print/:format/:name", async (c) => {
    if (!options.prints) {
      throw new FrameworkError("PRINT_FORMAT_NOT_FOUND", "Print formats are not enabled", { status: 404 });
    }
    const actor = await options.actor(c.req.raw);
    const view = await options.prints.printDocument(actor, c.req.param("format"), c.req.param("name"));
    return html(renderPrintDocument(view));
  });

  app.get("/desk/:doctype/export.csv", async (c) => {
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const doctype = await options.queries.getEffectiveMeta(actor, c.req.param("doctype"));
    const filters = listFiltersFromUrl(url, { fields: listFilterParseFields(doctype) });
    const urlFilterExpression = listFilterExpressionFromUrl(url);
    const order = listOrderFromUrl(url);
    const savedFilterId = url.searchParams.get("saved_filter") ?? undefined;
    const savedFilter = savedFilterId && options.savedFilters
      ? await options.savedFilters.get(actor, doctype.name, savedFilterId)
      : undefined;
    const filterInput = options.savedFilters?.mergeSavedFilterInputs(savedFilter, filters, urlFilterExpression) ?? {
      filters,
      ...(urlFilterExpression === undefined ? {} : { filterExpression: urlFilterExpression })
    };
    const limit = parseOptionalInteger(url.searchParams.get("limit") ?? undefined);
    const csv = await options.queries.exportDocumentsCsv(actor, doctype.name, {
      filters: filterInput.filters,
      ...(filterInput.filterExpression === undefined ? {} : { filterExpression: filterInput.filterExpression }),
      ...order,
      useDefaultFilters: savedFilter ? false : url.searchParams.get("default_filters") !== "0",
      ...(limit !== undefined ? { limit } : {})
    });
    writeCsvExportHeaders(c, csv);
    return c.body(csv.body);
  });

  app.get("/desk/:doctype/import-template.csv", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = await options.queries.getEffectiveMeta(actor, c.req.param("doctype"));
    if (!canImportDocuments(actor, doctype)) {
      throw new FrameworkError("PERMISSION_DENIED", `Actor '${actor.id}' cannot import ${doctype.name}`, {
        status: 403
      });
    }
    const template = documentImportTemplate(doctype);
    writeCsvDownloadHeaders(c, template);
    return c.body(template.body);
  });

  app.get("/desk/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    return renderDeskListPage(options, actor, c.req.param("doctype"), new URL(c.req.url));
  });

  app.post("/desk/:doctype/import.csv", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = await options.queries.getEffectiveMeta(actor, c.req.param("doctype"));
    try {
      const form = await parseDeskCsvImport(c.req.raw, doctype.name);
      const action = form.mode ?? "create";
      if (!can(actor, doctype, action)) {
        throw new FrameworkError("PERMISSION_DENIED", `Actor '${actor.id}' cannot ${action} ${doctype.name}`, {
          status: 403
        });
      }
      const importer = new DocumentImportService({
        documents: options.documents,
        queries: options.queries
      });
      const importResult = await importer.importCsv({
        actor,
        doctype: doctype.name,
        csv: form.csv,
        ...(form.mode === undefined ? {} : { mode: form.mode }),
        metadata: requestMetadata(c.req.raw)
      });
      return renderDeskListPage(
        options,
        actor,
        doctype.name,
        form.returnUrl ?? new URL(`/desk/${encodeURIComponent(doctype.name)}`, c.req.url),
        { importResult }
      );
    } catch (error) {
      return renderDeskFailure(options, c.req.raw, error);
    }
  });

  app.post("/desk/:doctype/saved-filters", async (c) => {
    if (!options.savedFilters) {
      throw new FrameworkError("DOCUMENT_NOT_FOUND", "Saved filters are not enabled", { status: 404 });
    }
    const actor = await options.actor(c.req.raw);
    const doctype = await options.queries.getEffectiveMeta(actor, c.req.param("doctype"));
    try {
      const form = await parseDeskSavedFilter(c.req.raw, doctype);
      const saved = await options.savedFilters.save({
        actor,
        doctype: doctype.name,
        label: form.label,
        filters: form.filters,
        ...(form.filterExpression === undefined ? {} : { filterExpression: form.filterExpression })
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
    const doctype = await options.queries.getEffectiveMeta(actor, c.req.param("doctype"));
    await options.savedFilters.delete({
      actor,
      doctype: doctype.name,
      id: c.req.param("filterId")
    });
    return c.redirect(`/desk/${encodeURIComponent(doctype.name)}`, 303);
  });

  app.post("/desk/:doctype/bulk-delete", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    try {
      const form = await parseDeskBulkDocumentAction(c.req.raw, doctype.name);
      const result = await options.documents.bulkDelete({
        actor,
        doctype: doctype.name,
        documents: form.documents,
        metadata: requestMetadata(c.req.raw)
      });
      if (result.failed.length > 0) {
        return renderDeskFailure(
          options,
          c.req.raw,
          new FrameworkError("BAD_REQUEST", bulkDocumentDeleteFailureMessage(result.failed.length), { status: 400 })
        );
      }
      return c.redirect(deskListRedirectUrl(c.req.url, doctype.name, form.returnUrl), 303);
    } catch (error) {
      return renderDeskFailure(options, c.req.raw, error);
    }
  });

  app.post("/desk/:doctype/bulk-submit", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    try {
      const form = await parseDeskBulkDocumentAction(c.req.raw, doctype.name);
      const result = await options.documents.bulkSubmit({
        actor,
        doctype: doctype.name,
        documents: form.documents,
        metadata: requestMetadata(c.req.raw)
      });
      if (result.failed.length > 0) {
        return renderDeskFailure(
          options,
          c.req.raw,
          new FrameworkError("BAD_REQUEST", bulkDocumentActionFailureMessage(result.failed.length, "submitted"), {
            status: 400
          })
        );
      }
      return c.redirect(deskListRedirectUrl(c.req.url, doctype.name, form.returnUrl), 303);
    } catch (error) {
      return renderDeskFailure(options, c.req.raw, error);
    }
  });

  app.post("/desk/:doctype/bulk-cancel", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    try {
      const form = await parseDeskBulkDocumentAction(c.req.raw, doctype.name);
      const result = await options.documents.bulkCancel({
        actor,
        doctype: doctype.name,
        documents: form.documents,
        metadata: requestMetadata(c.req.raw)
      });
      if (result.failed.length > 0) {
        return renderDeskFailure(
          options,
          c.req.raw,
          new FrameworkError("BAD_REQUEST", bulkDocumentActionFailureMessage(result.failed.length, "cancelled"), {
            status: 400
          })
        );
      }
      return c.redirect(deskListRedirectUrl(c.req.url, doctype.name, form.returnUrl), 303);
    } catch (error) {
      return renderDeskFailure(options, c.req.raw, error);
    }
  });

  app.post("/desk/:doctype/bulk-transition/:action", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    try {
      const form = await parseDeskBulkDocumentAction(c.req.raw, doctype.name);
      const result = await options.documents.bulkTransition({
        actor,
        doctype: doctype.name,
        action: c.req.param("action"),
        documents: form.documents,
        metadata: requestMetadata(c.req.raw)
      });
      if (result.failed.length > 0) {
        return renderDeskFailure(
          options,
          c.req.raw,
          new FrameworkError("BAD_REQUEST", bulkDocumentActionFailureMessage(result.failed.length, "transitioned"), {
            status: 400
          })
        );
      }
      return c.redirect(deskListRedirectUrl(c.req.url, doctype.name, form.returnUrl), 303);
    } catch (error) {
      return renderDeskFailure(options, c.req.raw, error);
    }
  });

  app.get("/desk/:doctype/new", async (c) => {
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const doctype = await options.queries.getEffectiveCreateMeta(actor, c.req.param("doctype"));
    const formView = await options.queries.getEffectiveCreateFormView(actor, doctype.name);
    const tableDefinitions = await tableDefinitionsForForm(options, actor, doctype, formView);
    const linkOptions = await linkOptionsForForm(options, actor, doctype, formView, tableDefinitions);
    const doctypes = await listDeskDoctypes(options, actor);
    const reports = listReports(options, actor);
    const created = url.searchParams.get("created")?.trim();
    return html(
      renderDeskLayoutFor(options, {
        title: `New ${doctype.label ?? doctype.name}`,
        adminLinks: adminLinksFor(options, actor),
        active: doctype.name,
        doctypes,
        reports,
        ...(created ? { message: `Created ${doctype.name}/${created}` } : {}),
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
    const doctype = await options.queries.getEffectiveCreateMeta(actor, c.req.param("doctype"));
    const formView = await options.queries.getEffectiveCreateFormView(actor, doctype.name);
    const tableDefinitions = await tableDefinitionsForForm(options, actor, doctype, formView);
    try {
      const snapshot = await options.documents.create({
        actor,
        doctype: doctype.name,
        data: (await parseDeskForm(c.req.raw, doctype, formView, tableDefinitions)).data,
        metadata: requestMetadata(c.req.raw)
      });
      const location = can(actor, doctype, "read")
        ? `/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(snapshot.name)}`
        : `/desk/${encodeURIComponent(doctype.name)}/new?created=${encodeURIComponent(snapshot.name)}`;
      return c.redirect(location, 303);
    } catch (error) {
      return renderDeskError(options, c.req.raw, actor, doctype, "create", error);
    }
  });

  app.get("/desk/:doctype/:name", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = await options.queries.getEffectiveMeta(actor, c.req.param("doctype"));
    return renderDeskDocumentPage(options, actor, doctype, c.req.param("name"));
  });

  app.post("/desk/:doctype/:name/files", async (c) => {
    const files = requireFiles(options);
    const actor = await options.actor(c.req.raw);
    const doctype = options.queries.getMeta(actor, c.req.param("doctype"));
    const name = c.req.param("name");
    try {
      preflightDeskFileUpload(c.req.raw, files.maxUploadBytes);
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

  app.post("/desk/:doctype/:name/duplicate", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = await options.queries.getEffectiveMeta(actor, c.req.param("doctype"));
    const formView = await options.queries.getEffectiveFormView(actor, doctype.name);
    const name = c.req.param("name");
    const tableDefinitions = await tableDefinitionsForForm(options, actor, doctype, formView);
    try {
      const form = await parseDeskForm(c.req.raw, doctype, formView, tableDefinitions);
      const snapshot = await options.documents.duplicate({
        actor,
        doctype: doctype.name,
        name,
        data: form.data,
        ...(form.expectedVersion !== undefined ? { expectedVersion: form.expectedVersion } : {}),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(snapshot.name)}`, 303);
    } catch (error) {
      return renderDeskError(options, c.req.raw, actor, doctype, "update", error, name);
    }
  });

  app.post("/desk/:doctype/:name/amend", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = await options.queries.getEffectiveMeta(actor, c.req.param("doctype"));
    const formView = await options.queries.getEffectiveFormView(actor, doctype.name);
    const name = c.req.param("name");
    const tableDefinitions = await tableDefinitionsForForm(options, actor, doctype, formView);
    try {
      const form = await parseDeskForm(c.req.raw, doctype, formView, tableDefinitions);
      const snapshot = await options.documents.amend({
        actor,
        doctype: doctype.name,
        name,
        data: form.data,
        ...(form.expectedVersion !== undefined ? { expectedVersion: form.expectedVersion } : {}),
        metadata: requestMetadata(c.req.raw)
      });
      return c.redirect(`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(snapshot.name)}`, 303);
    } catch (error) {
      return renderDeskError(options, c.req.raw, actor, doctype, "update", error, name);
    }
  });

  app.post("/desk/:doctype/:name", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = await options.queries.getEffectiveMeta(actor, c.req.param("doctype"));
    const formView = await options.queries.getEffectiveFormView(actor, doctype.name);
    const name = c.req.param("name");
    const tableDefinitions = await tableDefinitionsForForm(options, actor, doctype, formView);
    try {
      const form = await parseDeskForm(c.req.raw, doctype, formView, tableDefinitions);
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
    const doctype = await options.queries.getEffectiveMeta(actor, c.req.param("doctype"));
    const formView = await options.queries.getEffectiveFormView(actor, doctype.name);
    const name = c.req.param("name");
    const tableDefinitions = await tableDefinitionsForForm(options, actor, doctype, formView);
    try {
      const commandName = c.req.param("command");
      const commandDefinition = doctype.commands?.find((item) => item.name === commandName);
      if (commandDefinition?.internal) {
        throw new FrameworkError("BAD_REQUEST", `${doctype.name} command '${commandName}' is internal`, {
          status: 400
        });
      }
      const form = await parseDeskForm(c.req.raw, doctype, formView, tableDefinitions);
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
  const doctypes = actor === undefined ? [] : await listDeskDoctypes(options, actor);
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

async function renderDeskListPage(
  options: DeskAppOptions,
  actor: Actor,
  doctypeName: string,
  url: URL,
  result: { readonly importResult?: DocumentImportResult } = {}
): Promise<Response> {
  const doctype = await options.queries.getEffectiveMeta(actor, doctypeName);
  const doctypes = await listDeskDoctypes(options, actor);
  const reports = listReports(options, actor);
  const filters = listFiltersFromUrl(url, { fields: listFilterParseFields(doctype) });
  const urlFilterExpression = listFilterExpressionFromUrl(url);
  const order = listOrderFromUrl(url);
  const savedFilterId = url.searchParams.get("saved_filter") ?? undefined;
  const savedFilter = savedFilterId && options.savedFilters
    ? await options.savedFilters.get(actor, doctype.name, savedFilterId)
    : undefined;
  const filterInput = options.savedFilters?.mergeSavedFilterInputs(savedFilter, filters, urlFilterExpression) ?? {
    filters,
    ...(urlFilterExpression === undefined ? {} : { filterExpression: urlFilterExpression })
  };
  const limit = parseOptionalInteger(url.searchParams.get("limit") ?? undefined);
  const offset = parseOptionalInteger(url.searchParams.get("offset") ?? undefined);
  const { listView, filters: effectiveFilters, filterExpression, result: listResult } =
    await options.queries.listDocumentsForView(actor, doctype.name, {
      filters: filterInput.filters,
      ...(filterInput.filterExpression === undefined ? {} : { filterExpression: filterInput.filterExpression }),
      ...order,
      useDefaultFilters: savedFilter ? false : url.searchParams.get("default_filters") !== "0",
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {})
    });
  const savedFilters = await options.savedFilters?.list(actor, doctype.name);
  const bulkActions = listBulkActionsFor(actor, doctype, listResult.data);
  const importModes = deskCsvImportModesFor(actor, doctype);
  const exportHref = `/desk/${encodeURIComponent(doctype.name)}/export.csv${url.search}`;
  const listReturnHref = `/desk/${encodeURIComponent(doctype.name)}${url.search}`;
  return html(
    renderDeskLayoutFor(options, {
      title: doctype.label ?? doctype.name,
      adminLinks: adminLinksFor(options, actor),
      active: doctype.name,
      doctypes,
      reports,
      body: renderListView(doctype, listView, listResult.data, effectiveFilters, {
        ...(filterExpression === undefined ? {} : { filterExpression }),
        ...(savedFilters ? { savedFilters } : {}),
        ...(savedFilter ? { selectedSavedFilterId: savedFilter.id } : {}),
        exportHref,
        clientScripts: options.registry.listClientScripts(doctype.name, "list"),
        bulkActions,
        bulkReturnHref: listReturnHref,
        importModes,
        importReturnHref: listReturnHref,
        ...(result.importResult === undefined ? {} : { importResult: result.importResult }),
        canCreate: can(actor, doctype, "create"),
        ...deskRealtimeRouteOption(options)
      })
    })
  );
}

function deskCsvImportModesFor(actor: Actor, doctype: DocTypeDefinition): readonly DocumentImportMode[] {
  return [
    ...(can(actor, doctype, "create") ? (["create"] as const) : []),
    ...(can(actor, doctype, "update") ? (["update"] as const) : [])
  ];
}

function deskReportCsvOptionsFromUrl(url: URL): ReportCsvExportOptions {
  const limit = parseOptionalInteger(url.searchParams.get("limit") ?? undefined);
  const filterExpression = reportFilterExpressionFromUrl(url);
  return {
    filters: reportFiltersFromUrl(url),
    ...(filterExpression === undefined ? {} : { filterExpression }),
    ...reportOrderingFromUrl(url),
    ...(limit !== undefined ? { limit } : {})
  };
}

function deskReportRunOptionsFromUrl(url: URL, defaultLimit?: number): ReportRunOptions {
  const limit = parseOptionalInteger(url.searchParams.get("limit") ?? undefined);
  const offset = parseOptionalInteger(url.searchParams.get("offset") ?? undefined);
  const filterExpression = reportFilterExpressionFromUrl(url);
  return {
    filters: reportFiltersFromUrl(url),
    ...(filterExpression === undefined ? {} : { filterExpression }),
    ...reportOrderingFromUrl(url),
    ...(limit !== undefined ? { limit } : defaultLimit === undefined ? {} : { limit: defaultLimit }),
    ...(offset !== undefined ? { offset } : {})
  };
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
  const doctypes = await listDeskDoctypes(options, actor);
  const reports = listReports(options, actor);
  const formView = mode === "create"
    ? await options.queries.getEffectiveCreateFormView(actor, doctype.name)
    : await options.queries.getEffectiveFormView(actor, doctype.name);
  const tableDefinitions = await tableDefinitionsForForm(options, actor, doctype, formView);
  const linkOptions = await linkOptionsForForm(options, actor, doctype, formView, tableDefinitions);
  const document = name ? await options.queries.getDocument(actor, doctype.name, name).catch(() => undefined) : undefined;
  const canUpdate = document ? await options.queries.canActOnDocument(actor, doctype, "update", document) : false;
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
        canUpdate,
        ...(document ? { domainCommands: await domainCommandActionsFor(options, actor, doctype, document) } : {}),
        ...(document ? { lifecycleActions: lifecycleActionsFor(actor, doctype, document) } : {}),
        ...(document ? { workflowActions: workflowActionsFor(actor, doctype, document) } : {}),
        ...(document ? { printFormats: listPrintFormats(options, actor, doctype.name) } : {}),
        printPdfEnabled: options.printPdfRenderer !== undefined,
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

async function listDashboards(options: DeskAppOptions, actor: Actor) {
  return options.dashboards?.listDashboards(actor) ?? [];
}

async function listKanbans(options: DeskAppOptions, actor: Actor) {
  return options.kanbans?.listKanbans(actor) ?? [];
}

async function listCalendars(options: DeskAppOptions, actor: Actor) {
  return options.calendars?.listCalendars(actor) ?? [];
}

function listDeskDoctypes(options: DeskAppOptions, actor: Actor): Promise<readonly DocTypeDefinition[]> {
  return options.queries.listEffectiveDoctypes(actor);
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
  const adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
  if (!adminRoles.some((role) => actor.roles.includes(role))) {
    return [];
  }
  return [
    ...(options.userAccounts === undefined ? [] : [{ id: "users", label: "Users", href: "/desk/admin/users" }]),
    ...(options.roles === undefined ? [] : [{ id: "roles", label: "Roles", href: "/desk/admin/roles" }]),
    ...(options.customFields === undefined
      ? []
      : [{ id: "custom-fields", label: "Custom Fields", href: "/desk/admin/custom-fields" }]),
    ...(options.fieldProperties === undefined
      ? []
      : [{ id: "field-properties", label: "Field Properties", href: "/desk/admin/field-properties" }]),
    ...(options.workflows === undefined
      ? []
      : [{ id: "workflows", label: "Workflows", href: "/desk/admin/workflows" }]),
    ...(options.notificationRules === undefined
      ? []
      : [{ id: "notification-rules", label: "Notification Rules", href: "/desk/admin/notification-rules" }]),
    ...(options.assignmentRules === undefined
      ? []
      : [{ id: "assignment-rules", label: "Assignment Rules", href: "/desk/admin/assignment-rules" }]),
    ...(options.printSettings === undefined
      ? []
      : [{ id: "print-settings", label: "Print Settings", href: "/desk/admin/print-settings" }]),
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

function listWorkspaces(options: DeskAppOptions, actor: Actor): readonly WorkspaceDefinition[] {
  return options.registry.listWorkspaces().filter((workspace) => canReadWorkspace(actor, workspace));
}

function requireKanbans(options: DeskAppOptions): KanbanService {
  if (!options.kanbans) {
    throw new FrameworkError("DOCUMENT_NOT_FOUND", "Kanbans are not enabled", { status: 404 });
  }
  return options.kanbans;
}

function requireCalendars(options: DeskAppOptions): CalendarService {
  if (!options.calendars) {
    throw new FrameworkError("CALENDAR_NOT_FOUND", "Calendars are not enabled", { status: 404 });
  }
  return options.calendars;
}

function workspacePageFor(
  options: DeskAppOptions,
  actor: Actor,
  workspace: WorkspaceDefinition,
  doctypes: readonly DocTypeDefinition[],
  reports: ReturnType<typeof listReports>,
  dashboards: Awaited<ReturnType<typeof listDashboards>>,
  kanbans: Awaited<ReturnType<typeof listKanbans>>,
  calendars: Awaited<ReturnType<typeof listCalendars>>
): WorkspacePageView {
  const adminLinks = adminLinksFor(options, actor);
  const creatableDoctypes = options.registry.list().filter((doctype) => can(actor, doctype, "create"));
  return {
    workspace,
    sections: workspace.sections.map((section) => ({
      name: section.name,
      label: section.label ?? section.name,
      shortcuts: section.shortcuts.flatMap((shortcut) =>
        workspaceShortcutFor(options, actor, shortcut, doctypes, creatableDoctypes, reports, dashboards, kanbans, calendars, adminLinks)
      )
    }))
  };
}

function workspaceShortcutFor(
  options: DeskAppOptions,
  actor: Actor,
  shortcut: WorkspaceShortcutDefinition,
  doctypes: readonly DocTypeDefinition[],
  creatableDoctypes: readonly DocTypeDefinition[],
  reports: ReturnType<typeof listReports>,
  dashboards: Awaited<ReturnType<typeof listDashboards>>,
  kanbans: Awaited<ReturnType<typeof listKanbans>>,
  calendars: Awaited<ReturnType<typeof listCalendars>>,
  adminLinks: readonly DeskNavLink[]
): readonly WorkspaceShortcutView[] {
  if (!canReadWorkspaceShortcut(actor, shortcut)) {
    return [];
  }
  if (shortcut.kind === "doctype") {
    const doctype = doctypes.find((item) => item.name === shortcut.target);
    return doctype
      ? [{
          name: shortcut.name,
          label: shortcut.label ?? doctype.label ?? doctype.name,
          ...(shortcut.description === undefined ? {} : { description: shortcut.description }),
          kind: shortcut.kind,
          href: `/desk/${encodeURIComponent(doctype.name)}`
        }]
      : [];
  }
  if (shortcut.kind === "newDoc") {
    const doctype = creatableDoctypes.find((item) => item.name === shortcut.target);
    return doctype
      ? [{
          name: shortcut.name,
          label: shortcut.label ?? `New ${doctype.label ?? doctype.name}`,
          ...(shortcut.description === undefined ? {} : { description: shortcut.description }),
          kind: shortcut.kind,
          href: `/desk/${encodeURIComponent(doctype.name)}/new`
        }]
      : [];
  }
  if (shortcut.kind === "report") {
    const report = reports.find((item) => item.name === shortcut.target);
    return report
      ? [{
          name: shortcut.name,
          label: shortcut.label ?? report.label ?? report.name,
          ...(shortcut.description === undefined ? {} : { description: shortcut.description }),
          kind: shortcut.kind,
          href: `/desk/reports/${encodeURIComponent(report.name)}`
        }]
      : [];
  }
  if (shortcut.kind === "dashboard") {
    const dashboard = dashboards.find((item) => item.name === shortcut.target);
    return dashboard
      ? [{
          name: shortcut.name,
          label: shortcut.label ?? dashboard.label ?? dashboard.name,
          ...(shortcut.description === undefined ? {} : { description: shortcut.description }),
          kind: shortcut.kind,
          href: `/desk/dashboards/${encodeURIComponent(dashboard.name)}`
        }]
      : [];
  }
  if (shortcut.kind === "kanban") {
    const kanban = kanbans.find((item) => item.name === shortcut.target);
    return kanban
      ? [{
          name: shortcut.name,
          label: shortcut.label ?? kanban.label ?? kanban.name,
          ...(shortcut.description === undefined ? {} : { description: shortcut.description }),
          kind: shortcut.kind,
          href: `/desk/kanbans/${encodeURIComponent(kanban.name)}`
        }]
      : [];
  }
  if (shortcut.kind === "calendar") {
    const calendar = calendars.find((item) => item.name === shortcut.target);
    return calendar
      ? [{
          name: shortcut.name,
          label: shortcut.label ?? calendar.label ?? calendar.name,
          ...(shortcut.description === undefined ? {} : { description: shortcut.description }),
          kind: shortcut.kind,
          href: `/desk/calendars/${encodeURIComponent(calendar.name)}`
        }]
      : [];
  }
  if (shortcut.kind === "file") {
    return options.files === undefined ? [] : [workspaceShortcutView(shortcut, "Files", "/desk/files")];
  }
  if (shortcut.kind === "notifications") {
    return options.notifications === undefined ? [] : [workspaceShortcutView(shortcut, "Inbox", "/desk/notifications")];
  }
  if (shortcut.kind === "admin") {
    const link = adminLinks.find((item) => item.id === shortcut.target);
    return link === undefined ? [] : [workspaceShortcutView(shortcut, link.label, link.href)];
  }
  return [workspaceShortcutView(shortcut, shortcut.label ?? shortcut.name, shortcut.href ?? "/desk")];
}

function workspaceShortcutView(
  shortcut: WorkspaceShortcutDefinition,
  fallbackLabel: string,
  href: string
): WorkspaceShortcutView {
  return {
    name: shortcut.name,
    label: shortcut.label ?? fallbackLabel,
    ...(shortcut.description === undefined ? {} : { description: shortcut.description }),
    kind: shortcut.kind,
    href
  };
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

function requireCustomFields(options: DeskAppOptions): CustomFieldService {
  if (!options.customFields) {
    throw new FrameworkError("DOCUMENT_NOT_FOUND", "Custom fields are not enabled", { status: 404 });
  }
  return options.customFields;
}

function requireFieldProperties(options: DeskAppOptions): FieldPropertyService {
  if (!options.fieldProperties) {
    throw new FrameworkError("DOCUMENT_NOT_FOUND", "Field properties are not enabled", { status: 404 });
  }
  return options.fieldProperties;
}

function requireWorkflows(options: DeskAppOptions): WorkflowService {
  if (!options.workflows) {
    throw new FrameworkError("DOCUMENT_NOT_FOUND", "Workflows are not enabled", { status: 404 });
  }
  return options.workflows;
}

function requireNotificationRules(options: DeskAppOptions): NotificationRuleService {
  if (!options.notificationRules) {
    throw new FrameworkError("DOCUMENT_NOT_FOUND", "Notification rules are not enabled", { status: 404 });
  }
  return options.notificationRules;
}

function requireAssignmentRules(options: DeskAppOptions): AssignmentRuleService {
  if (!options.assignmentRules) {
    throw new FrameworkError("DOCUMENT_NOT_FOUND", "Assignment rules are not enabled", { status: 404 });
  }
  return options.assignmentRules;
}

function requirePrintSettings(options: DeskAppOptions): PrintSettingsService {
  if (!options.printSettings) {
    throw new FrameworkError("DOCUMENT_NOT_FOUND", "Print settings are not enabled", { status: 404 });
  }
  return options.printSettings;
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

function requireDataPatchQueue(options: DeskAppOptions): DataPatchQueuePort {
  if (!options.dataPatchQueue) {
    throw new FrameworkError("DATA_PATCH_NOT_FOUND", "Data patch queue is not enabled", { status: 404 });
  }
  return options.dataPatchQueue;
}

function requireDataPatchRollbackQueue(options: DeskAppOptions): DataPatchRollbackQueuePort {
  if (!options.dataPatchRollbackQueue) {
    throw new FrameworkError("DATA_PATCH_NOT_FOUND", "Data patch rollback queue is not enabled", { status: 404 });
  }
  return options.dataPatchRollbackQueue;
}

function requireDataPatchRollbackRetryQueue(options: DeskAppOptions): DataPatchRollbackRetryQueuePort {
  if (!options.dataPatchRollbackRetryQueue) {
    throw new FrameworkError("DATA_PATCH_NOT_FOUND", "Data patch rollback retry queue is not enabled", {
      status: 404
    });
  }
  return options.dataPatchRollbackRetryQueue;
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

function requireDashboards(options: DeskAppOptions): DashboardService {
  if (!options.dashboards) {
    throw new FrameworkError("DASHBOARD_NOT_FOUND", "Dashboards are not enabled", { status: 404 });
  }
  return options.dashboards;
}

function requireFiles(options: DeskAppOptions): FileService {
  if (!options.files) {
    throw new FrameworkError("DOCUMENT_NOT_FOUND", "Files are not enabled", { status: 404 });
  }
  return options.files;
}

function fileDashboardQueryFromUrl(url: URL): FileDashboardQuery {
  const limit = parseOptionalInteger(url.searchParams.get("limit") ?? undefined);
  const isPrivate = optionalBooleanQuery(url.searchParams.get("is_private") ?? undefined);
  return {
    ...optionalFileDashboardTextQuery("attachedToDoctype", url.searchParams.get("attached_to_doctype") ?? undefined),
    ...optionalFileDashboardTextQuery("attachedToName", url.searchParams.get("attached_to_name") ?? undefined),
    ...optionalFileDashboardTextQuery("filename", url.searchParams.get("filename") ?? undefined),
    ...optionalFileDashboardTextQuery("contentType", url.searchParams.get("content_type") ?? undefined),
    ...optionalFileDashboardTextQuery("uploadedBy", url.searchParams.get("uploaded_by") ?? undefined),
    ...optionalFileDashboardTextQuery("storageState", url.searchParams.get("storage_state") ?? undefined),
    ...optionalFileDashboardTextQuery("scanStatus", url.searchParams.get("scan_status") ?? undefined),
    ...(isPrivate === undefined ? {} : { isPrivate }),
    ...(limit === undefined ? {} : { limit })
  };
}

function safeFileDashboardQueryFromUrl(url: URL): FileDashboardQuery {
  try {
    return fileDashboardQueryFromUrl(url);
  } catch {
    return {};
  }
}

function optionalFileDashboardTextQuery<TKey extends string>(
  key: TKey,
  value: string | undefined
): { readonly [K in TKey]?: string } {
  return value === undefined ? {} : { [key]: value } as { readonly [K in TKey]: string };
}

function optionalBooleanQuery(value: string | undefined): boolean | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (value === "1" || value.toLowerCase() === "true") {
    return true;
  }
  if (value === "0" || value.toLowerCase() === "false") {
    return false;
  }
  throw new FrameworkError("BAD_REQUEST", "Expected boolean query parameter", { status: 400 });
}

function emptyFileDashboard(query: FileDashboardQuery, maxUploadBytes = 25 * 1024 * 1024): FileDashboard {
  return {
    canUpload: false,
    directUpload: false,
    maxUploadBytes,
    files: [],
    limit: query.limit === undefined || query.limit < 1 || query.limit > 200 ? 50 : query.limit,
    filters: fileDashboardFiltersFromQuery(query)
  };
}

function fileDashboardFiltersFromQuery(query: FileDashboardQuery): FileDashboard["filters"] {
  return {
    ...trimmedFileDashboardFilter("attachedToDoctype", query.attachedToDoctype),
    ...trimmedFileDashboardFilter("attachedToName", query.attachedToName),
    ...trimmedFileDashboardFilter("filename", query.filename),
    ...trimmedFileDashboardFilter("contentType", query.contentType),
    ...trimmedFileDashboardFilter("uploadedBy", query.uploadedBy),
    ...trimmedFileDashboardFilter("storageState", query.storageState),
    ...trimmedFileDashboardFilter("scanStatus", query.scanStatus),
    ...(query.isPrivate === undefined ? {} : { isPrivate: query.isPrivate })
  };
}

function trimmedFileDashboardFilter<TKey extends string>(
  key: TKey,
  value: string | undefined
): { readonly [K in TKey]?: string } {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? {} : { [key]: trimmed } as { readonly [K in TKey]: string };
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
  const dashboardQuery = safeFileDashboardQueryFromUrl(new URL(request.url));
  const dashboard = await files.dashboard(actor, dashboardQuery)
    .catch(() => emptyFileDashboard(dashboardQuery, files.maxUploadBytes));
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
  planned?:
    | { readonly kind: "apply"; readonly plan: DataPatchApplyPlan }
    | { readonly kind: "rollback"; readonly plan: DataPatchRollbackPlan },
  message?: string
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
      ...(message === undefined ? {} : { message }),
      body: renderDataPatchAdmin(dashboard, {
        ...(error === undefined ? {} : { error }),
        ...(planned === undefined ? {} : { plan: planned.plan, planKind: planned.kind }),
        queue: {
          apply: options.dataPatchQueue !== undefined,
          rollback: options.dataPatchRollbackQueue !== undefined,
          rollbackRetry: options.dataPatchRollbackRetryQueue !== undefined
        }
      })
    }),
    status
  );
}

type DataPatchQueueMessageSummary = {
  readonly jobName: string;
  readonly runId: string;
  readonly idempotencyKey: string;
};

type DataPatchQueueLabel = "data patch" | "data patch rollback" | "data patch rollback retry";

function dataPatchQueuedMessage(
  label: DataPatchQueueLabel,
  message: DataPatchQueueMessageSummary
): string {
  return `Enqueued ${label} job ${message.jobName} / ${message.runId} (${message.idempotencyKey})`;
}

function dataPatchQueuedLocation(label: DataPatchQueueLabel, message: DataPatchQueueMessageSummary): string {
  const params = new URLSearchParams({
    queued: label,
    job: message.jobName,
    run: message.runId,
    key: message.idempotencyKey
  });
  return `/desk/admin/data-patches?${params.toString()}`;
}

function jobScheduleAdminLocation(filters: DeskJobScheduleReturnFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.cron !== undefined) {
    params.set("cron", filters.cron);
  }
  if (filters.jobName !== undefined) {
    params.set("job", filters.jobName);
  }
  const query = params.toString();
  return query ? `/desk/admin/jobs/schedules?${query}` : "/desk/admin/jobs/schedules";
}

function dataPatchQueuedMessageFromUrl(url: string): string | undefined {
  const params = new URL(url).searchParams;
  const label = parseDataPatchQueueLabel(params.get("queued"));
  const jobName = boundedDataPatchNoticeParam(params.get("job"));
  const runId = boundedDataPatchNoticeParam(params.get("run"));
  const idempotencyKey = boundedDataPatchNoticeParam(params.get("key"));
  if (label === undefined || jobName === undefined || runId === undefined || idempotencyKey === undefined) {
    return undefined;
  }
  return dataPatchQueuedMessage(label, { jobName, runId, idempotencyKey });
}

function parseDataPatchQueueLabel(value: string | null): DataPatchQueueLabel | undefined {
  if (value === "data patch" || value === "data patch rollback" || value === "data patch rollback retry") {
    return value;
  }
  return undefined;
}

function boundedDataPatchNoticeParam(value: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH) {
    return undefined;
  }
  return trimmed;
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

async function renderDeskCustomFieldPage(
  options: DeskAppOptions,
  actor: Actor,
  selectedDoctype: string,
  state: Awaited<ReturnType<CustomFieldService["list"]>> | undefined,
  status = 200,
  error?: string
): Promise<Response> {
  const doctypes = options.queries.listDoctypes(actor);
  const reports = listReports(options, actor);
  return html(
    renderDeskLayoutFor(options, {
      title: "Custom Fields",
      activeAdmin: "custom-fields",
      adminLinks: adminLinksFor(options, actor),
      doctypes,
      reports,
      body: renderCustomFieldAdmin({
        doctypes,
        selectedDoctype,
        ...(state === undefined ? {} : { state }),
        ...(error === undefined ? {} : { error })
      })
    }),
    status
  );
}

async function renderDeskCustomFieldFailure(
  options: DeskAppOptions,
  actor: Actor,
  customFields: CustomFieldService,
  selectedDoctype: string,
  error: unknown
): Promise<Response> {
  if (error instanceof FrameworkError && error.status === 403) {
    throw error;
  }
  const fallbackDoctype = selectedDoctype || options.queries.listDoctypes(actor)[0]?.name || "";
  let state: Awaited<ReturnType<CustomFieldService["list"]>> | undefined;
  try {
    state = fallbackDoctype ? await customFields.list(actor, fallbackDoctype) : undefined;
  } catch (listError) {
    if (!(listError instanceof FrameworkError && listError.status === 404)) {
      throw listError;
    }
  }
  const message = error instanceof FrameworkError ? error.message : error instanceof Error ? error.message : "Request failed";
  return renderDeskCustomFieldPage(
    options,
    actor,
    fallbackDoctype,
    state,
    error instanceof FrameworkError ? error.status : 500,
    message
  );
}

async function renderDeskFieldPropertyPage(
  options: DeskAppOptions,
  actor: Actor,
  selectedDoctype: string,
  selectedField: string,
  doctype: DocTypeDefinition | undefined,
  state: Awaited<ReturnType<FieldPropertyService["list"]>> | undefined,
  status = 200,
  error?: string
): Promise<Response> {
  const doctypes = options.queries.listDoctypes(actor);
  const reports = listReports(options, actor);
  return html(
    renderDeskLayoutFor(options, {
      title: "Field Properties",
      activeAdmin: "field-properties",
      adminLinks: adminLinksFor(options, actor),
      doctypes,
      reports,
      body: renderFieldPropertyAdmin({
        doctypes,
        selectedDoctype,
        selectedField,
        ...(doctype === undefined ? {} : { doctype }),
        ...(state === undefined ? {} : { state }),
        ...(error === undefined ? {} : { error })
      })
    }),
    status
  );
}

async function renderDeskFieldPropertyFailure(
  options: DeskAppOptions,
  actor: Actor,
  fieldProperties: FieldPropertyService,
  selectedDoctype: string,
  selectedField: string,
  error: unknown
): Promise<Response> {
  if (error instanceof FrameworkError && error.status === 403) {
    throw error;
  }
  const fallbackDoctype = selectedDoctype || options.queries.listDoctypes(actor)[0]?.name || "";
  let doctype: DocTypeDefinition | undefined;
  let state: Awaited<ReturnType<FieldPropertyService["list"]>> | undefined;
  try {
    doctype = fallbackDoctype ? await options.queries.getEffectiveMeta(actor, fallbackDoctype) : undefined;
    state = fallbackDoctype ? await fieldProperties.list(actor, fallbackDoctype) : undefined;
  } catch (listError) {
    if (!(listError instanceof FrameworkError && listError.status === 404)) {
      throw listError;
    }
  }
  const fallbackField = selectedField || doctype?.fields[0]?.name || "";
  const message = error instanceof FrameworkError ? error.message : error instanceof Error ? error.message : "Request failed";
  return renderDeskFieldPropertyPage(
    options,
    actor,
    fallbackDoctype,
    fallbackField,
    doctype,
    state,
    error instanceof FrameworkError ? error.status : 500,
    message
  );
}

async function renderDeskWorkflowPage(
  options: DeskAppOptions,
  actor: Actor,
  selectedDoctype: string,
  state: Awaited<ReturnType<WorkflowService["list"]>> | undefined,
  status = 200,
  error?: string
): Promise<Response> {
  const doctypes = options.queries.listDoctypes(actor);
  const reports = listReports(options, actor);
  return html(
    renderDeskLayoutFor(options, {
      title: "Workflows",
      activeAdmin: "workflows",
      adminLinks: adminLinksFor(options, actor),
      doctypes,
      reports,
      body: renderWorkflowAdmin({
        doctypes,
        selectedDoctype,
        ...(state === undefined ? {} : { state }),
        ...(error === undefined ? {} : { error })
      })
    }),
    status
  );
}

async function renderDeskWorkflowFailure(
  options: DeskAppOptions,
  actor: Actor,
  workflows: WorkflowService,
  selectedDoctype: string,
  error: unknown
): Promise<Response> {
  if (error instanceof FrameworkError && error.status === 403) {
    throw error;
  }
  const fallbackDoctype = selectedDoctype || options.queries.listDoctypes(actor)[0]?.name || "";
  let state: Awaited<ReturnType<WorkflowService["list"]>> | undefined;
  try {
    state = fallbackDoctype ? await workflows.list(actor, fallbackDoctype) : undefined;
  } catch (listError) {
    if (!(listError instanceof FrameworkError && listError.status === 404)) {
      throw listError;
    }
  }
  const message = error instanceof FrameworkError ? error.message : error instanceof Error ? error.message : "Request failed";
  return renderDeskWorkflowPage(
    options,
    actor,
    fallbackDoctype,
    state,
    error instanceof FrameworkError ? error.status : 500,
    message
  );
}

async function renderDeskNotificationRulePage(
  options: DeskAppOptions,
  actor: Actor,
  selectedDoctype: string,
  state: Awaited<ReturnType<NotificationRuleService["list"]>> | undefined,
  status = 200,
  error?: string,
  selectedRuleName?: string
): Promise<Response> {
  const doctypes = options.queries.listDoctypes(actor);
  const reports = listReports(options, actor);
  return html(
    renderDeskLayoutFor(options, {
      title: "Notification Rules",
      activeAdmin: "notification-rules",
      adminLinks: adminLinksFor(options, actor),
      doctypes,
      reports,
      body: renderNotificationRuleAdmin({
        doctypes,
        selectedDoctype,
        ...(selectedRuleName === undefined ? {} : { selectedRuleName }),
        ...(state === undefined ? {} : { state }),
        ...(error === undefined ? {} : { error })
      })
    }),
    status
  );
}

async function renderDeskNotificationRuleFailure(
  options: DeskAppOptions,
  actor: Actor,
  notificationRules: NotificationRuleService,
  selectedDoctype: string,
  error: unknown
): Promise<Response> {
  if (error instanceof FrameworkError && error.status === 403) {
    throw error;
  }
  const fallbackDoctype = selectedDoctype || options.queries.listDoctypes(actor)[0]?.name || "";
  let state: Awaited<ReturnType<NotificationRuleService["list"]>> | undefined;
  try {
    state = fallbackDoctype ? await notificationRules.list(actor, fallbackDoctype) : undefined;
  } catch (listError) {
    if (!(listError instanceof FrameworkError && listError.status === 404)) {
      throw listError;
    }
  }
  const message = error instanceof FrameworkError ? error.message : error instanceof Error ? error.message : "Request failed";
  return renderDeskNotificationRulePage(
    options,
    actor,
    fallbackDoctype,
    state,
    error instanceof FrameworkError ? error.status : 500,
    message
  );
}

async function saveDeskNotificationRuleStatus(options: {
  readonly notificationRules: NotificationRuleService;
  readonly actor: Actor;
  readonly doctype: string;
  readonly ruleName: string;
  readonly enabled: boolean;
  readonly expectedVersion?: number;
  readonly metadata: DocumentData;
}): Promise<void> {
  const state = await options.notificationRules.list(options.actor, options.doctype);
  if (options.expectedVersion !== undefined && state.version !== options.expectedVersion) {
    throw conflict(`Expected notification rules at version ${options.expectedVersion}, found ${state.version}`);
  }
  const entry = state.rules.find((item) => item.rule.name === options.ruleName);
  if (entry === undefined) {
    throw new FrameworkError(
      "DOCUMENT_NOT_FOUND",
      `Notification rule '${options.ruleName}' was not found`,
      { status: 404 }
    );
  }
  await options.notificationRules.save({
    actor: options.actor,
    doctype: options.doctype,
    rule: {
      ...entry.rule,
      enabled: options.enabled
    },
    ...(options.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
    metadata: options.metadata
  });
}

async function renderDeskAssignmentRulePage(
  options: DeskAppOptions,
  actor: Actor,
  selectedDoctype: string,
  state: Awaited<ReturnType<AssignmentRuleService["list"]>> | undefined,
  status = 200,
  error?: string,
  selectedRuleName?: string
): Promise<Response> {
  const doctypes = options.queries.listDoctypes(actor);
  const reports = listReports(options, actor);
  return html(
    renderDeskLayoutFor(options, {
      title: "Assignment Rules",
      activeAdmin: "assignment-rules",
      adminLinks: adminLinksFor(options, actor),
      doctypes,
      reports,
      body: renderAssignmentRuleAdmin({
        doctypes,
        selectedDoctype,
        ...(selectedRuleName === undefined ? {} : { selectedRuleName }),
        ...(state === undefined ? {} : { state }),
        ...(error === undefined ? {} : { error })
      })
    }),
    status
  );
}

async function renderDeskAssignmentRuleFailure(
  options: DeskAppOptions,
  actor: Actor,
  assignmentRules: AssignmentRuleService,
  selectedDoctype: string,
  error: unknown
): Promise<Response> {
  if (error instanceof FrameworkError && error.status === 403) {
    throw error;
  }
  const fallbackDoctype = selectedDoctype || options.queries.listDoctypes(actor)[0]?.name || "";
  let state: Awaited<ReturnType<AssignmentRuleService["list"]>> | undefined;
  try {
    state = fallbackDoctype ? await assignmentRules.list(actor, fallbackDoctype) : undefined;
  } catch (listError) {
    if (!(listError instanceof FrameworkError && listError.status === 404)) {
      throw listError;
    }
  }
  const message = error instanceof FrameworkError ? error.message : error instanceof Error ? error.message : "Request failed";
  return renderDeskAssignmentRulePage(
    options,
    actor,
    fallbackDoctype,
    state,
    error instanceof FrameworkError ? error.status : 500,
    message
  );
}

async function renderDeskPrintSettingsPage(
  options: DeskAppOptions,
  actor: Actor,
  state: Awaited<ReturnType<PrintSettingsService["get"]>>,
  status = 200,
  error?: string
): Promise<Response> {
  const doctypes = options.queries.listDoctypes(actor);
  const reports = listReports(options, actor);
  return html(
    renderDeskLayoutFor(options, {
      title: "Print Settings",
      activeAdmin: "print-settings",
      adminLinks: adminLinksFor(options, actor),
      doctypes,
      reports,
      body: renderPrintSettingsAdmin(state, error === undefined ? {} : { error })
    }),
    status
  );
}

async function renderDeskPrintSettingsFailure(
  options: DeskAppOptions,
  actor: Actor,
  printSettings: PrintSettingsService,
  error: unknown
): Promise<Response> {
  if (error instanceof FrameworkError && error.status === 403) {
    throw error;
  }
  const state = await printSettings.get(actor);
  const message = error instanceof FrameworkError ? error.message : error instanceof Error ? error.message : "Request failed";
  return renderDeskPrintSettingsPage(
    options,
    actor,
    state,
    error instanceof FrameworkError ? error.status : 500,
    message
  );
}

function customFieldAdminHref(doctype: string): string {
  return `/desk/admin/custom-fields?doctype=${encodeURIComponent(doctype)}`;
}

function fieldPropertyAdminHref(doctype: string, fieldName: string): string {
  return `/desk/admin/field-properties?doctype=${encodeURIComponent(doctype)}&field=${encodeURIComponent(fieldName)}`;
}

function workflowAdminHref(doctype: string): string {
  return `/desk/admin/workflows?doctype=${encodeURIComponent(doctype)}`;
}

function notificationRuleAdminHref(doctype: string, ruleName?: string): string {
  const base = `/desk/admin/notification-rules?doctype=${encodeURIComponent(doctype)}`;
  return ruleName === undefined ? base : `${base}&rule=${encodeURIComponent(ruleName)}`;
}

function assignmentRuleAdminHref(doctype: string, ruleName?: string): string {
  const base = `/desk/admin/assignment-rules?doctype=${encodeURIComponent(doctype)}`;
  return ruleName === undefined ? base : `${base}&rule=${encodeURIComponent(ruleName)}`;
}

async function renderDeskDocumentPage(
  options: DeskAppOptions,
  actor: Actor,
  doctype: DocTypeDefinition,
  name: string,
  result: { readonly attachmentError?: string; readonly status?: number } = {}
): Promise<Response> {
  const doctypes = await listDeskDoctypes(options, actor);
  const reports = listReports(options, actor);
  const printFormats = listPrintFormats(options, actor, doctype.name);
  const formView = await options.queries.getEffectiveFormView(actor, doctype.name);
  const document = await options.queries.getDocument(actor, doctype.name, name);
  const tableDefinitions = await tableDefinitionsForForm(options, actor, doctype, formView);
  const linkOptions = await linkOptionsForForm(options, actor, doctype, formView, tableDefinitions);
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
  const canUpdate = await options.queries.canActOnDocument(actor, doctype, "update", document);
  const form = renderFormView(doctype, formView, {
    mode: "update",
    document,
    linkOptions,
    tableDefinitions,
    lifecycleActions,
    workflowActions,
    domainCommands: await domainCommandActionsFor(options, actor, doctype, document),
    printFormats,
    printPdfEnabled: options.printPdfRenderer !== undefined,
    clientScripts: options.registry.listClientScripts(doctype.name, "form"),
    canUpdate,
    canDuplicate: can(actor, doctype, "create"),
    canAmend: document.docstatus === "cancelled" && can(actor, doctype, "create"),
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

function listBulkActionsFor(
  actor: Actor,
  doctype: DocTypeDefinition,
  documents: readonly DocumentSnapshot[]
): readonly ListBulkAction[] {
  const base = `/desk/${encodeURIComponent(doctype.name)}`;
  const actions: ListBulkAction[] = [];
  const deleteNames = documents
    .filter((document) =>
      can(actor, doctype, "delete", document) && (document.docstatus === "draft" || document.docstatus === "cancelled")
    )
    .map((document) => document.name);
  if (deleteNames.length > 0) {
    actions.push({
      id: "delete",
      label: "Delete selected",
      action: `${base}/bulk-delete`,
      variant: "danger",
      names: deleteNames
    });
  }
  if (!doctype.workflow) {
    const submitNames = documents
      .filter((document) => document.docstatus === "draft" && can(actor, doctype, "submit", document))
      .map((document) => document.name);
    if (submitNames.length > 0) {
      actions.push({
        id: "submit",
        label: "Submit selected",
        action: `${base}/bulk-submit`,
        names: submitNames
      });
    }
    const cancelNames = documents
      .filter((document) => document.docstatus === "submitted" && can(actor, doctype, "cancel", document))
      .map((document) => document.name);
    if (cancelNames.length > 0) {
      actions.push({
        id: "cancel",
        label: "Cancel selected",
        action: `${base}/bulk-cancel`,
        names: cancelNames
      });
    }
  }
  for (const action of listBulkWorkflowActions(actor, doctype, documents, base)) {
    actions.push(action);
  }
  return actions;
}

function listBulkWorkflowActions(
  actor: Actor,
  doctype: DocTypeDefinition,
  documents: readonly DocumentSnapshot[],
  base: string
): readonly ListBulkAction[] {
  const workflow = doctype.workflow;
  if (!workflow) {
    return [];
  }
  const actions = new Map<string, string[]>();
  for (const document of documents) {
    if (document.docstatus !== "draft" || !can(actor, doctype, "transition", document)) {
      continue;
    }
    for (const transition of allowedWorkflowTransitions({ actor, workflow, document })) {
      const names = actions.get(transition.action) ?? [];
      names.push(document.name);
      actions.set(transition.action, names);
    }
  }
  return [...actions.entries()].map(([action, names]) => ({
    id: `transition:${action}`,
    label: `${capitalizeAction(action)} selected`,
    action: `${base}/bulk-transition/${encodeURIComponent(action)}`,
    names
  }));
}

function capitalizeAction(action: string): string {
  return action.length === 0 ? action : `${action.charAt(0).toUpperCase()}${action.slice(1)}`;
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

async function domainCommandActionsFor(
  options: DeskAppOptions,
  actor: Actor,
  doctype: DocTypeDefinition,
  document: DocumentSnapshot
): Promise<readonly FormDomainCommandAction[]> {
  const actions = await Promise.all(
    (doctype.commands ?? []).map(async (command): Promise<FormDomainCommandAction | undefined> => {
      if (command.internal) {
        return undefined;
      }
      const roleAllowed = command.roles === undefined || command.roles.some((role) => actor.roles.includes(role));
      if (!roleAllowed) {
        return undefined;
      }
      const permissionAction = command.permissionAction ?? "update";
      return await options.queries.canActOnDocument(actor, doctype, permissionAction, document)
        ? { name: command.name }
        : undefined;
    })
  );
  return actions.filter((action): action is FormDomainCommandAction => action !== undefined);
}

async function linkOptionsForForm(
  options: DeskAppOptions,
  actor: Actor,
  doctype: DocTypeDefinition,
  formView: ResolvedFormView,
  tableDefinitions: FormTableDefinitions
): Promise<FormLinkOptions> {
  const entries = await Promise.all(
    linkOptionLoadersForFields(options, actor, doctype, formView.fields, tableDefinitions).map((load) => load())
  );
  return Object.fromEntries(entries) as FormLinkOptions;
}

function linkOptionLoadersForFields(
  options: DeskAppOptions,
  actor: Actor,
  doctype: DocTypeDefinition,
  fields: readonly FieldDefinition[],
  tableDefinitions: FormTableDefinitions,
  pathPrefix = ""
): readonly (() => Promise<readonly [string, readonly LinkOption[]]>)[] {
  return fields.flatMap((field) => {
    const path = pathPrefix ? `${pathPrefix}.${field.name}` : field.name;
    if (field.type === "link") {
      return [
        async () => {
          const result = await options.queries.listLinkOptionsForField(actor, doctype, field.name);
          return [path, result.options] as const;
        }
      ];
    }
    if (field.type === "table" && field.tableOf) {
      const child = tableDefinitions[path];
      return child ? linkOptionLoadersForFields(options, actor, child, child.fields, tableDefinitions, path) : [];
    }
    return [];
  });
}

async function tableDefinitionsForForm(
  options: DeskAppOptions,
  actor: Actor,
  doctype: DocTypeDefinition,
  formView: ResolvedFormView
): Promise<FormTableDefinitions> {
  const nestedEntries = await Promise.all(
    formView.fields.map((field) => tableDefinitionEntriesForField(options, actor, field, field.name, [doctype.name]))
  );
  const entries = nestedEntries.flat();
  return Object.fromEntries(entries) as FormTableDefinitions;
}

async function tableDefinitionEntriesForField(
  options: DeskAppOptions,
  actor: Actor,
  field: FieldDefinition,
  path: string,
  visitedDoctypes: readonly string[]
): Promise<readonly (readonly [string, DocTypeDefinition])[]> {
  if (field.type !== "table" || !field.tableOf) {
    return [];
  }
  const child = await options.queries.resolveEffectiveDocType(actor, field.tableOf);
  if (visitedDoctypes.includes(child.name)) {
    return [[path, child] as const];
  }
  const nested = await Promise.all(
    child.fields.map((childField) =>
      tableDefinitionEntriesForField(options, actor, childField, `${path}.${childField.name}`, [
        ...visitedDoctypes,
        child.name
      ])
    )
  );
  return [[path, child] as const, ...nested.flat()];
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
  readonly filterExpression?: ListFilterExpression;
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

interface ParsedDeskSyncAuthProviderAccount {
  readonly userId: string;
  readonly provider: string;
  readonly subject: string;
  readonly email?: string;
  readonly roles: readonly string[];
  readonly enabled?: boolean;
  readonly emailVerified?: boolean;
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

interface ParsedDeskCustomField {
  readonly doctype: string;
  readonly field: FieldDefinition;
  readonly expectedVersion?: number;
}

interface ParsedDeskCustomFieldDisable {
  readonly expectedVersion?: number;
}

interface ParsedDeskFieldPropertyOverride {
  readonly doctype: string;
  readonly fieldName: string;
  readonly overrides: FieldPropertyOverrides;
  readonly expectedVersion?: number;
}

interface ParsedDeskFieldPropertyOverrideClear {
  readonly expectedVersion?: number;
}

interface ParsedDeskWorkflow {
  readonly doctype: string;
  readonly workflow: WorkflowDefinition;
  readonly expectedVersion?: number;
}

interface ParsedDeskWorkflowClear {
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

interface ParsedDeskBulkFileDelete {
  readonly files: readonly {
    readonly name: string;
    readonly expectedVersion?: number;
  }[];
}

interface ParsedDeskBulkFileMetadata extends ParsedDeskBulkFileDelete {
  readonly isPrivate?: boolean;
  readonly attachedTo?: UpdateFileMetadataCommand["attachedTo"];
}

interface ParsedDeskBulkDocumentAction {
  readonly documents: readonly {
    readonly name: string;
    readonly expectedVersion?: number;
  }[];
  readonly returnUrl?: URL;
}

interface ParsedDeskDataPatchApply {
  readonly limit?: number;
}

type ParsedDeskDataPatchQueue = DataPatchQueueOptions & DataPatchRollbackQueueOptions;
type ParsedDeskDataPatchQueueDelivery = DataPatchRollbackRetryQueueOptions;

interface ParsedDeskJobScheduleDefinition {
  readonly id?: string;
  readonly cron: string;
  readonly jobName: string;
  readonly enabled: boolean;
  readonly delaySeconds?: number;
}

interface DeskJobScheduleReturnFilters {
  readonly cron?: string;
  readonly jobName?: string;
}

interface ParsedDeskJobScheduleForm {
  readonly definition: ParsedDeskJobScheduleDefinition;
  readonly returnFilters: DeskJobScheduleReturnFilters;
}

interface ParsedDeskJobSchedulePauseForm {
  readonly pausedUntil: string;
  readonly returnFilters: DeskJobScheduleReturnFilters;
}

async function parseDeskJobScheduleForm(request: Request): Promise<ParsedDeskJobScheduleForm> {
  const form = await readUrlEncodedDeskForm(request);
  return {
    definition: parseDeskJobScheduleDefinition(form),
    returnFilters: deskJobScheduleReturnFilters(form)
  };
}

async function parseDeskJobSchedulePauseForm(request: Request): Promise<ParsedDeskJobSchedulePauseForm> {
  const form = await readUrlEncodedDeskForm(request);
  const pausedUntil = stringSearchParamValue(form, "pauseUntil");
  if (pausedUntil === undefined) {
    throw new FrameworkError("BAD_REQUEST", "pauseUntil is required", { status: 400 });
  }
  return {
    pausedUntil,
    returnFilters: deskJobScheduleReturnFilters(form)
  };
}

async function parseDeskJobScheduleReturnFilters(request: Request): Promise<DeskJobScheduleReturnFilters> {
  return deskJobScheduleReturnFilters(await readUrlEncodedDeskForm(request));
}

function parseDeskJobScheduleDefinition(form: URLSearchParams): ParsedDeskJobScheduleDefinition {
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
  if (
    parsedDelay !== undefined &&
    (!Number.isInteger(parsedDelay) || parsedDelay < 0 || parsedDelay > MAX_JOB_QUEUE_DELAY_SECONDS)
  ) {
    throw new FrameworkError(
      "BAD_REQUEST",
      `delaySeconds must be an integer between 0 and ${MAX_JOB_QUEUE_DELAY_SECONDS}`,
      {
        status: 400
      }
    );
  }
  return {
    ...(id === undefined ? {} : { id }),
    cron,
    jobName,
    enabled: form.get("enabled") !== null,
    ...(parsedDelay === undefined ? {} : { delaySeconds: parsedDelay })
  };
}

function deskJobScheduleReturnFilters(form: URLSearchParams): DeskJobScheduleReturnFilters {
  const cron = stringSearchParamValue(form, "returnCron");
  const jobName = stringSearchParamValue(form, "returnJob");
  return {
    ...(cron === undefined ? {} : { cron }),
    ...(jobName === undefined ? {} : { jobName })
  };
}

async function parseDeskDataPatchApply(request: Request): Promise<ParsedDeskDataPatchApply> {
  const form = await readUrlEncodedDeskForm(request);
  return parseDeskDataPatchApplyForm(form);
}

async function parseDeskDataPatchQueue(request: Request): Promise<ParsedDeskDataPatchQueue> {
  const form = await readUrlEncodedDeskForm(request);
  const apply = parseDeskDataPatchApplyForm(form);
  const delivery = parseDeskDataPatchQueueDeliveryForm(form);
  return {
    ...apply,
    ...delivery
  };
}

async function parseDeskDataPatchQueueDelivery(request: Request): Promise<ParsedDeskDataPatchQueueDelivery> {
  return parseDeskDataPatchQueueDeliveryForm(await readUrlEncodedDeskForm(request));
}

function parseDeskDataPatchQueueDeliveryForm(form: URLSearchParams): ParsedDeskDataPatchQueueDelivery {
  const idempotencyKey = stringSearchParamValue(form, "idempotencyKey");
  const delay = stringSearchParamValue(form, "delaySeconds");
  const delaySeconds = delay === undefined ? undefined : Number(delay);
  if (
    delaySeconds !== undefined &&
    (!Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > MAX_JOB_QUEUE_DELAY_SECONDS)
  ) {
    throw new FrameworkError(
      "BAD_REQUEST",
      `Data patch enqueue delaySeconds must be an integer between 0 and ${MAX_JOB_QUEUE_DELAY_SECONDS}`,
      {
        status: 400
      }
    );
  }
  if (idempotencyKey !== undefined && idempotencyKey.length > MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH) {
    throw new FrameworkError(
      "BAD_REQUEST",
      `Data patch enqueue idempotencyKey must be at most ${MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH} characters`,
      {
        status: 400
      }
    );
  }
  return {
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(delaySeconds === undefined ? {} : { delaySeconds })
  };
}

function parseDeskDataPatchApplyForm(form: URLSearchParams): ParsedDeskDataPatchApply {
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

async function parseDeskBulkFileDelete(request: Request): Promise<ParsedDeskBulkFileDelete> {
  const form = await readUrlEncodedDeskForm(request);
  return {
    files: form.getAll("file").map((name) => ({
      name,
      ...deskBulkExpectedVersion(form, name)
    }))
  };
}

async function parseDeskBulkFileMetadata(request: Request): Promise<ParsedDeskBulkFileMetadata> {
  const form = await readUrlEncodedDeskForm(request);
  const isPrivate = optionalBooleanSearchParamValue(form, "bulk_is_private", "bulk_is_private");
  const clearAttachment = form.get("bulk_clear_attachment") !== null;
  const attachedToDoctype = stringSearchParamValue(form, "bulk_attached_to_doctype");
  const attachedToName = stringSearchParamValue(form, "bulk_attached_to_name");
  if (clearAttachment && (attachedToDoctype !== undefined || attachedToName !== undefined)) {
    throw new FrameworkError("BAD_REQUEST", "Clear attachment cannot be combined with attachment fields", {
      status: 400
    });
  }
  if (
    (attachedToDoctype !== undefined && attachedToName === undefined) ||
    (attachedToDoctype === undefined && attachedToName !== undefined)
  ) {
    throw new FrameworkError(
      "BAD_REQUEST",
      "bulk_attached_to_doctype and bulk_attached_to_name must be provided together",
      { status: 400 }
    );
  }
  const attachedTo = clearAttachment
    ? null
    : attachedToDoctype !== undefined && attachedToName !== undefined
      ? { doctype: attachedToDoctype, name: attachedToName }
      : undefined;
  if (isPrivate === undefined && attachedTo === undefined) {
    throw new FrameworkError("BAD_REQUEST", "At least one file metadata field must be provided", { status: 400 });
  }
  return {
    files: form.getAll("file").map((name) => ({
      name,
      ...deskBulkExpectedVersion(form, name)
    })),
    ...(isPrivate === undefined ? {} : { isPrivate }),
    ...(attachedTo === undefined ? {} : { attachedTo })
  };
}

async function parseDeskBulkDocumentAction(request: Request, doctypeName: string): Promise<ParsedDeskBulkDocumentAction> {
  const form = await readUrlEncodedDeskForm(request);
  const returnUrl = deskListReturnUrl(
    form.get("returnTo") ?? undefined,
    request.url,
    doctypeName,
    "Desk bulk action returnTo must target the current Desk list"
  );
  return {
    ...(returnUrl === undefined ? {} : { returnUrl }),
    documents: form.getAll("document").map((name) => ({
      name,
      ...deskBulkExpectedVersion(form, name)
    }))
  };
}

async function parseDeskCsvImport(request: Request, doctypeName: string): Promise<ParsedDeskCsvImport> {
  const form = await readUrlEncodedDeskForm(request);
  const csv = form.get("csv");
  if (typeof csv !== "string" || csv.trim() === "") {
    throw new FrameworkError("BAD_REQUEST", "CSV import content is required", { status: 400 });
  }
  const mode = deskCsvImportMode(form.get("mode") ?? undefined);
  const returnUrl = deskCsvImportReturnUrl(form.get("returnTo") ?? undefined, request.url, doctypeName);
  return {
    ...(mode === undefined ? {} : { mode }),
    ...(returnUrl === undefined ? {} : { returnUrl }),
    csv
  };
}

function deskCsvImportReturnUrl(value: string | undefined, requestUrl: string, doctypeName: string): URL | undefined {
  return deskListReturnUrl(value, requestUrl, doctypeName, "CSV import returnTo must target the current Desk list");
}

function deskListReturnUrl(
  value: string | undefined,
  requestUrl: string,
  doctypeName: string,
  failureMessage: string
): URL | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const base = new URL(requestUrl);
  let url: URL;
  try {
    url = new URL(value, base);
  } catch (_error) {
    throw new FrameworkError("BAD_REQUEST", failureMessage, { status: 400 });
  }
  const expectedPath = `/desk/${encodeURIComponent(doctypeName)}`;
  if (url.origin !== base.origin || url.pathname !== expectedPath) {
    throw new FrameworkError("BAD_REQUEST", failureMessage, { status: 400 });
  }
  return url;
}

function deskListRedirectUrl(requestUrl: string, doctypeName: string, returnUrl: URL | undefined): string {
  return returnUrl === undefined
    ? new URL(`/desk/${encodeURIComponent(doctypeName)}`, requestUrl).pathname
    : `${returnUrl.pathname}${returnUrl.search}`;
}

function deskCsvImportMode(value: string | undefined): DocumentImportMode | undefined {
  if (value === undefined || value === "" || value === "create") {
    return undefined;
  }
  if (value === "update") {
    return "update";
  }
  throw new FrameworkError("BAD_REQUEST", "CSV import mode must be create or update", { status: 400 });
}

function deskBulkExpectedVersion(form: URLSearchParams, name: string): { readonly expectedVersion?: number } {
  const raw = stringSearchParamValue(form, `expectedVersion:${name}`);
  if (raw === undefined) {
    return {};
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new FrameworkError("BAD_REQUEST", "expectedVersion must be an integer", { status: 400 });
  }
  return { expectedVersion: parsed };
}

function bulkFileDeleteFailureMessage(count: number): string {
  return count === 1 ? "1 file could not be deleted" : `${String(count)} files could not be deleted`;
}

function bulkFileMetadataFailureMessage(count: number): string {
  return count === 1 ? "1 file metadata update failed" : `${String(count)} file metadata updates failed`;
}

function bulkDocumentDeleteFailureMessage(count: number): string {
  return count === 1 ? "1 document could not be deleted" : `${String(count)} documents could not be deleted`;
}

function bulkDocumentActionFailureMessage(count: number, action: string): string {
  return count === 1
    ? `1 document could not be ${action}`
    : `${String(count)} documents could not be ${action}`;
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

async function parseDeskSavedFilter(
  request: Request,
  doctype: DocTypeDefinition
): Promise<ParsedDeskSavedFilter> {
  const form = await request.formData();
  const label = form.get("saved_filter_label");
  const params = new URLSearchParams();
  form.forEach((value, key) => {
    if (typeof value === "string") {
      params.append(key, value);
    }
  });
  const url = new URL(`https://desk.local/?${params.toString()}`);
  const filterExpression = listFilterExpressionFromUrl(url);
  return {
    label: typeof label === "string" ? label : "",
    filters: listFiltersFromUrl(url, {
      fields: listFilterParseFields(doctype)
    }),
    ...(filterExpression === undefined ? {} : { filterExpression })
  };
}

function listFilterParseFields(doctype: DocTypeDefinition): readonly string[] {
  return doctype.fields.map((field) => field.name);
}

async function parseDeskSavedReport(
  request: Request,
  doctype: DocTypeDefinition
): Promise<ParsedDeskSavedReport> {
  const form = await readUrlEncodedDeskForm(request);
  const fields = new Map(doctype.fields.map((field) => [field.name, field]));
  const columnNames = uniqueFormValues(form, "column");
  const filterNames = uniqueFormValues(form, "filter");
  const filterRangeMinNames = uniqueFormValues(form, "filterRangeMin");
  const filterRangeMaxNames = uniqueFormValues(form, "filterRangeMax");
  const summaryNames = uniqueFormValues(form, "summary");
  const formulaColumn = reportFormulaColumnFor(fields, form);
  const columns = [
    ...columnNames.map((name) => reportColumnFor(fields, name)),
    ...(formulaColumn === undefined ? [] : [formulaColumn])
  ];
  const filters: NonNullable<SavedReportDefinition["filters"]>[number][] = [];
  const usedFilterNames = new Set<string>();
  for (const name of filterNames) {
    const filter = reportFilterFor(fields, form, name);
    filters.push(filter);
    usedFilterNames.add(filter.name);
  }
  for (const name of filterRangeMinNames) {
    const filter = reportRangeFilterFor(fields, form, name, "min", usedFilterNames);
    filters.push(filter);
    usedFilterNames.add(filter.name);
  }
  for (const name of filterRangeMaxNames) {
    const filter = reportRangeFilterFor(fields, form, name, "max", usedFilterNames);
    filters.push(filter);
    usedFilterNames.add(filter.name);
  }
  const filterExpression = reportFilterExpressionFor(form);
  for (const name of reportFilterExpressionFilterNames(filterExpression)) {
    if (usedFilterNames.has(name)) {
      continue;
    }
    const filter = reportFilterFor(fields, form, name);
    filters.push(filter);
    usedFilterNames.add(filter.name);
  }
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
      ...(filterExpression === undefined ? {} : { filterExpression }),
      ...(summaries.length === 0 ? {} : { summaries }),
      ...(group === undefined ? {} : { groups: [group] }),
      ...(chart === undefined ? {} : { charts: [chart] }),
      ...(orderBy && columns.some((column) => column.name === orderBy) ? { orderBy } : {}),
      ...(order === "asc" || order === "desc" ? { order } : {})
    }
  };
}

function reportFilterExpressionFor(form: URLSearchParams): ReportFilterExpression | undefined {
  const value = optionalJsonSearchParamValue(form, "filter_expression", "Report filter expression");
  return value === undefined ? undefined : reportFilterExpressionFromValue(value, "Report filter expression");
}

function reportFilterExpressionFilterNames(expression: ReportFilterExpression | undefined): readonly string[] {
  if (expression === undefined) {
    return [];
  }
  if (isReportFilterGroup(expression)) {
    return expression.filters.flatMap(reportFilterExpressionFilterNames);
  }
  return [expression.filter];
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

async function parseDeskSyncAuthProviderAccount(request: Request): Promise<ParsedDeskSyncAuthProviderAccount> {
  const form = await readUrlEncodedDeskForm(request);
  const email = stringSearchParamValue(form, "email");
  const enabled = optionalBooleanSearchParamValue(form, "enabled", "enabled");
  const emailVerified = optionalBooleanSearchParamValue(form, "emailVerified", "emailVerified");
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    userId: form.get("user") ?? "",
    provider: form.get("provider") ?? "",
    subject: form.get("subject") ?? "",
    ...(email === undefined ? {} : { email }),
    roles: commaListFormValue(form.get("roles")),
    ...(enabled === undefined ? {} : { enabled }),
    ...(emailVerified === undefined ? {} : { emailVerified }),
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

async function parseDeskCustomField(request: Request): Promise<ParsedDeskCustomField> {
  const form = await readUrlEncodedDeskForm(request);
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  const doctype = requiredSearchParamValue(form, "doctype", "DocType");
  const type = fieldTypeSearchParamValue(form, "type", "Field type");
  const options = commaListFormValue(form.get("options"));
  const label = stringSearchParamValue(form, "label");
  const description = stringSearchParamValue(form, "description");
  const linkTo = stringSearchParamValue(form, "linkTo");
  const tableOf = stringSearchParamValue(form, "tableOf");
  const min = optionalNumberSearchParamValue(form, "min", "Minimum");
  const max = optionalNumberSearchParamValue(form, "max", "Maximum");
  const defaultValue = optionalJsonSearchParamValue(form, "defaultValue", "Default value");
  return {
    doctype,
    field: {
      name: requiredSearchParamValue(form, "name", "Field name"),
      type,
      ...(label === undefined ? {} : { label }),
      ...(description === undefined ? {} : { description }),
      ...(form.has("required") ? { required: true } : {}),
      ...(form.has("readOnly") ? { readOnly: true } : {}),
      ...(form.has("hidden") ? { hidden: true } : {}),
      ...(form.has("unique") ? { unique: true } : {}),
      ...(form.has("noCopy") ? { noCopy: true } : {}),
      ...(form.has("allowOnSubmit") ? { allowOnSubmit: true } : {}),
      ...optionalStringProperty(form, "fetchFrom", "fetchFrom"),
      ...(form.has("fetchIfEmpty") ? { fetchIfEmpty: true } : {}),
      ...(form.has("inFormView") ? { inFormView: true } : {}),
      ...(form.has("inListView") ? { inListView: true } : {}),
      ...(form.has("inListFilter") ? { inListFilter: true } : {}),
      ...(options.length === 0 ? {} : { options }),
      ...(linkTo === undefined ? {} : { linkTo }),
      ...(tableOf === undefined ? {} : { tableOf }),
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max }),
      ...(defaultValue === undefined ? {} : { defaultValue })
    },
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskCustomFieldDisable(request: Request): Promise<ParsedDeskCustomFieldDisable> {
  const form = await readUrlEncodedDeskForm(request);
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskFieldPropertyOverride(request: Request): Promise<ParsedDeskFieldPropertyOverride> {
  const form = await readUrlEncodedDeskForm(request);
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  const options = commaListFormValue(form.get("options"));
  const defaultValue = optionalJsonSearchParamValue(form, "defaultValue", "Default value");
  const overrides = {
    ...optionalStringProperty(form, "label", "label"),
    ...optionalStringProperty(form, "description", "description"),
    ...optionalBooleanProperty(form, "required", "required", "Required"),
    ...optionalBooleanProperty(form, "readOnly", "readOnly", "Read only"),
    ...optionalBooleanProperty(form, "hidden", "hidden", "Hidden"),
    ...optionalBooleanProperty(form, "noCopy", "noCopy", "No copy"),
    ...optionalBooleanProperty(form, "allowOnSubmit", "allowOnSubmit", "Allow on submit"),
    ...optionalStringProperty(form, "fetchFrom", "fetchFrom"),
    ...optionalBooleanProperty(form, "fetchIfEmpty", "fetchIfEmpty", "Fetch if empty"),
    ...optionalBooleanProperty(form, "inFormView", "inFormView", "Form view"),
    ...optionalBooleanProperty(form, "inGlobalSearch", "inGlobalSearch", "Global search"),
    ...optionalBooleanProperty(form, "inListView", "inListView", "List view"),
    ...optionalBooleanProperty(form, "inListFilter", "inListFilter", "List filter"),
    ...(options.length === 0 ? {} : { options }),
    ...optionalNumberProperty(form, "min", "min", "Minimum"),
    ...optionalNumberProperty(form, "max", "max", "Maximum"),
    ...(defaultValue === undefined ? {} : { defaultValue })
  };
  return {
    doctype: requiredSearchParamValue(form, "doctype", "DocType"),
    fieldName: requiredSearchParamValue(form, "fieldName", "Field"),
    overrides,
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskFieldPropertyOverrideClear(
  request: Request
): Promise<ParsedDeskFieldPropertyOverrideClear> {
  const form = await readUrlEncodedDeskForm(request);
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskWorkflow(request: Request): Promise<ParsedDeskWorkflow> {
  const form = await readUrlEncodedDeskForm(request);
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  const stateField = stringSearchParamValue(form, "stateField");
  return {
    doctype: requiredSearchParamValue(form, "doctype", "DocType"),
    workflow: {
      ...(stateField === undefined ? {} : { stateField }),
      initialState: requiredSearchParamValue(form, "initialState", "Initial state"),
      states: workflowStatesFormValue(form.get("states")),
      transitions: workflowTransitionsFormValue(form.get("transitions"))
    },
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskWorkflowClear(request: Request): Promise<ParsedDeskWorkflowClear> {
  const form = await readUrlEncodedDeskForm(request);
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskNotificationRule(request: Request): Promise<ParsedDeskNotificationRule> {
  const form = await readUrlEncodedDeskForm(request);
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  const channels = notificationRuleChannelsFormValue(form.get("channels"));
  const condition = notificationRuleConditionFormValue(form);
  const enabled = optionalBooleanSearchParamValue(form, "enabled", "Notification rule enabled");
  const excludeActor = optionalBooleanSearchParamValue(form, "excludeActor", "Notification rule exclude actor");
  const subject = stringSearchParamValue(form, "subject");
  return {
    doctype: requiredSearchParamValue(form, "doctype", "DocType"),
    rule: {
      name: requiredSearchParamValue(form, "name", "Notification rule name"),
      ...(enabled === undefined ? {} : { enabled }),
      events: notificationRuleEventsFormValue(form.get("events")),
      recipients: notificationRuleRecipientsFormValue(form.get("recipients")),
      ...(channels.length === 0 ? {} : { channels }),
      ...(condition === undefined ? {} : { condition }),
      ...(subject === undefined ? {} : { subject }),
      ...(excludeActor === undefined ? {} : { excludeActor })
    },
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskNotificationRuleClear(request: Request): Promise<ParsedDeskNotificationRuleClear> {
  const form = await readUrlEncodedDeskForm(request);
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  return {
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskAssignmentRule(request: Request): Promise<ParsedDeskAssignmentRule> {
  const form = await readUrlEncodedDeskForm(request);
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  const condition = assignmentRuleConditionFormValue(form);
  const enabled = optionalBooleanSearchParamValue(form, "enabled", "Assignment rule enabled");
  const excludeActor = optionalBooleanSearchParamValue(form, "excludeActor", "Assignment rule exclude actor");
  return {
    doctype: requiredSearchParamValue(form, "doctype", "DocType"),
    rule: {
      name: requiredSearchParamValue(form, "name", "Assignment rule name"),
      ...(enabled === undefined ? {} : { enabled }),
      events: assignmentRuleEventsFormValue(form.get("events")),
      assignees: assignmentRuleAssigneesFormValue(form.get("assignees")),
      ...(condition === undefined ? {} : { condition }),
      ...(excludeActor === undefined ? {} : { excludeActor })
    },
    ...(expectedVersion !== undefined ? { expectedVersion } : {})
  };
}

async function parseDeskAssignmentRuleClear(request: Request): Promise<ParsedDeskAssignmentRuleClear> {
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
  tableDefinitions: FormTableDefinitions
): Promise<ParsedDeskForm> {
  const form = await request.formData();
  const fields = new Set(doctype.fields.map((field) => field.name));
  const entries = formView.fields
    .filter((field) => fields.has(field.name))
    .filter((field) => !field.hidden && !field.readOnly)
    .map((field) => {
      const child = field.type === "table" && field.tableOf ? tableDefinitions[field.name] : undefined;
      return [
        field.name,
        child
          ? coerceTableFormValue(field, child, form, tableDefinitions, field.name, field.name)
          : coerceFormValue(field, form.get(field.name))
      ] as const;
    })
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

function workflowStatesFormValue(value: string | null): readonly string[] {
  if (value === null) {
    return [];
  }
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function workflowTransitionsFormValue(value: string | null): readonly WorkflowTransition[] {
  if (value === null) {
    return [];
  }
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [action = "", from = "", to = "", roles = "", eventType = ""] = line.split("|").map((part) => part.trim());
      return {
        action,
        from,
        to,
        ...optionalWorkflowRoles(roles),
        ...(eventType === "" ? {} : { eventType })
      };
    });
}

function notificationRuleEventsFormValue(value: FormDataEntryValue | null): readonly NotificationRuleEventKind[] {
  return lineListFormValue(value) as readonly NotificationRuleEventKind[];
}

function notificationRuleChannelsFormValue(value: FormDataEntryValue | null): readonly NotificationRuleChannel[] {
  return lineListFormValue(value) as readonly NotificationRuleChannel[];
}

function notificationRuleConditionFormValue(form: URLSearchParams): ListFilterExpression | undefined {
  const value = optionalJsonSearchParamValue(form, "condition", "Notification rule condition");
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as unknown as ListFilterExpression;
  }
  throw new FrameworkError("BAD_REQUEST", "Notification rule condition must be a JSON object", { status: 400 });
}

function notificationRuleRecipientsFormValue(
  value: FormDataEntryValue | null
): readonly NotificationRuleRecipientDefinition[] {
  return lineListFormValue(value).map((line) => {
    if (line === "documentOwner") {
      return { kind: "documentOwner" };
    }
    const separator = line.indexOf(":");
    const kind = separator === -1 ? "" : line.slice(0, separator).trim();
    const target = separator === -1 ? "" : line.slice(separator + 1).trim();
    if (kind === "field" && target) {
      return { kind: "field", field: target };
    }
    if (kind === "user" && target) {
      return { kind: "user", userId: target };
    }
    throw new FrameworkError(
      "BAD_REQUEST",
      "Notification rule recipients must use field:<field>, user:<user>, or documentOwner",
      { status: 400 }
    );
  });
}

function assignmentRuleEventsFormValue(value: FormDataEntryValue | null): readonly AssignmentRuleEventKind[] {
  return lineListFormValue(value) as readonly AssignmentRuleEventKind[];
}

function assignmentRuleConditionFormValue(form: URLSearchParams): ListFilterExpression | undefined {
  const value = optionalJsonSearchParamValue(form, "condition", "Assignment rule condition");
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as unknown as ListFilterExpression;
  }
  throw new FrameworkError("BAD_REQUEST", "Assignment rule condition must be a JSON object", { status: 400 });
}

function assignmentRuleAssigneesFormValue(
  value: FormDataEntryValue | null
): readonly AssignmentRuleAssigneeDefinition[] {
  return lineListFormValue(value).map((line) => {
    const separator = line.indexOf(":");
    const kind = separator === -1 ? "" : line.slice(0, separator).trim();
    const target = separator === -1 ? "" : line.slice(separator + 1).trim();
    if (kind === "field" && target) {
      return { kind: "field", field: target };
    }
    if (kind === "user" && target) {
      return { kind: "user", userId: target };
    }
    throw new FrameworkError(
      "BAD_REQUEST",
      "Assignment rule assignees must use field:<field> or user:<user>",
      { status: 400 }
    );
  });
}

function lineListFormValue(value: FormDataEntryValue | null): readonly string[] {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalWorkflowRoles(value: string): { readonly roles?: readonly string[] } {
  const roles = commaListFormValue(value);
  return roles.length === 0 ? {} : { roles };
}

async function parseDeskExpectedVersion(request: Request): Promise<number | undefined> {
  const form = await request.formData();
  return coerceExpectedVersion(form.get("expectedVersion"));
}

async function parseDeskPrintSettings(request: Request): Promise<ParsedDeskPrintSettings> {
  const form = await readUrlEncodedDeskForm(request);
  const expectedVersion = coerceExpectedVersion(form.get("expectedVersion"));
  if (truthyDeskParam(form.get("clearDefaultLayout"))) {
    return { ...(expectedVersion === undefined ? {} : { expectedVersion }), settings: { defaultLayout: null } };
  }
  const defaultLayout = printLayoutSearchParamValue(form);
  return {
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    settings: defaultLayout === undefined ? {} : { defaultLayout }
  };
}

function printLayoutSearchParamValue(form: URLSearchParams): PrintLayoutDefinition | undefined {
  const pageSize = printPageSizeSearchParamValue(form);
  const orientation = printOrientationSearchParamValue(form);
  const margins = printMarginsSearchParamValue(form);
  const font = printFontSearchParamValue(form);
  if (pageSize === undefined && orientation === undefined && margins === undefined && font === undefined) {
    return undefined;
  }
  return {
    ...(pageSize === undefined ? {} : { pageSize }),
    ...(orientation === undefined ? {} : { orientation }),
    ...(margins === undefined ? {} : { margins }),
    ...(font === undefined ? {} : { font })
  };
}

function printPageSizeSearchParamValue(form: URLSearchParams): PrintLayoutDefinition["pageSize"] | undefined {
  const value = stringSearchParamValue(form, "pageSize");
  const widthMm = optionalNumberSearchParamValue(form, "customWidthMm", "Custom Width");
  const heightMm = optionalNumberSearchParamValue(form, "customHeightMm", "Custom Height");
  if (widthMm !== undefined || heightMm !== undefined) {
    if (widthMm === undefined || heightMm === undefined) {
      throw new FrameworkError("BAD_REQUEST", "Custom Page Size requires width and height", { status: 400 });
    }
    if (value !== undefined) {
      throw new FrameworkError("BAD_REQUEST", "Custom Page Size cannot be combined with Page Size", { status: 400 });
    }
    return { widthMm, heightMm };
  }
  if (value !== undefined && (PRINT_PAGE_SIZE_NAMES as readonly string[]).includes(value)) {
    return value as PrintPageSizeName;
  }
  if (value === undefined) {
    return undefined;
  }
  throw new FrameworkError("BAD_REQUEST", "Page Size is invalid", { status: 400 });
}

function printOrientationSearchParamValue(form: URLSearchParams): PrintPageOrientation | undefined {
  const value = stringSearchParamValue(form, "orientation");
  if (value === undefined) {
    return undefined;
  }
  if ((PRINT_PAGE_ORIENTATIONS as readonly string[]).includes(value)) {
    return value as PrintPageOrientation;
  }
  throw new FrameworkError("BAD_REQUEST", "Orientation is invalid", { status: 400 });
}

function printMarginsSearchParamValue(form: URLSearchParams): PrintLayoutDefinition["margins"] | undefined {
  const margins = {
    ...optionalPrintNumberSearchParamValue(form, "topMm", "Top Margin"),
    ...optionalPrintNumberSearchParamValue(form, "rightMm", "Right Margin"),
    ...optionalPrintNumberSearchParamValue(form, "bottomMm", "Bottom Margin"),
    ...optionalPrintNumberSearchParamValue(form, "leftMm", "Left Margin")
  };
  return Object.keys(margins).length === 0 ? undefined : margins;
}

function optionalPrintNumberSearchParamValue<TKey extends "topMm" | "rightMm" | "bottomMm" | "leftMm">(
  form: URLSearchParams,
  key: TKey,
  label: string
): { readonly [K in TKey]?: number } {
  const value = optionalNumberSearchParamValue(form, key, label);
  return value === undefined ? {} : { [key]: value } as { readonly [K in TKey]: number };
}

function printFontSearchParamValue(form: URLSearchParams): PrintLayoutDefinition["font"] | undefined {
  const family = stringSearchParamValue(form, "fontFamily");
  const sizePt = optionalNumberSearchParamValue(form, "fontSizePt", "Font Size");
  if (family === undefined && sizePt === undefined) {
    return undefined;
  }
  return {
    ...(family === undefined ? {} : { family }),
    ...(sizePt === undefined ? {} : { sizePt })
  };
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

function requiredSearchParamValue(form: URLSearchParams, key: string, label: string): string {
  const value = stringSearchParamValue(form, key);
  if (value === undefined) {
    throw new FrameworkError("BAD_REQUEST", `${label} is required`, { status: 400 });
  }
  return value;
}

function fieldTypeSearchParamValue(form: URLSearchParams, key: string, label: string): FieldType {
  const value = stringSearchParamValue(form, key);
  if (value !== undefined && (FIELD_TYPES as readonly string[]).includes(value)) {
    return value as FieldType;
  }
  throw new FrameworkError("BAD_REQUEST", `${label} is invalid`, { status: 400 });
}

function optionalNumberSearchParamValue(form: URLSearchParams, key: string, label: string): number | undefined {
  const value = stringSearchParamValue(form, key);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new FrameworkError("BAD_REQUEST", `${label} must be a number`, { status: 400 });
  }
  return parsed;
}

function optionalJsonSearchParamValue(form: URLSearchParams, key: string, label: string): JsonValue | undefined {
  const value = stringSearchParamValue(form, key);
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    throw new FrameworkError("BAD_REQUEST", `${label} must be valid JSON`, { status: 400 });
  }
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

function optionalStringProperty<TKey extends string>(
  form: URLSearchParams,
  key: string,
  outputKey: TKey
): { readonly [K in TKey]?: string } {
  const value = stringSearchParamValue(form, key);
  return value === undefined ? {} : { [outputKey]: value } as { readonly [K in TKey]: string };
}

function optionalBooleanProperty<TKey extends string>(
  form: URLSearchParams,
  key: string,
  outputKey: TKey,
  label: string
): { readonly [K in TKey]?: boolean } {
  const value = optionalBooleanSearchParamValue(form, key, label);
  return value === undefined ? {} : { [outputKey]: value } as { readonly [K in TKey]: boolean };
}

function optionalNumberProperty<TKey extends string>(
  form: URLSearchParams,
  key: string,
  outputKey: TKey,
  label: string
): { readonly [K in TKey]?: number } {
  const value = optionalNumberSearchParamValue(form, key, label);
  return value === undefined ? {} : { [outputKey]: value } as { readonly [K in TKey]: number };
}

function truthyDeskParam(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function reportColumnFor(
  fields: ReadonlyMap<string, FieldDefinition>,
  name: string
): SavedReportColumnDefinition {
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

function reportFormulaColumnFor(
  fields: ReadonlyMap<string, FieldDefinition>,
  form: URLSearchParams
): SavedReportColumnDefinition | undefined {
  const label = stringSearchParamValue(form, "formulaLabel");
  const left = reportFormulaOperandFor(fields, form, "left");
  const operator = optionalEnumSearchParamValue(
    form,
    "formulaOperator",
    REPORT_FORMULA_OPERATORS,
    "Report formula operator"
  );
  const right = reportFormulaOperandFor(fields, form, "right");
  if (label === undefined && left === undefined && operator === undefined && right === undefined) {
    return undefined;
  }
  if (label === undefined || left === undefined || operator === undefined || right === undefined) {
    throw new FrameworkError("BAD_REQUEST", "Report formula requires a label, left operand, operator, and right operand", {
      status: 400
    });
  }
  return {
    name: reportFormulaColumnName(label),
    label,
    type: "number",
    formula: { operator, left, right }
  };
}

function reportFormulaOperandFor(
  fields: ReadonlyMap<string, FieldDefinition>,
  form: URLSearchParams,
  side: "left" | "right"
): ReportFormulaOperand | undefined {
  return reportFormulaOperandAt(
    fields,
    form,
    side === "left" ? "formulaLeft" : "formulaRight",
    side,
    REPORT_FORMULA_ROOT_OPERAND_DEPTH
  );
}

function reportFormulaOperandAt(
  fields: ReadonlyMap<string, FieldDefinition>,
  form: URLSearchParams,
  key: string,
  label: string,
  nestedFormulaDepth: number
): ReportFormulaOperand | undefined {
  const literalKey = `${key}Literal`;
  const kindKey = `${key}Kind`;
  const fieldName = stringSearchParamValue(form, key);
  const literal = stringSearchParamValue(form, literalKey);
  const kind = reportFormulaOperandKindValue(stringSearchParamValue(form, kindKey), label);
  if (kind === "nested") {
    return reportNestedFormulaOperandAt(fields, form, key, label, nestedFormulaDepth);
  }
  if (fieldName === undefined && literal === undefined) {
    return undefined;
  }
  if ((kind ?? "field") === "literal") {
    if (literal === undefined) {
      throw new FrameworkError("BAD_REQUEST", `Report formula ${label} number is required`, { status: 400 });
    }
    const parsed = Number(literal);
    if (!Number.isFinite(parsed)) {
      throw new FrameworkError("BAD_REQUEST", `Report formula ${label} number must be finite`, { status: 400 });
    }
    return parsed;
  }
  if (fieldName === undefined) {
    throw new FrameworkError("BAD_REQUEST", `Report formula ${label} field is required`, { status: 400 });
  }
  assertDeskNumericFormulaField(fields, fieldName, label);
  return fieldName;
}

function reportNestedFormulaOperandAt(
  fields: ReadonlyMap<string, FieldDefinition>,
  form: URLSearchParams,
  key: string,
  label: string,
  depth: number
): ReportFormulaOperand {
  if (depth > REPORT_FORMULA_MAX_DEPTH) {
    throw new FrameworkError(
      "BAD_REQUEST",
      `Report formula ${label} exceeds maximum formula depth of ${REPORT_FORMULA_MAX_DEPTH}`,
      { status: 400 }
    );
  }
  const operator = optionalEnumSearchParamValue(
    form,
    `${key}Operator`,
    REPORT_FORMULA_OPERATORS,
    `Report formula ${label} operator`
  );
  const left = reportFormulaOperandAt(fields, form, `${key}Left`, `${label} left`, depth + 1);
  const right = reportFormulaOperandAt(fields, form, `${key}Right`, `${label} right`, depth + 1);
  if (operator === undefined || left === undefined || right === undefined) {
    throw new FrameworkError(
      "BAD_REQUEST",
      `Report formula ${label} nested formula requires an operator, left operand, and right operand`,
      { status: 400 }
    );
  }
  return { operator, left, right };
}

function reportFormulaOperandKindValue(
  value: string | undefined,
  label: string
): DeskFormulaOperandKind | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "field" || value === "literal" || value === "nested") {
    return value;
  }
  throw new FrameworkError("BAD_REQUEST", `Report formula ${label} operand type must be field, literal, or nested`, {
    status: 400
  });
}

function assertDeskNumericFormulaField(
  fields: ReadonlyMap<string, FieldDefinition>,
  name: string,
  label: string
): void {
  const field = fields.get(name);
  if (!field || field.hidden || !isDeskNumericReportField(field)) {
    throw new FrameworkError("BAD_REQUEST", `Unknown report formula ${label} field '${name}'`, { status: 400 });
  }
}

function reportFormulaColumnName(label: string): string {
  const base = label.trim().toLowerCase().replaceAll(/[^a-z0-9_]+/g, "_").replaceAll(/^_+|_+$/g, "");
  const name = base || "formula";
  return /^[a-z]/.test(name) ? name : `formula_${name}`;
}

function reportFilterFor(
  fields: ReadonlyMap<string, FieldDefinition>,
  form: URLSearchParams,
  name: string
): NonNullable<SavedReportDefinition["filters"]>[number] {
  const field = fields.get(name);
  if (!field || field.hidden || field.type === "json" || field.type === "table") {
    throw new FrameworkError("BAD_REQUEST", `Unknown report filter '${name}'`, { status: 400 });
  }
  const operator = reportFilterOperatorFor(field, form);
  const defaultValue = reportFilterDefaultValueFor(field, form);
  const required = truthyDeskParam(form.get(`filterRequired:${field.name}`));
  if (required && defaultValue === undefined) {
    throw new FrameworkError(
      "BAD_REQUEST",
      `Report filter ${field.name} default is required when the filter is required`,
      { status: 400 }
    );
  }
  return {
    name: field.name,
    label: deskReportFieldLabel(field),
    field: field.name,
    type: field.type as Exclude<FieldType, "json" | "table">,
    ...(operator === "eq" ? {} : { operator }),
    ...(defaultValue === undefined ? {} : { defaultValue }),
    ...(required ? { required } : {})
  };
}

function reportRangeFilterFor(
  fields: ReadonlyMap<string, FieldDefinition>,
  form: URLSearchParams,
  name: string,
  bound: "min" | "max",
  usedNames: ReadonlySet<string>
): NonNullable<SavedReportDefinition["filters"]>[number] {
  const field = fields.get(name);
  if (!field || field.hidden || !isDeskRangeReportField(field)) {
    throw new FrameworkError("BAD_REQUEST", `Unknown report range filter '${name}'`, { status: 400 });
  }
  const suffix = bound === "min" ? "Min" : "Max";
  const operator: ReportFilterOperator = bound === "min" ? "gte" : "lte";
  const defaultValue = reportFilterDefaultValueAt(
    field,
    form,
    `filterRange${suffix}Default:${field.name}`,
    `Report filter ${field.name} ${bound === "min" ? "from" : "to"} default`
  );
  return {
    name: uniqueReportRangeFilterName(field.name, bound, usedNames),
    label: `${deskReportFieldLabel(field)} ${bound === "min" ? "from" : "to"}`,
    field: field.name,
    type: field.type as Exclude<FieldType, "json" | "table">,
    operator,
    ...(defaultValue === undefined ? {} : { defaultValue })
  };
}

function uniqueReportRangeFilterName(fieldName: string, bound: "min" | "max", usedNames: ReadonlySet<string>): string {
  const base = `${fieldName}_${bound}`;
  if (!usedNames.has(base)) {
    return base;
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${base}_${String(index)}`;
    if (!usedNames.has(candidate)) {
      return candidate;
    }
  }
}

function reportFilterOperatorFor(field: FieldDefinition, form: URLSearchParams): ReportFilterOperator {
  return optionalEnumSearchParamValue(
    form,
    `filterOperator:${field.name}`,
    reportFilterOperatorsFor(field),
    `Report filter ${field.name} operator`
  ) ?? defaultReportFilterOperatorFor(field);
}

function reportFilterOperatorsFor(field: FieldDefinition): readonly ReportFilterOperator[] {
  if (field.type === "text" || field.type === "longText" || field.type === "link") {
    return ["contains", "eq", "ne"];
  }
  if (field.type === "integer" || field.type === "number" || field.type === "date" || field.type === "datetime") {
    return ["eq", "ne", "gte", "lte"];
  }
  return ["eq", "ne"];
}

function defaultReportFilterOperatorFor(field: FieldDefinition): ReportFilterOperator {
  return field.type === "text" || field.type === "longText" ? "contains" : "eq";
}

function isDeskRangeReportField(field: FieldDefinition): boolean {
  return field.type === "integer" || field.type === "number" || field.type === "date" || field.type === "datetime";
}

function reportFilterDefaultValueFor(field: FieldDefinition, form: URLSearchParams): JsonPrimitive | undefined {
  return reportFilterDefaultValueAt(field, form, `filterDefault:${field.name}`, `Report filter ${field.name} default`);
}

function reportFilterDefaultValueAt(
  field: FieldDefinition,
  form: URLSearchParams,
  key: string,
  label: string
): JsonPrimitive | undefined {
  const value = stringSearchParamValue(form, key);
  if (value === undefined) {
    return undefined;
  }
  if (field.type === "integer") {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      throw new FrameworkError("BAD_REQUEST", `${label} must be an integer`, { status: 400 });
    }
    return parsed;
  }
  if (field.type === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new FrameworkError("BAD_REQUEST", `${label} must be a number`, { status: 400 });
    }
    return parsed;
  }
  if (field.type === "boolean") {
    if (value === "true" || value === "1" || value === "on") {
      return true;
    }
    if (value === "false" || value === "0" || value === "off") {
      return false;
    }
    throw new FrameworkError("BAD_REQUEST", `${label} must be a boolean`, { status: 400 });
  }
  return value;
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
  const colors = reportChartPalette(form.get("chartPalette"));
  const xAxisLabel = stringSearchParamValue(form, "chartXAxisLabel");
  const yAxisLabel = stringSearchParamValue(form, "chartYAxisLabel");
  return {
    type: chartType,
    summary: stringSearchParamValue(form, "chartSummary") ?? "record_count",
    maxPoints,
    ...(colors.length === 0 ? {} : { colors }),
    showValues: optionalBooleanSearchParamValue(form, "chartShowValues", "Report chart show values") ?? true,
    ...(xAxisLabel === undefined ? {} : { xAxisLabel }),
    ...(yAxisLabel === undefined ? {} : { yAxisLabel }),
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
    ...(controls.colors === undefined ? {} : { colors: controls.colors }),
    showValues: controls.showValues,
    ...(controls.xAxisLabel === undefined ? {} : { xAxisLabel: controls.xAxisLabel }),
    ...(controls.yAxisLabel === undefined ? {} : { yAxisLabel: controls.yAxisLabel })
  };
}

function reportChartPalette(value: string | null): readonly string[] {
  const colors = commaListFormValue(value);
  const invalid = colors.find((color) => !isReportChartColor(color));
  if (invalid !== undefined) {
    throw new FrameworkError("BAD_REQUEST", `Report chart color '${invalid}' is invalid`, { status: 400 });
  }
  return colors;
}

function optionalEnumSearchParamValue<TValue extends string>(
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
  form: FormData,
  tableDefinitions: FormTableDefinitions,
  definitionPath: string,
  inputPath: string
): DocumentData[string] | undefined {
  const childFields = child.fields.filter((childField) => !childField.hidden && !childField.readOnly);
  const rows = tableRowIndexes(form, inputPath)
    .filter((rowIndex) => !isEmptyTableRow(form, tableDefinitions, definitionPath, inputPath, rowIndex, childFields))
    .map((rowIndex) => {
      return coerceTableRowValue(form, tableDefinitions, definitionPath, inputPath, rowIndex, childFields);
    });
  const nonEmptyRows = rows.filter((row) => Object.keys(row).length > 0);
  if (nonEmptyRows.length === 0) {
    return field.required ? [] : undefined;
  }
  return nonEmptyRows as DocumentData[string];
}

function coerceTableRowValue(
  form: FormData,
  tableDefinitions: FormTableDefinitions,
  definitionPath: string,
  inputPath: string,
  rowIndex: number,
  childFields: readonly FieldDefinition[]
): MutableDocumentData {
  const row = Object.fromEntries(
    childFields
      .map((childField) => {
        const childDefinitionPath = `${definitionPath}.${childField.name}`;
        const childInputPath = tableInputName(inputPath, rowIndex, childField.name);
        const nestedChild = childField.type === "table" && childField.tableOf
          ? tableDefinitions[childDefinitionPath]
          : undefined;
        return [
          childField.name,
          nestedChild
            ? coerceTableFormValue(childField, nestedChild, form, tableDefinitions, childDefinitionPath, childInputPath)
            : coerceFormValue(childField, form.get(childInputPath))
        ] as const;
      })
      .filter(([, value]) => value !== undefined)
  ) as MutableDocumentData;
  const origin = coerceChildRowOrigin(form.get(tableInputName(inputPath, rowIndex, CHILD_TABLE_ROW_INDEX_FIELD)));
  if (origin !== undefined) {
    row[CHILD_TABLE_ROW_INDEX_FIELD] = origin;
  }
  return row;
}

function isEmptyTableRow(
  form: FormData,
  tableDefinitions: FormTableDefinitions,
  definitionPath: string,
  inputPath: string,
  rowIndex: number,
  childFields: readonly FieldDefinition[]
): boolean {
  return childFields.every((childField) => {
    const childDefinitionPath = `${definitionPath}.${childField.name}`;
    const childInputPath = tableInputName(inputPath, rowIndex, childField.name);
    const nestedChild = childField.type === "table" && childField.tableOf
      ? tableDefinitions[childDefinitionPath]
      : undefined;
    if (nestedChild) {
      const nestedFields = nestedChild.fields.filter((nestedField) => !nestedField.hidden && !nestedField.readOnly);
      return tableRowIndexes(form, childInputPath).every((nestedIndex) =>
        isEmptyTableRow(form, tableDefinitions, childDefinitionPath, childInputPath, nestedIndex, nestedFields)
      );
    }
    const value = form.get(childInputPath);
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
