import { assertAppName, assertAppNames } from "./app-name.js";
import { resolveAppDependencyOrder } from "./app-graph.js";
import { defineCalendar, type CalendarDefinition } from "./calendar.js";
import { defineClientScript, type ClientScriptDefinition } from "./client-script.js";
import { defineDashboard, type DashboardDefinition } from "./dashboard.js";
import { defineDataPatch, type DataPatchDefinition } from "./data-patch.js";
import { defineDocumentHooks, type DocumentHooks } from "./document-hooks.js";
import { defineKanban, type KanbanDefinition } from "./kanban.js";
import { defineInstalledApp, type InstalledAppDefinition } from "./installed-app.js";
import {
  createRegistry,
  type ModelRegistry,
  type RegistryOptions
} from "./registry.js";
import {
  definePrintFormat,
  definePrintLetterhead,
  type PrintFormatDefinition,
  type PrintLetterheadDefinition
} from "./print-format.js";
import { defineReport, type ReportDefinition } from "./reports.js";
import { defineDocType } from "./schema.js";
import type { DocTypeDefinition } from "./types.js";
import { defineWebForm, type WebFormDefinition } from "./web-form.js";
import { defineWebPage, type WebPageDefinition } from "./web-page.js";
import { defineWebView, type WebViewDefinition } from "./web-view.js";
import { defineWebsiteSettings, type WebsiteSettingsDefinition } from "./website-settings.js";
import { defineWebsiteTheme, type WebsiteThemeDefinition } from "./website-theme.js";
import { defineWorkspace, type WorkspaceDefinition } from "./workspace.js";

export type { InstalledAppDefinition } from "./installed-app.js";

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

export function defineApp<TDataPatchResources = unknown>(
  input: FrameworkAppDefinition<TDataPatchResources>
): FrameworkAppDefinition<TDataPatchResources> {
  assertAppName(input.name);
  assertAppNames(input.dependencies ?? []);
  return Object.freeze({
    ...input,
    modules: Object.freeze([...(input.modules ?? [])]),
    dependencies: Object.freeze([...(input.dependencies ?? [])]),
    doctypes: Object.freeze((input.doctypes ?? []).map((doctype) => defineDocType(doctype))),
    letterheads: Object.freeze((input.letterheads ?? []).map(definePrintLetterhead)),
    printFormats: Object.freeze((input.printFormats ?? []).map(definePrintFormat)),
    reports: Object.freeze((input.reports ?? []).map(defineReport)),
    dashboards: Object.freeze((input.dashboards ?? []).map(defineDashboard)),
    kanbans: Object.freeze((input.kanbans ?? []).map(defineKanban)),
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
  return Object.freeze({
    apps: Object.freeze(orderedApps.map(defineInstalledApp)),
    doctypes: Object.freeze(orderedApps.flatMap((app) => app.doctypes ?? [])),
    letterheads: Object.freeze(orderedApps.flatMap((app) => app.letterheads ?? [])),
    printFormats: Object.freeze(orderedApps.flatMap((app) => app.printFormats ?? [])),
    reports: Object.freeze(orderedApps.flatMap((app) => app.reports ?? [])),
    dashboards: Object.freeze(orderedApps.flatMap((app) => app.dashboards ?? [])),
    kanbans: Object.freeze(orderedApps.flatMap((app) => app.kanbans ?? [])),
    calendars: Object.freeze(orderedApps.flatMap((app) => app.calendars ?? [])),
    webForms: Object.freeze(orderedApps.flatMap((app) => app.webForms ?? [])),
    webPages: Object.freeze(orderedApps.flatMap((app) => app.webPages ?? [])),
    webViews: Object.freeze(orderedApps.flatMap((app) => app.webViews ?? [])),
    websiteSettings: Object.freeze(
      orderedApps.flatMap((app) => (app.websiteSettings === undefined ? [] : [app.websiteSettings]))
    ),
    websiteThemes: Object.freeze(orderedApps.flatMap((app) => app.websiteThemes ?? [])),
    workspaces: Object.freeze(orderedApps.flatMap((app) => app.workspaces ?? [])),
    clientScripts: Object.freeze(orderedApps.flatMap((app) => app.clientScripts ?? [])),
    dataPatches: Object.freeze(orderedApps.flatMap((app) => app.dataPatches ?? [])) as readonly DataPatchDefinition[],
    hooks: freezeHookOptions(hooks)
  });
}

export function resolveAppInstallOrder<TDataPatchResources = unknown>(
  apps: readonly FrameworkAppDefinition<TDataPatchResources>[]
): readonly FrameworkAppDefinition<TDataPatchResources>[] {
  return resolveAppDependencyOrder(apps.map((app) => defineApp<TDataPatchResources>(app)));
}

function freezeHooks(hooks: Readonly<Record<string, readonly DocumentHooks[]>>): Readonly<Record<string, readonly DocumentHooks[]>> {
  const frozen: Record<string, readonly DocumentHooks[]> = {};
  for (const [doctype, entries] of Object.entries(hooks)) {
    frozen[doctype] = Object.freeze(entries.map(defineDocumentHooks));
  }
  return Object.freeze(frozen);
}

function freezeHookOptions(hooks: Readonly<Record<string, readonly DocumentHooks[]>>): Readonly<Record<string, readonly DocumentHooks[]>> {
  const frozen: Record<string, readonly DocumentHooks[]> = {};
  for (const [doctype, entries] of Object.entries(hooks)) {
    frozen[doctype] = Object.freeze([...entries]);
  }
  return Object.freeze(frozen);
}
