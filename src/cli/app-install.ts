/// <reference types="node" />
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { planPackageDependencyUpdate, type PackageDependencyPlan } from "./package-json.js";

const DEFAULT_REGISTRY_FILE = "src/apps/index.ts";
const IMPORTS_START = "/* cf-frappe app imports:start */";
const IMPORTS_END = "/* cf-frappe app imports:end */";
const APPS_START = "/* cf-frappe apps:start */";
const APPS_END = "/* cf-frappe apps:end */";
const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export interface InstallAppModuleOptions {
  readonly cwd?: string;
  readonly moduleSpecifier: string;
  readonly exportName?: string;
  readonly localName?: string;
  readonly packageJsonFile?: string;
  readonly dependencyVersion?: string;
  readonly saveDependency?: boolean;
  readonly registryFile?: string;
}

export interface InstallAppModuleResult {
  readonly registryFile: string;
  readonly moduleSpecifier: string;
  readonly localName: string;
  readonly exportName?: string;
  readonly dependency?: InstallDependencyResult;
}

export interface InstallAppModulePlan extends InstallAppModuleResult {
  readonly registryPath: string;
  readonly registryContents: string;
  readonly dependencyPackageJsonPath?: string;
  readonly dependencyPlan?: PackageDependencyPlan;
}

export interface InstallDependencyResult {
  readonly packageJsonFile: string;
  readonly packageName: string;
  readonly version: string;
  readonly changed: boolean;
}

export class AppInstallError extends Error {
  constructor(
    message: string,
    readonly code: "invalid-module" | "invalid-identifier" | "registry-not-found" | "registry-invalid" | "app-duplicate"
  ) {
    super(message);
    this.name = "AppInstallError";
  }
}

export async function installAppModule(options: InstallAppModuleOptions): Promise<InstallAppModuleResult> {
  const plan = await planInstallAppModule(options);
  await writeInstallDependency(plan);
  await writeInstallRegistry(plan);
  return installResult(plan);
}

export async function planInstallAppModule(options: InstallAppModuleOptions): Promise<InstallAppModulePlan> {
  const moduleSpecifier = options.moduleSpecifier.trim();
  if (moduleSpecifier.length === 0) {
    throw new AppInstallError("App module is required", "invalid-module");
  }
  const exportName = normalizeOptionalIdentifier(options.exportName, "export");
  const localName = normalizeIdentifier(options.localName ?? localNameForModule(moduleSpecifier), "local name");
  const registryFile = options.registryFile ?? DEFAULT_REGISTRY_FILE;
  const registryPath = resolve(options.cwd ?? ".", registryFile);
  const source = await readRegistryFile(registryPath);
  const importLine = appImportLine({ moduleSpecifier, exportName, localName });
  if (source.includes(`from ${JSON.stringify(moduleSpecifier)}`)) {
    throw new AppInstallError(`App module '${moduleSpecifier}' is already installed`, "app-duplicate");
  }
  if (blockContainsIdentifier(blockBetween(source, APPS_START, APPS_END), localName)) {
    throw new AppInstallError(`App local name '${localName}' is already installed`, "app-duplicate");
  }
  const dependencyPlan = options.saveDependency === false
    ? undefined
    : await planPackageDependencyUpdate({
        moduleSpecifier,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.packageJsonFile === undefined ? {} : { packageJsonFile: options.packageJsonFile }),
        ...(options.dependencyVersion === undefined ? {} : { version: options.dependencyVersion })
      });
  const withImport = insertBeforeMarker(source, IMPORTS_END, `${importLine}\n`);
  const withApp = insertBeforeMarker(withImport, APPS_END, `  ${localName},\n`);
  return {
    registryFile,
    registryPath,
    registryContents: withApp,
    moduleSpecifier,
    localName,
    ...(exportName === undefined ? {} : { exportName }),
    ...(dependencyPlan === undefined
      ? {}
      : {
          dependency: dependencyResult(dependencyPlan),
          dependencyPackageJsonPath: resolve(options.cwd ?? ".", dependencyPlan.packageJsonFile),
          dependencyPlan
        })
  };
}

export async function writeInstallDependency(plan: InstallAppModulePlan): Promise<void> {
  if (plan.dependencyPlan !== undefined && plan.dependencyPlan.changed && plan.dependencyPackageJsonPath !== undefined) {
    await writeFile(plan.dependencyPackageJsonPath, plan.dependencyPlan.contents, "utf8");
  }
}

export async function writeInstallRegistry(plan: InstallAppModulePlan): Promise<void> {
  await writeFile(plan.registryPath, plan.registryContents, "utf8");
}

function appImportLine(options: {
  readonly moduleSpecifier: string;
  readonly exportName: string | undefined;
  readonly localName: string;
}): string {
  const specifier = JSON.stringify(options.moduleSpecifier);
  if (options.exportName === undefined) {
    return `import ${options.localName} from ${specifier};`;
  }
  if (options.exportName === options.localName) {
    return `import { ${options.exportName} } from ${specifier};`;
  }
  return `import { ${options.exportName} as ${options.localName} } from ${specifier};`;
}

function installResult(plan: InstallAppModulePlan): InstallAppModuleResult {
  return {
    registryFile: plan.registryFile,
    moduleSpecifier: plan.moduleSpecifier,
    localName: plan.localName,
    ...(plan.exportName === undefined ? {} : { exportName: plan.exportName }),
    ...(plan.dependency === undefined ? {} : { dependency: plan.dependency })
  };
}

function dependencyResult(plan: PackageDependencyPlan): InstallDependencyResult {
  return {
    packageJsonFile: plan.packageJsonFile,
    packageName: plan.packageName,
    version: plan.version,
    changed: plan.changed
  };
}

async function readRegistryFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new AppInstallError(`App registry '${path}' was not found`, "registry-not-found");
    }
    throw error;
  }
}

function insertBeforeMarker(source: string, marker: string, insertion: string): string {
  const index = source.indexOf(marker);
  if (index === -1) {
    throw new AppInstallError(`App registry is missing marker '${marker}'`, "registry-invalid");
  }
  return `${source.slice(0, index)}${insertion}${source.slice(index)}`;
}

function blockBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new AppInstallError("App registry install markers are invalid", "registry-invalid");
  }
  return source.slice(start + startMarker.length, end);
}

function normalizeOptionalIdentifier(value: string | undefined, label: string): string | undefined {
  return value === undefined ? undefined : normalizeIdentifier(value, label);
}

function normalizeIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!identifierPattern.test(normalized)) {
    throw new AppInstallError(`App ${label} '${value}' is not a valid TypeScript identifier`, "invalid-identifier");
  }
  return normalized;
}

function localNameForModule(moduleSpecifier: string): string {
  const leaf = moduleSpecifier.split("/").filter(Boolean).at(-1) ?? "installed";
  const words = leaf.split(/[^A-Za-z0-9_$]+/).filter(Boolean);
  const base = words.length === 0
    ? "installed"
    : words
        .map((word, index) => index === 0 ? word : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
        .join("");
  const identifier = `${base.replace(/^[^A-Za-z_$]+/, "")}App`;
  return identifierPattern.test(identifier) ? identifier : "installedApp";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blockContainsIdentifier(source: string, identifier: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(identifier)}([^A-Za-z0-9_$]|$)`).test(source);
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
