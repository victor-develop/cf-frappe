import { assertAppName, assertAppNames } from "./app-name.js";
import { resolveAppDependencyOrder } from "./app-graph.js";
import type { ClientScriptDefinition } from "./client-script.js";
import type { DashboardDefinition } from "./dashboard.js";
import type { DataPatchDefinition } from "./data-patch.js";
import type { KanbanDefinition } from "./kanban.js";
import { createRegistry, type DocumentHooks, type ModelRegistry, type RegistryOptions } from "./registry.js";
import type { PrintFormatDefinition, PrintLetterheadDefinition } from "./print-format.js";
import type { ReportDefinition } from "./reports.js";
import type { DocTypeDefinition } from "./types.js";
import type { WorkspaceDefinition } from "./workspace.js";

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
    workspaces: Object.freeze([...(input.workspaces ?? [])]),
    clientScripts: Object.freeze([...(input.clientScripts ?? [])]),
    dataPatches: Object.freeze([...(input.dataPatches ?? [])]),
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
