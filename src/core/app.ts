import { assertAppName, assertAppNames } from "./app-name.js";
import { resolveAppDependencyOrder } from "./app-graph.js";
import type { ClientScriptDefinition } from "./client-script.js";
import type { DataPatchDefinition } from "./data-patch.js";
import { createRegistry, type DocumentHooks, type ModelRegistry, type RegistryOptions } from "./registry.js";
import type { PrintFormatDefinition, PrintLetterheadDefinition } from "./print-format.js";
import type { ReportDefinition } from "./reports.js";
import type { DocTypeDefinition } from "./types.js";
import type { WorkspaceDefinition } from "./workspace.js";

export interface FrameworkAppDefinition {
  readonly name: string;
  readonly label?: string;
  readonly version?: string;
  readonly modules?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly doctypes?: readonly DocTypeDefinition[];
  readonly letterheads?: readonly PrintLetterheadDefinition[];
  readonly printFormats?: readonly PrintFormatDefinition[];
  readonly reports?: readonly ReportDefinition[];
  readonly workspaces?: readonly WorkspaceDefinition[];
  readonly clientScripts?: readonly ClientScriptDefinition[];
  readonly dataPatches?: readonly DataPatchDefinition[];
  readonly hooks?: Readonly<Record<string, readonly DocumentHooks[]>>;
}

export interface InstalledAppDefinition {
  readonly name: string;
  readonly label?: string;
  readonly version?: string;
  readonly modules: readonly string[];
  readonly dependencies: readonly string[];
}

export function defineApp(input: FrameworkAppDefinition): FrameworkAppDefinition {
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
    workspaces: Object.freeze([...(input.workspaces ?? [])]),
    clientScripts: Object.freeze([...(input.clientScripts ?? [])]),
    dataPatches: Object.freeze([...(input.dataPatches ?? [])]),
    hooks: freezeHooks(input.hooks ?? {})
  });
}

export function createRegistryFromApps(apps: readonly FrameworkAppDefinition[]): ModelRegistry {
  return createRegistry(registryOptionsFromApps(apps));
}

export function registryOptionsFromApps(apps: readonly FrameworkAppDefinition[]): RegistryOptions {
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
    workspaces: orderedApps.flatMap((app) => app.workspaces ?? []),
    clientScripts: orderedApps.flatMap((app) => app.clientScripts ?? []),
    dataPatches: orderedApps.flatMap((app) => app.dataPatches ?? []),
    hooks
  };
}

export function resolveAppInstallOrder(apps: readonly FrameworkAppDefinition[]): readonly FrameworkAppDefinition[] {
  return resolveAppDependencyOrder(apps);
}

function installedAppFromDefinition(app: FrameworkAppDefinition): InstalledAppDefinition {
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
