import { assertAppName, assertAppNames } from "./app-name.js";
import { resolveAppDependencyOrder } from "./app-graph.js";
import {
  assertCalendarDefinition,
  assertCalendarMatchesDocType,
  defineCalendar,
  type CalendarDefinition
} from "./calendar.js";
import { clientScriptAppliesTo, defineClientScript } from "./client-script.js";
import type { ClientScriptDefinition, ClientScriptScope } from "./client-script.js";
import { assertDataPatchId, defineDataPatch, type DataPatchDefinition } from "./data-patch.js";
import {
  assertDashboardDefinition,
  defineDashboard,
  type DashboardCardSourceDefinition,
  type DashboardDefinition
} from "./dashboard.js";
import { FrameworkError } from "./errors.js";
import { normalizeListFilterExpression, normalizeListFilters } from "./list-view.js";
import { assertKanbanDefinition, assertKanbanMatchesDocType, defineKanban, type KanbanDefinition } from "./kanban.js";
import type { PrintFormatDefinition, PrintLetterheadDefinition } from "./print-format.js";
import {
  assertPrintFormatMatchesDocType,
  definePrintFormat,
  definePrintLetterhead
} from "./print-format.js";
import type { ReportDefinition, ReportSummaryDefinition } from "./reports.js";
import { assertReportFilterValues, assertReportMatchesDocType, defineReport } from "./reports.js";
import type { InstalledAppDefinition } from "./app.js";
import { assertWebFormDefinition, assertWebFormMatchesDocType, defineWebForm, type WebFormDefinition } from "./web-form.js";
import { assertWebPageDefinition, defineWebPage, type WebPageDefinition } from "./web-page.js";
import { assertWebViewDefinition, assertWebViewMatchesDocType, defineWebView, type WebViewDefinition } from "./web-view.js";
import {
  assertWebsiteSettingsDefinition,
  defineWebsiteSettings,
  type WebsiteSettingsDefinition
} from "./website-settings.js";
import { assertWebsiteThemeDefinition, defineWebsiteTheme, type WebsiteThemeDefinition } from "./website-theme.js";
import { assertWorkspaceDefinition, defineWorkspace, type WorkspaceDefinition } from "./workspace.js";
import { defineDocType } from "./schema.js";
import type {
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  DomainEvent,
  FieldDefinition,
  MutableDocumentData,
  ValidationIssue
} from "./types.js";

export type MaybePromise<T> = T | Promise<T>;

export interface HookContext {
  readonly doctype: DocTypeDefinition;
  readonly data: DocumentData;
  readonly existing?: DocumentSnapshot;
}

export interface AfterCommitContext extends HookContext {
  readonly event: DomainEvent;
  readonly snapshot: DocumentSnapshot | null;
}

export interface DocumentHooks {
  readonly beforeValidate?: (context: HookContext) => MaybePromise<MutableDocumentData | void>;
  readonly validate?: (context: HookContext) => MaybePromise<readonly ValidationIssue[] | void>;
  readonly afterCommit?: (context: AfterCommitContext) => MaybePromise<void>;
}

export function defineDocumentHooks(hooks: DocumentHooks): DocumentHooks {
  return Object.freeze({
    ...(hooks.beforeValidate === undefined ? {} : { beforeValidate: hooks.beforeValidate }),
    ...(hooks.validate === undefined ? {} : { validate: hooks.validate }),
    ...(hooks.afterCommit === undefined ? {} : { afterCommit: hooks.afterCommit })
  });
}

export interface RegistryOptions {
  readonly apps?: readonly InstalledAppDefinition[];
  readonly doctypes?: readonly DocTypeDefinition[];
  readonly letterheads?: readonly PrintLetterheadDefinition[];
  readonly printFormats?: readonly PrintFormatDefinition[];
  readonly reports?: readonly ReportDefinition[];
  readonly dashboards?: readonly DashboardDefinition[];
  readonly kanbans?: readonly KanbanDefinition[];
  readonly calendars?: readonly CalendarDefinition[];
  readonly webForms?: readonly WebFormDefinition[];
  readonly webPages?: readonly WebPageDefinition[];
  readonly webViews?: readonly WebViewDefinition[];
  readonly websiteSettings?: WebsiteSettingsDefinition | readonly WebsiteSettingsDefinition[];
  readonly websiteThemes?: readonly WebsiteThemeDefinition[];
  readonly workspaces?: readonly WorkspaceDefinition[];
  readonly clientScripts?: readonly ClientScriptDefinition[];
  readonly dataPatches?: readonly DataPatchDefinition[];
  readonly hooks?: Readonly<Record<string, readonly DocumentHooks[]>>;
}

export class ModelRegistry {
  private readonly apps = new Map<string, InstalledAppDefinition>();
  private readonly doctypes = new Map<string, DocTypeDefinition>();
  private readonly letterheads = new Map<string, PrintLetterheadDefinition>();
  private readonly printFormats = new Map<string, PrintFormatDefinition>();
  private readonly reports = new Map<string, ReportDefinition>();
  private readonly dashboards = new Map<string, DashboardDefinition>();
  private readonly kanbans = new Map<string, KanbanDefinition>();
  private readonly calendars = new Map<string, CalendarDefinition>();
  private readonly webForms = new Map<string, WebFormDefinition>();
  private readonly webFormRoutes = new Map<string, string>();
  private readonly webPages = new Map<string, WebPageDefinition>();
  private readonly webViews = new Map<string, WebViewDefinition>();
  private websiteSettings: WebsiteSettingsDefinition | undefined;
  private readonly websiteThemes = new Map<string, WebsiteThemeDefinition>();
  private readonly workspaces = new Map<string, WorkspaceDefinition>();
  private readonly clientScripts = new Map<string, ClientScriptDefinition>();
  private readonly dataPatches = new Map<string, DataPatchDefinition>();
  private readonly hooks = new Map<string, readonly DocumentHooks[]>();

  constructor(options: RegistryOptions = {}) {
    for (const app of resolveAppDependencyOrder(options.apps ?? [])) {
      this.registerApp(app);
    }
    for (const doctype of options.doctypes ?? []) {
      this.putDocType(doctype);
    }
    this.assertDocTypeReferencesResolve();
    for (const letterhead of options.letterheads ?? []) {
      this.registerPrintLetterhead(letterhead);
    }
    for (const report of options.reports ?? []) {
      this.registerReport(report);
    }
    for (const dashboard of options.dashboards ?? []) {
      this.registerDashboard(dashboard);
    }
    for (const kanban of options.kanbans ?? []) {
      this.registerKanban(kanban);
    }
    for (const calendar of options.calendars ?? []) {
      this.registerCalendar(calendar);
    }
    for (const webForm of options.webForms ?? []) {
      this.registerWebForm(webForm);
    }
    for (const webPage of options.webPages ?? []) {
      this.registerWebPage(webPage);
    }
    for (const webView of options.webViews ?? []) {
      this.registerWebView(webView);
    }
    for (const websiteTheme of options.websiteThemes ?? []) {
      this.registerWebsiteTheme(websiteTheme);
    }
    for (const websiteSettings of websiteSettingsDefinitions(options.websiteSettings)) {
      this.registerWebsiteSettings(websiteSettings);
    }
    for (const format of options.printFormats ?? []) {
      this.registerPrintFormat(format);
    }
    for (const workspace of options.workspaces ?? []) {
      this.registerWorkspace(workspace);
    }
    for (const script of options.clientScripts ?? []) {
      this.registerClientScript(script);
    }
    for (const patch of options.dataPatches ?? []) {
      this.registerDataPatch(patch);
    }
    for (const [doctype, hooks] of Object.entries(options.hooks ?? {})) {
      for (const hook of hooks) {
        this.registerHooks(doctype, hook);
      }
    }
  }

  registerApp(app: InstalledAppDefinition): void {
    assertAppName(app.name);
    assertAppNames(app.dependencies ?? []);
    for (const dependencyName of app.dependencies ?? []) {
      if (!this.apps.has(dependencyName)) {
        throw new FrameworkError(
          "APP_DEPENDENCY_MISSING",
          `App '${app.name}' depends on missing app '${dependencyName}'`,
          { status: 400 }
        );
      }
    }
    if (this.apps.has(app.name)) {
      throw new FrameworkError("APP_DUPLICATE", `App '${app.name}' is already registered`, {
        status: 409
      });
    }
    this.apps.set(app.name, Object.freeze({
      name: app.name,
      ...(app.label === undefined ? {} : { label: app.label }),
      ...(app.version === undefined ? {} : { version: app.version }),
      modules: Object.freeze([...(app.modules ?? [])]),
      dependencies: Object.freeze([...(app.dependencies ?? [])])
    }));
  }

  registerDocType(doctype: DocTypeDefinition): void {
    this.putDocType(doctype);
    try {
      this.assertDocTypeReferencesResolve();
    } catch (error) {
      this.doctypes.delete(doctype.name);
      throw error;
    }
  }

  private putDocType(doctype: DocTypeDefinition): void {
    const definition = defineDocType(doctype);
    if (this.doctypes.has(definition.name)) {
      throw new FrameworkError("DOCTYPE_DUPLICATE", `DocType '${definition.name}' is already registered`, {
        status: 409
      });
    }
    this.doctypes.set(definition.name, definition);
  }

  private assertDocTypeReferencesResolve(): void {
    for (const doctype of this.doctypes.values()) {
      for (const field of doctype.fields) {
        if (field.type === "link" && (!field.linkTo || !this.doctypes.has(field.linkTo))) {
          throw new FrameworkError(
            "DOCTYPE_LINK_INVALID",
            `Link field '${field.name}' on ${doctype.name} targets unregistered DocType '${field.linkTo ?? ""}'`,
            { status: 400 }
          );
        }
        if (field.type === "table" && (!field.tableOf || !this.doctypes.has(field.tableOf))) {
          throw new FrameworkError(
            "DOCTYPE_TABLE_INVALID",
            `Table field '${field.name}' on ${doctype.name} targets unregistered DocType '${field.tableOf ?? ""}'`,
            { status: 400 }
          );
        }
      }
    }
  }

  registerReport(report: ReportDefinition): void {
    const definition = defineReport(report);
    const doctype = this.doctypes.get(definition.doctype);
    if (!doctype) {
      throw new FrameworkError("DOCTYPE_NOT_FOUND", `DocType '${definition.doctype}' is not registered`, {
        status: 404
      });
    }
    if (this.reports.has(definition.name)) {
      throw new FrameworkError("REPORT_DUPLICATE", `Report '${definition.name}' is already registered`, {
        status: 409
      });
    }
    assertReportMatchesDocType(definition, doctype);
    this.reports.set(definition.name, definition);
  }

  registerPrintLetterhead(letterhead: PrintLetterheadDefinition): void {
    const definition = definePrintLetterhead(letterhead);
    if (this.letterheads.has(definition.name)) {
      throw new FrameworkError(
        "PRINT_FORMAT_DUPLICATE",
        `Print letterhead '${definition.name}' is already registered`,
        { status: 409 }
      );
    }
    this.letterheads.set(definition.name, definition);
  }

  registerPrintFormat(format: PrintFormatDefinition): void {
    const definition = definePrintFormat(format);
    const doctype = this.doctypes.get(definition.doctype);
    if (!doctype) {
      throw new FrameworkError("DOCTYPE_NOT_FOUND", `DocType '${definition.doctype}' is not registered`, {
        status: 404
      });
    }
    if (this.printFormats.has(definition.name)) {
      throw new FrameworkError("PRINT_FORMAT_DUPLICATE", `Print format '${definition.name}' is already registered`, {
        status: 409
      });
    }
    if (definition.letterhead !== undefined && !this.letterheads.has(definition.letterhead)) {
      throw new FrameworkError(
        "PRINT_FORMAT_INVALID",
        `Print format '${definition.name}' references unknown letterhead '${definition.letterhead}'`,
        { status: 400 }
      );
    }
    assertPrintFormatMatchesDocType(definition, doctype);
    this.printFormats.set(definition.name, definition);
  }

  registerClientScript(script: ClientScriptDefinition): void {
    const definition = defineClientScript(script);
    if (!this.doctypes.has(definition.doctype)) {
      throw new FrameworkError("DOCTYPE_NOT_FOUND", `DocType '${definition.doctype}' is not registered`, {
        status: 404
      });
    }
    if (this.clientScripts.has(definition.name)) {
      throw new FrameworkError("CLIENT_SCRIPT_DUPLICATE", `Client script '${definition.name}' is already registered`, {
        status: 409
      });
    }
    this.clientScripts.set(definition.name, definition);
  }

  registerDataPatch(patch: DataPatchDefinition): void {
    assertDataPatchId(patch.id);
    const definition = defineDataPatch(patch);
    if (this.dataPatches.has(definition.id)) {
      throw new FrameworkError("DATA_PATCH_DUPLICATE", `Data patch '${definition.id}' is already registered`, {
        status: 409
      });
    }
    this.dataPatches.set(definition.id, definition);
  }

  registerDashboard(dashboard: DashboardDefinition): void {
    const definition = defineDashboard(dashboard);
    if (this.dashboards.has(definition.name)) {
      throw new FrameworkError("DASHBOARD_DUPLICATE", `Dashboard '${definition.name}' is already registered`, {
        status: 409
      });
    }
    assertDashboardDefinition(definition);
    this.assertDashboardReferencesResolve(definition);
    this.dashboards.set(definition.name, definition);
  }

  registerKanban(kanban: KanbanDefinition): void {
    const definition = defineKanban(kanban);
    if (this.kanbans.has(definition.name)) {
      throw new FrameworkError("KANBAN_DUPLICATE", `Kanban '${definition.name}' is already registered`, {
        status: 409
      });
    }
    assertKanbanDefinition(definition);
    this.assertKanbanReferencesResolve(definition);
    this.kanbans.set(definition.name, definition);
  }

  registerCalendar(calendar: CalendarDefinition): void {
    const definition = defineCalendar(calendar);
    if (this.calendars.has(definition.name)) {
      throw new FrameworkError("CALENDAR_DUPLICATE", `Calendar '${definition.name}' is already registered`, {
        status: 409
      });
    }
    assertCalendarDefinition(definition);
    this.assertCalendarReferencesResolve(definition);
    this.calendars.set(definition.name, definition);
  }

  registerWebForm(webForm: WebFormDefinition): void {
    const definition = defineWebForm(webForm);
    if (this.webForms.has(definition.name)) {
      throw new FrameworkError("WEB_FORM_DUPLICATE", `Web form '${definition.name}' is already registered`, {
        status: 409
      });
    }
    if (definition.route !== undefined && this.webFormRoutes.has(definition.route)) {
      throw new FrameworkError("WEB_FORM_DUPLICATE", `Web form route '${definition.route}' is already registered`, {
        status: 409
      });
    }
    if (definition.route !== undefined && this.webForms.has(definition.route)) {
      throw new FrameworkError("WEB_FORM_DUPLICATE", `Web form route '${definition.route}' conflicts with an existing web form name`, {
        status: 409
      });
    }
    if (this.webFormRoutes.has(definition.name)) {
      throw new FrameworkError("WEB_FORM_DUPLICATE", `Web form name '${definition.name}' conflicts with an existing web form route`, {
        status: 409
      });
    }
    assertWebFormDefinition(definition);
    this.assertWebFormReferencesResolve(definition);
    this.webForms.set(definition.name, definition);
    if (definition.route !== undefined) {
      this.webFormRoutes.set(definition.route, definition.name);
    }
  }

  registerWebView(webView: WebViewDefinition): void {
    const definition = defineWebView(webView);
    if (this.webViews.has(definition.name)) {
      throw new FrameworkError("WEB_VIEW_DUPLICATE", `Web view '${definition.name}' is already registered`, {
        status: 409
      });
    }
    assertWebViewDefinition(definition);
    this.assertWebViewReferencesResolve(definition);
    this.webViews.set(definition.name, definition);
  }

  registerWebPage(webPage: WebPageDefinition): void {
    const definition = defineWebPage(webPage);
    if (this.webPages.has(definition.name)) {
      throw new FrameworkError("WEB_PAGE_DUPLICATE", `Web page '${definition.name}' is already registered`, {
        status: 409
      });
    }
    if ([...this.webPages.values()].some((page) => page.route === definition.route)) {
      throw new FrameworkError("WEB_PAGE_DUPLICATE", `Web page route '${definition.route}' is already registered`, {
        status: 409
      });
    }
    assertWebPageDefinition(definition);
    this.webPages.set(definition.name, definition);
  }

  registerWebsiteSettings(settings: WebsiteSettingsDefinition): void {
    const definition = defineWebsiteSettings(settings);
    if (this.websiteSettings !== undefined) {
      throw new FrameworkError("WEBSITE_SETTINGS_DUPLICATE", "Website settings are already registered", {
        status: 409
      });
    }
    assertWebsiteSettingsDefinition(definition);
    this.assertWebsiteReferencesResolve(definition);
    this.websiteSettings = definition;
  }

  registerWebsiteTheme(theme: WebsiteThemeDefinition): void {
    const definition = defineWebsiteTheme(theme);
    if (this.websiteThemes.has(definition.name)) {
      throw new FrameworkError("WEBSITE_THEME_DUPLICATE", `Website theme '${definition.name}' is already registered`, {
        status: 409
      });
    }
    assertWebsiteThemeDefinition(definition);
    this.websiteThemes.set(definition.name, definition);
  }

  registerWorkspace(workspace: WorkspaceDefinition): void {
    const definition = defineWorkspace(workspace);
    if (this.workspaces.has(definition.name)) {
      throw new FrameworkError("WORKSPACE_DUPLICATE", `Workspace '${definition.name}' is already registered`, {
        status: 409
      });
    }
    assertWorkspaceDefinition(definition);
    this.assertWorkspaceReferencesResolve(definition);
    this.workspaces.set(definition.name, definition);
  }

  registerHooks(doctype: string, hooks: DocumentHooks): void {
    if (!this.doctypes.has(doctype)) {
      throw new FrameworkError("DOCTYPE_NOT_FOUND", `DocType '${doctype}' is not registered`, {
        status: 404
      });
    }
    this.hooks.set(doctype, Object.freeze([...(this.hooks.get(doctype) ?? []), defineDocumentHooks(hooks)]));
  }

  get(doctype: string): DocTypeDefinition {
    const definition = this.doctypes.get(doctype);
    if (!definition) {
      throw new FrameworkError("DOCTYPE_NOT_FOUND", `DocType '${doctype}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  has(doctype: string): boolean {
    return this.doctypes.has(doctype);
  }

  list(): readonly DocTypeDefinition[] {
    return listDefinitionsByName(this.doctypes.values());
  }

  listApps(): readonly InstalledAppDefinition[] {
    return Object.freeze([...this.apps.values()]);
  }

  getReport(reportName: string): ReportDefinition {
    const definition = this.reports.get(reportName);
    if (!definition) {
      throw new FrameworkError("REPORT_NOT_FOUND", `Report '${reportName}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  listReports(): readonly ReportDefinition[] {
    return listDefinitionsByName(this.reports.values());
  }

  getDashboard(dashboardName: string): DashboardDefinition {
    const definition = this.dashboards.get(dashboardName);
    if (!definition) {
      throw new FrameworkError("DASHBOARD_NOT_FOUND", `Dashboard '${dashboardName}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  listDashboards(): readonly DashboardDefinition[] {
    return listDefinitionsByName(this.dashboards.values());
  }

  getKanban(kanbanName: string): KanbanDefinition {
    const definition = this.kanbans.get(kanbanName);
    if (!definition) {
      throw new FrameworkError("KANBAN_NOT_FOUND", `Kanban '${kanbanName}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  listKanbans(): readonly KanbanDefinition[] {
    return listDefinitionsByName(this.kanbans.values());
  }

  getCalendar(calendarName: string): CalendarDefinition {
    const definition = this.calendars.get(calendarName);
    if (!definition) {
      throw new FrameworkError("CALENDAR_NOT_FOUND", `Calendar '${calendarName}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  listCalendars(): readonly CalendarDefinition[] {
    return listDefinitionsByName(this.calendars.values());
  }

  getWebForm(webFormName: string): WebFormDefinition {
    const definition = this.webForms.get(webFormName);
    if (!definition) {
      throw new FrameworkError("WEB_FORM_NOT_FOUND", `Web form '${webFormName}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  getWebFormByRoute(route: string): WebFormDefinition {
    const name = this.webFormRoutes.get(route);
    if (name === undefined) {
      throw new FrameworkError("WEB_FORM_NOT_FOUND", `Web form route '${route}' is not registered`, {
        status: 404
      });
    }
    return this.getWebForm(name);
  }

  listWebForms(): readonly WebFormDefinition[] {
    return listDefinitionsByName(this.webForms.values());
  }

  getWebView(webViewName: string): WebViewDefinition {
    const definition = this.webViews.get(webViewName);
    if (!definition) {
      throw new FrameworkError("WEB_VIEW_NOT_FOUND", `Web view '${webViewName}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  listWebViews(): readonly WebViewDefinition[] {
    return listDefinitionsByName(this.webViews.values());
  }

  getWebPage(webPageName: string): WebPageDefinition {
    const definition = this.webPages.get(webPageName);
    if (!definition) {
      throw new FrameworkError("WEB_PAGE_NOT_FOUND", `Web page '${webPageName}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  listWebPages(): readonly WebPageDefinition[] {
    return listDefinitionsByName(this.webPages.values());
  }

  getWebsiteSettings(): WebsiteSettingsDefinition {
    if (this.websiteSettings === undefined) {
      throw new FrameworkError("WEBSITE_SETTINGS_NOT_FOUND", "Website settings are not registered", {
        status: 404
      });
    }
    return this.websiteSettings;
  }

  getWebsiteTheme(themeName: string): WebsiteThemeDefinition {
    const definition = this.websiteThemes.get(themeName);
    if (definition === undefined) {
      throw new FrameworkError("WEBSITE_THEME_NOT_FOUND", `Website theme '${themeName}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  listWebsiteThemes(): readonly WebsiteThemeDefinition[] {
    return listDefinitionsByName(this.websiteThemes.values());
  }

  getPrintFormat(formatName: string): PrintFormatDefinition {
    const definition = this.printFormats.get(formatName);
    if (!definition) {
      throw new FrameworkError("PRINT_FORMAT_NOT_FOUND", `Print format '${formatName}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  listPrintFormats(): readonly PrintFormatDefinition[] {
    return listDefinitionsByName(this.printFormats.values());
  }

  getPrintLetterhead(letterheadName: string): PrintLetterheadDefinition {
    const definition = this.letterheads.get(letterheadName);
    if (!definition) {
      throw new FrameworkError("PRINT_FORMAT_NOT_FOUND", `Print letterhead '${letterheadName}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  listPrintLetterheads(): readonly PrintLetterheadDefinition[] {
    return listDefinitionsByName(this.letterheads.values());
  }

  listClientScripts(
    doctype?: string,
    scope?: Exclude<ClientScriptScope, "both">
  ): readonly ClientScriptDefinition[] {
    return listDefinitionsByName([...this.clientScripts.values()]
      .filter((script) => doctype === undefined || script.doctype === doctype)
      .filter((script) => scope === undefined || clientScriptAppliesTo(script, scope)));
  }

  listDataPatches(): readonly DataPatchDefinition[] {
    return Object.freeze([...this.dataPatches.values()]);
  }

  getWorkspace(workspaceName: string): WorkspaceDefinition {
    const definition = this.workspaces.get(workspaceName);
    if (!definition) {
      throw new FrameworkError("WORKSPACE_NOT_FOUND", `Workspace '${workspaceName}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  listWorkspaces(): readonly WorkspaceDefinition[] {
    return listDefinitionsByName(this.workspaces.values());
  }

  hooksFor(doctype: string): readonly DocumentHooks[] {
    return this.hooks.get(doctype) ?? emptyHooks;
  }

  private assertWorkspaceReferencesResolve(workspace: WorkspaceDefinition): void {
    for (const section of workspace.sections) {
      for (const shortcut of section.shortcuts) {
        if (
          (shortcut.kind === "doctype" || shortcut.kind === "newDoc") &&
          !this.doctypes.has(shortcut.target ?? "")
        ) {
          throw new FrameworkError(
            "WORKSPACE_INVALID",
            `Workspace '${workspace.name}' shortcut '${shortcut.name}' references unknown DocType '${shortcut.target ?? ""}'`,
            { status: 400 }
          );
        }
        if (shortcut.kind === "report" && !this.reports.has(shortcut.target ?? "")) {
          throw new FrameworkError(
            "WORKSPACE_INVALID",
            `Workspace '${workspace.name}' shortcut '${shortcut.name}' references unknown report '${shortcut.target ?? ""}'`,
            { status: 400 }
          );
        }
        if (shortcut.kind === "dashboard" && !this.dashboards.has(shortcut.target ?? "")) {
          throw new FrameworkError(
            "WORKSPACE_INVALID",
            `Workspace '${workspace.name}' shortcut '${shortcut.name}' references unknown dashboard '${shortcut.target ?? ""}'`,
            { status: 400 }
          );
        }
        if (shortcut.kind === "kanban" && !this.kanbans.has(shortcut.target ?? "")) {
          throw new FrameworkError(
            "WORKSPACE_INVALID",
            `Workspace '${workspace.name}' shortcut '${shortcut.name}' references unknown kanban '${shortcut.target ?? ""}'`,
            { status: 400 }
          );
        }
        if (shortcut.kind === "calendar" && !this.calendars.has(shortcut.target ?? "")) {
          throw new FrameworkError(
            "WORKSPACE_INVALID",
            `Workspace '${workspace.name}' shortcut '${shortcut.name}' references unknown calendar '${shortcut.target ?? ""}'`,
            { status: 400 }
          );
        }
      }
    }
  }

  private assertKanbanReferencesResolve(kanban: KanbanDefinition): void {
    const doctype = this.doctypes.get(kanban.doctype);
    if (!doctype) {
      throw new FrameworkError(
        "KANBAN_INVALID",
        `Kanban '${kanban.name}' references unknown DocType '${kanban.doctype}'`,
        { status: 400 }
      );
    }
    assertKanbanMatchesDocType(kanban, doctype);
  }

  private assertCalendarReferencesResolve(calendar: CalendarDefinition): void {
    const doctype = this.doctypes.get(calendar.doctype);
    if (!doctype) {
      throw new FrameworkError(
        "CALENDAR_INVALID",
        `Calendar '${calendar.name}' references unknown DocType '${calendar.doctype}'`,
        { status: 400 }
      );
    }
    assertCalendarMatchesDocType(calendar, doctype);
  }

  private assertWebFormReferencesResolve(webForm: WebFormDefinition): void {
    const doctype = this.doctypes.get(webForm.doctype);
    if (!doctype) {
      throw new FrameworkError(
        "WEB_FORM_INVALID",
        `Web form '${webForm.name}' references unknown DocType '${webForm.doctype}'`,
        { status: 400 }
      );
    }
    assertWebFormMatchesDocType(webForm, doctype);
  }

  private assertWebViewReferencesResolve(webView: WebViewDefinition): void {
    const doctype = this.doctypes.get(webView.doctype);
    if (!doctype) {
      throw new FrameworkError(
        "WEB_VIEW_INVALID",
        `Web view '${webView.name}' references unknown DocType '${webView.doctype}'`,
        { status: 400 }
      );
    }
    assertWebViewMatchesDocType(webView, doctype);
  }

  private assertWebsiteReferencesResolve(settings: WebsiteSettingsDefinition): void {
    if (settings.theme !== undefined && !this.websiteThemes.has(settings.theme)) {
      throw new FrameworkError(
        "WEBSITE_SETTINGS_INVALID",
        `Website settings reference unknown Website Theme '${settings.theme}'`,
        { status: 400 }
      );
    }
    const routes = new Set(this.listWebPages().map((page) => page.route));
    const referencedRoutes = [
      ...(settings.homePageRoute === undefined ? [] : [settings.homePageRoute]),
      ...(settings.navItems ?? []).flatMap((item) => (item.pageRoute === undefined ? [] : [item.pageRoute]))
    ];
    for (const route of referencedRoutes) {
      if (!routes.has(route)) {
        throw new FrameworkError(
          "WEBSITE_SETTINGS_INVALID",
          `Website settings reference unknown Web Page route '${route}'`,
          { status: 400 }
        );
      }
    }
    const referencedWebForms = [
      ...(settings.homePageWebForm === undefined ? [] : [settings.homePageWebForm]),
      ...(settings.navItems ?? []).flatMap((item) => (item.webForm === undefined ? [] : [item.webForm]))
    ];
    for (const webForm of referencedWebForms) {
      if (!this.webForms.has(webForm)) {
        throw new FrameworkError(
          "WEBSITE_SETTINGS_INVALID",
          `Website settings reference unknown Web Form '${webForm}'`,
          { status: 400 }
        );
      }
    }
    const referencedWebViews = [
      ...(settings.homePageWebView === undefined ? [] : [settings.homePageWebView]),
      ...(settings.navItems ?? []).flatMap((item) => (item.webView === undefined ? [] : [item.webView]))
    ];
    for (const webView of referencedWebViews) {
      if (!this.webViews.has(webView)) {
        throw new FrameworkError(
          "WEBSITE_SETTINGS_INVALID",
          `Website settings reference unknown Web View '${webView}'`,
          { status: 400 }
        );
      }
    }
  }

  private assertDashboardReferencesResolve(dashboard: DashboardDefinition): void {
    for (const card of dashboard.cards) {
      const source = card.source;
      if (source.kind === "documentCount" || source.kind === "documentAggregate") {
        const doctype = this.doctypes.get(source.doctype);
        if (!doctype) {
          throw new FrameworkError(
            "DASHBOARD_INVALID",
            `Dashboard '${dashboard.name}' card '${card.name}' references unknown DocType '${source.doctype}'`,
            { status: 400 }
          );
        }
        normalizeListFilters(doctype, source.filters ?? [], { errorCode: "DASHBOARD_INVALID" });
        if (source.filterExpression !== undefined) {
          normalizeListFilterExpression(doctype, source.filterExpression, { errorCode: "DASHBOARD_INVALID" });
        }
        if (source.kind === "documentAggregate") {
          this.assertDashboardDocumentAggregateReferencesResolve(dashboard, card.name, source, doctype);
        }
        continue;
      }
      const report = this.reports.get(source.report);
      if (!report) {
        throw new FrameworkError(
          "DASHBOARD_INVALID",
          `Dashboard '${dashboard.name}' card '${card.name}' references unknown report '${source.report}'`,
          { status: 400 }
        );
      }
      const summary = source.kind === "reportSummary"
        ? (report.summaries ?? []).find((candidate) => candidate.name === source.summary)
        : undefined;
      if (source.kind === "reportSummary") {
        if (!summary) {
          throw new FrameworkError(
            "DASHBOARD_INVALID",
            `Dashboard '${dashboard.name}' card '${card.name}' references unknown summary '${source.summary}' on report '${source.report}'`,
            { status: 400 }
          );
        }
        if (card.indicatorRules !== undefined) {
          this.assertDashboardReportSummaryIndicatorRulesResolve(dashboard, card.name, report, summary, this.get(report.doctype));
        }
      }
      if (source.kind === "reportChart" && !(report.charts ?? []).some((chart) => chart.name === source.chart)) {
        throw new FrameworkError(
          "DASHBOARD_INVALID",
          `Dashboard '${dashboard.name}' card '${card.name}' references unknown chart '${source.chart}' on report '${source.report}'`,
          { status: 400 }
        );
      }
      assertReportFilterValues(report, this.get(report.doctype), source.filters ?? {}, {
        code: "DASHBOARD_INVALID",
        context: `Dashboard '${dashboard.name}' card '${card.name}' filters`
      });
    }
  }

  private assertDashboardDocumentAggregateReferencesResolve(
    dashboard: DashboardDefinition,
    cardName: string,
    source: Extract<DashboardCardSourceDefinition, { readonly kind: "documentAggregate" }>,
    doctype: DocTypeDefinition
  ): void {
    if (source.aggregate === "count") {
      return;
    }
    const field = doctype.fields.find((candidate) => candidate.name === source.field);
    if (!field) {
      throw new FrameworkError(
        "DASHBOARD_INVALID",
        `Dashboard '${dashboard.name}' card '${cardName}' references unknown aggregate field '${source.field}' on DocType '${source.doctype}'`,
        { status: 400 }
      );
    }
    if (!isNumericDashboardAggregateField(field)) {
      throw new FrameworkError(
        "DASHBOARD_INVALID",
        `Dashboard '${dashboard.name}' card '${cardName}' aggregate field '${source.field}' must be an integer or number field`,
        { status: 400 }
      );
    }
  }

  private assertDashboardReportSummaryIndicatorRulesResolve(
    dashboard: DashboardDefinition,
    cardName: string,
    report: ReportDefinition,
    summary: ReportSummaryDefinition,
    doctype: DocTypeDefinition
  ): void {
    if (report.source?.kind === "custom") {
      if (summary.aggregate === "count" || customReportSummaryIsNumeric(report, summary)) {
        return;
      }
      throw new FrameworkError(
        "DASHBOARD_INVALID",
        `Dashboard '${dashboard.name}' card '${cardName}' indicator rules require a numeric summary '${summary.name}' on report '${report.name}'`,
        { status: 400 }
      );
    }
    if (summary.aggregate === "count" || summary.aggregate === "sum" || summary.aggregate === "avg") {
      return;
    }
    const field = doctype.fields.find((candidate) => candidate.name === summary.field);
    if (field && isNumericDashboardAggregateField(field)) {
      return;
    }
    throw new FrameworkError(
      "DASHBOARD_INVALID",
      `Dashboard '${dashboard.name}' card '${cardName}' indicator rules require a numeric summary '${summary.name}' on report '${report.name}'`,
      { status: 400 }
    );
  }
}

export function createRegistry(options: RegistryOptions = {}): ModelRegistry {
  return new ModelRegistry(options);
}

function websiteSettingsDefinitions(
  settings: WebsiteSettingsDefinition | readonly WebsiteSettingsDefinition[] | undefined
): readonly WebsiteSettingsDefinition[] {
  if (settings === undefined) {
    return [];
  }
  return isWebsiteSettingsArray(settings) ? settings : [settings];
}

function isWebsiteSettingsArray(
  settings: WebsiteSettingsDefinition | readonly WebsiteSettingsDefinition[]
): settings is readonly WebsiteSettingsDefinition[] {
  return Array.isArray(settings);
}

function isNumericDashboardAggregateField(field: FieldDefinition): boolean {
  return field.type === "integer" || field.type === "number";
}

function customReportSummaryIsNumeric(report: ReportDefinition, summary: ReportSummaryDefinition): boolean {
  const field = summary.field;
  if (!field) {
    return false;
  }
  if (summary.type === "integer" || summary.type === "number") {
    return true;
  }
  const column = report.columns.find((candidate) => candidate.formula === undefined && (candidate.field ?? candidate.name) === field);
  return column?.type === "integer" || column?.type === "number";
}

function listDefinitionsByName<T extends { readonly name: string }>(definitions: Iterable<T>): readonly T[] {
  return Object.freeze([...definitions].sort((left, right) => left.name.localeCompare(right.name)));
}

const emptyHooks: readonly DocumentHooks[] = Object.freeze([]);
