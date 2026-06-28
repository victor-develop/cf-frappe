import { assertAppName, assertAppNames } from "./app-name.js";
import { resolveAppDependencyOrder } from "./app-graph.js";
import { defineCalendar, type CalendarDefinition } from "./calendar.js";
import { defineClientScript, type ClientScriptDefinition } from "./client-script.js";
import type { DashboardDefinition } from "./dashboard.js";
import { defineDataPatch, type DataPatchDefinition } from "./data-patch.js";
import type { KanbanDefinition } from "./kanban.js";
import { createRegistry, type DocumentHooks, type ModelRegistry, type RegistryOptions } from "./registry.js";
import type { PrintFormatDefinition, PrintLetterheadDefinition } from "./print-format.js";
import type { ReportDefinition } from "./reports.js";
import type { DocTypeDefinition } from "./types.js";
import { defineWebForm, type WebFormDefinition } from "./web-form.js";
import { defineWebPage, type WebPageDefinition } from "./web-page.js";
import { defineWebView, type WebViewDefinition } from "./web-view.js";
import { defineWebsiteSettings, type WebsiteSettingsDefinition } from "./website-settings.js";
import { defineWebsiteTheme, type WebsiteThemeDefinition } from "./website-theme.js";
import { defineWorkspace, type WorkspaceDefinition } from "./workspace.js";

export interface FrameworkAppDefinition<TDataPatchResources = unknown> {
  readonly name: string;
  readonly label?: string;
  readonly version?: string;
  readonly modules?: readonly string[];
  readonly dependencies?: readonly string[];
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
  readonly websiteSettings?: WebsiteSettingsDefinition;
  readonly websiteThemes?: readonly WebsiteThemeDefinition[];
  readonly workspaces?: readonly WorkspaceDefinition[];
  readonly clientScripts?: readonly ClientScriptDefinition[];
  readonly dataPatches?: readonly DataPatchDefinition<TDataPatchResources>[];
  readonly hooks?: Readonly<Record<string, readonly DocumentHooks[]>>;
}

export interface InstalledAppDefinition {
  readonly name: string;
  readonly label?: string;
  readonly version?: string;
  readonly modules: readonly string[];
  readonly dependencies: readonly string[];
}

export function defineApp<TDataPatchResources = unknown>(
  input: FrameworkAppDefinition<TDataPatchResources>
): FrameworkAppDefinition<TDataPatchResources> {
  assertAppName(input.name);
  assertAppNames(input.dependencies ?? []);
  return Object.freeze({
    ...input,
    modules: Object.freeze([...(input.modules ?? [])]),
    dependencies: Object.freeze([...(input.dependencies ?? [])]),
    doctypes: Object.freeze([...(input.doctypes ?? [])]),
    letterheads: Object.freeze([...(input.letterheads ?? [])]),
    printFormats: Object.freeze([...(input.printFormats ?? [])]),
    reports: Object.freeze([...(input.reports ?? [])]),
    dashboards: Object.freeze([...(input.dashboards ?? [])]),
    kanbans: Object.freeze([...(input.kanbans ?? [])]),
    calendars: Object.freeze((input.calendars ?? []).map(defineCalendar)),
    webForms: Object.freeze((input.webForms ?? []).map(defineWebForm)),
    webPages: Object.freeze((input.webPages ?? []).map(defineWebPage)),
    webViews: Object.freeze((input.webViews ?? []).map(defineWebView)),
    ...(input.websiteSettings === undefined ? {} : { websiteSettings: defineWebsiteSettings(input.websiteSettings) }),
    websiteThemes: Object.freeze((input.websiteThemes ?? []).map(defineWebsiteTheme)),
    workspaces: Object.freeze((input.workspaces ?? []).map(defineWorkspace)),
    clientScripts: Object.freeze((input.clientScripts ?? []).map(defineClientScript)),
    dataPatches: Object.freeze((input.dataPatches ?? []).map((patch) => defineDataPatch<TDataPatchResources>(patch))),
    hooks: freezeHooks(input.hooks ?? {})
  });
}

export function createRegistryFromApps<TDataPatchResources = unknown>(
  apps: readonly FrameworkAppDefinition<TDataPatchResources>[]
): ModelRegistry {
  return createRegistry(registryOptionsFromApps(apps));
}

export function registryOptionsFromApps<TDataPatchResources = unknown>(
  apps: readonly FrameworkAppDefinition<TDataPatchResources>[]
): RegistryOptions {
  const orderedApps = resolveAppInstallOrder(apps);
  const hooks: Record<string, DocumentHooks[]> = {};
  for (const app of orderedApps) {
    for (const [doctype, appHooks] of Object.entries(app.hooks ?? {})) {
      hooks[doctype] = [...(hooks[doctype] ?? []), ...appHooks];
    }
  }
  return {
    apps: orderedApps.map(installedAppFromDefinition),
    doctypes: orderedApps.flatMap((app) => app.doctypes ?? []),
    letterheads: orderedApps.flatMap((app) => app.letterheads ?? []),
    printFormats: orderedApps.flatMap((app) => app.printFormats ?? []),
    reports: orderedApps.flatMap((app) => app.reports ?? []),
    dashboards: orderedApps.flatMap((app) => app.dashboards ?? []),
    kanbans: orderedApps.flatMap((app) => app.kanbans ?? []),
    calendars: orderedApps.flatMap((app) => app.calendars ?? []),
    webForms: orderedApps.flatMap((app) => app.webForms ?? []),
    webPages: orderedApps.flatMap((app) => app.webPages ?? []),
    webViews: orderedApps.flatMap((app) => app.webViews ?? []),
    websiteSettings: orderedApps.flatMap((app) => (app.websiteSettings === undefined ? [] : [app.websiteSettings])),
    websiteThemes: orderedApps.flatMap((app) => app.websiteThemes ?? []),
    workspaces: orderedApps.flatMap((app) => app.workspaces ?? []),
    clientScripts: orderedApps.flatMap((app) => app.clientScripts ?? []),
    dataPatches: orderedApps.flatMap((app) => app.dataPatches ?? []) as readonly DataPatchDefinition[],
    hooks
  };
}

export function resolveAppInstallOrder<TDataPatchResources = unknown>(
  apps: readonly FrameworkAppDefinition<TDataPatchResources>[]
): readonly FrameworkAppDefinition<TDataPatchResources>[] {
  return resolveAppDependencyOrder(apps);
}

function installedAppFromDefinition<TDataPatchResources>(
  app: FrameworkAppDefinition<TDataPatchResources>
): InstalledAppDefinition {
  return Object.freeze({
    name: app.name,
    ...(app.label === undefined ? {} : { label: app.label }),
    ...(app.version === undefined ? {} : { version: app.version }),
    modules: Object.freeze([...(app.modules ?? [])]),
    dependencies: Object.freeze([...(app.dependencies ?? [])])
  });
}

function freezeHooks(hooks: Readonly<Record<string, readonly DocumentHooks[]>>): Readonly<Record<string, readonly DocumentHooks[]>> {
  const frozen: Record<string, readonly DocumentHooks[]> = {};
  for (const [doctype, entries] of Object.entries(hooks)) {
    frozen[doctype] = Object.freeze([...entries]);
  }
  return Object.freeze(frozen);
}
