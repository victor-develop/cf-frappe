import { assertAppName, assertAppNames } from "./app-name.js";
import { resolveAppDependencyOrder } from "./app-graph.js";
import { clientScriptAppliesTo, defineClientScript } from "./client-script.js";
import type { ClientScriptDefinition, ClientScriptScope } from "./client-script.js";
import { assertDataPatchId, defineDataPatch, type DataPatchDefinition } from "./data-patch.js";
import { assertDashboardDefinition, defineDashboard, type DashboardDefinition } from "./dashboard.js";
import { FrameworkError } from "./errors.js";
import { normalizeListFilters } from "./list-view.js";
import type { PrintFormatDefinition, PrintLetterheadDefinition } from "./print-format.js";
import { assertPrintFormatMatchesDocType, assertPrintLetterheadValid } from "./print-format.js";
import type { ReportDefinition } from "./reports.js";
import { assertReportDefinition, assertReportFilterValues, assertReportMatchesDocType } from "./reports.js";
import type { InstalledAppDefinition } from "./app.js";
import { assertWorkspaceDefinition, defineWorkspace, type WorkspaceDefinition } from "./workspace.js";
import type {
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  DomainEvent,
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

export interface RegistryOptions {
  readonly apps?: readonly InstalledAppDefinition[];
  readonly doctypes?: readonly DocTypeDefinition[];
  readonly letterheads?: readonly PrintLetterheadDefinition[];
  readonly printFormats?: readonly PrintFormatDefinition[];
  readonly reports?: readonly ReportDefinition[];
  readonly dashboards?: readonly DashboardDefinition[];
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
    if (this.doctypes.has(doctype.name)) {
      throw new FrameworkError("DOCTYPE_DUPLICATE", `DocType '${doctype.name}' is already registered`, {
        status: 409
      });
    }
    this.doctypes.set(doctype.name, doctype);
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
    const doctype = this.doctypes.get(report.doctype);
    if (!doctype) {
      throw new FrameworkError("DOCTYPE_NOT_FOUND", `DocType '${report.doctype}' is not registered`, {
        status: 404
      });
    }
    if (this.reports.has(report.name)) {
      throw new FrameworkError("REPORT_DUPLICATE", `Report '${report.name}' is already registered`, {
        status: 409
      });
    }
    assertReportDefinition(report);
    assertReportMatchesDocType(report, doctype);
    this.reports.set(report.name, report);
  }

  registerPrintLetterhead(letterhead: PrintLetterheadDefinition): void {
    if (this.letterheads.has(letterhead.name)) {
      throw new FrameworkError(
        "PRINT_FORMAT_DUPLICATE",
        `Print letterhead '${letterhead.name}' is already registered`,
        { status: 409 }
      );
    }
    assertPrintLetterheadValid(letterhead);
    this.letterheads.set(letterhead.name, letterhead);
  }

  registerPrintFormat(format: PrintFormatDefinition): void {
    const doctype = this.doctypes.get(format.doctype);
    if (!doctype) {
      throw new FrameworkError("DOCTYPE_NOT_FOUND", `DocType '${format.doctype}' is not registered`, {
        status: 404
      });
    }
    if (this.printFormats.has(format.name)) {
      throw new FrameworkError("PRINT_FORMAT_DUPLICATE", `Print format '${format.name}' is already registered`, {
        status: 409
      });
    }
    if (format.letterhead !== undefined && !this.letterheads.has(format.letterhead)) {
      throw new FrameworkError(
        "PRINT_FORMAT_INVALID",
        `Print format '${format.name}' references unknown letterhead '${format.letterhead}'`,
        { status: 400 }
      );
    }
    assertPrintFormatMatchesDocType(format, doctype);
    this.printFormats.set(format.name, format);
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
    this.hooks.set(doctype, Object.freeze([...(this.hooks.get(doctype) ?? []), hooks]));
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
    return [...this.doctypes.values()].sort((left, right) => left.name.localeCompare(right.name));
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
    return [...this.reports.values()].sort((left, right) => left.name.localeCompare(right.name));
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
    return [...this.dashboards.values()].sort((left, right) => left.name.localeCompare(right.name));
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
    return [...this.printFormats.values()].sort((left, right) => left.name.localeCompare(right.name));
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
    return [...this.letterheads.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  listClientScripts(
    doctype?: string,
    scope?: Exclude<ClientScriptScope, "both">
  ): readonly ClientScriptDefinition[] {
    return [...this.clientScripts.values()]
      .filter((script) => doctype === undefined || script.doctype === doctype)
      .filter((script) => scope === undefined || clientScriptAppliesTo(script, scope))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  listDataPatches(): readonly DataPatchDefinition[] {
    return [...this.dataPatches.values()];
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
    return [...this.workspaces.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  hooksFor(doctype: string): readonly DocumentHooks[] {
    return this.hooks.get(doctype) ?? emptyHooks;
  }

  private assertWorkspaceReferencesResolve(workspace: WorkspaceDefinition): void {
    for (const section of workspace.sections) {
      for (const shortcut of section.shortcuts) {
        if (shortcut.kind === "doctype" && !this.doctypes.has(shortcut.target ?? "")) {
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
      }
    }
  }

  private assertDashboardReferencesResolve(dashboard: DashboardDefinition): void {
    for (const card of dashboard.cards) {
      const source = card.source;
      if (source.kind === "documentCount") {
        const doctype = this.doctypes.get(source.doctype);
        if (!doctype) {
          throw new FrameworkError(
            "DASHBOARD_INVALID",
            `Dashboard '${dashboard.name}' card '${card.name}' references unknown DocType '${source.doctype}'`,
            { status: 400 }
          );
        }
        normalizeListFilters(doctype, source.filters ?? []);
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
      if (!(report.summaries ?? []).some((summary) => summary.name === source.summary)) {
        throw new FrameworkError(
          "DASHBOARD_INVALID",
          `Dashboard '${dashboard.name}' card '${card.name}' references unknown summary '${source.summary}' on report '${source.report}'`,
          { status: 400 }
        );
      }
      assertReportFilterValues(report, this.get(report.doctype), source.filters ?? {}, {
        code: "DASHBOARD_INVALID",
        context: `Dashboard '${dashboard.name}' card '${card.name}' filters`
      });
    }
  }
}

export function createRegistry(options: RegistryOptions = {}): ModelRegistry {
  return new ModelRegistry(options);
}

const emptyHooks: readonly DocumentHooks[] = Object.freeze([]);
