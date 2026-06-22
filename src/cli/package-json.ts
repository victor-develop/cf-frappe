/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_PACKAGE_JSON_FILE = "package.json";
const DEFAULT_DEPENDENCY_VERSION = "latest";

export interface PackageDependencyPlanOptions {
  readonly cwd?: string;
  readonly moduleSpecifier: string;
  readonly packageJsonFile?: string;
  readonly version?: string;
}

export interface PackageDependencyPlan {
  readonly packageJsonFile: string;
  readonly packageName: string;
  readonly version: string;
  readonly changed: boolean;
  readonly contents: string;
}

export class PackageJsonError extends Error {
  constructor(
    message: string,
    readonly code: "invalid-package" | "invalid-version" | "package-json-not-found" | "package-json-invalid"
  ) {
    super(message);
    this.name = "PackageJsonError";
  }
}

export async function planPackageDependencyUpdate(
  options: PackageDependencyPlanOptions
): Promise<PackageDependencyPlan | undefined> {
  const packageName = packageNameFromModuleSpecifier(options.moduleSpecifier);
  if (packageName === undefined) {
    if (options.version !== undefined) {
      throw new PackageJsonError(
        `Cannot save non-package module '${options.moduleSpecifier}' with --version`,
        "invalid-package"
      );
    }
    return undefined;
  }

  const packageJsonFile = options.packageJsonFile ?? DEFAULT_PACKAGE_JSON_FILE;
  const packageJsonPath = resolve(options.cwd ?? ".", packageJsonFile);
  const raw = await readPackageJson(packageJsonPath);
  const parsed = parsePackageJson(raw, packageJsonPath);
  const existingDependencies = dependencyRecord(parsed, packageJsonPath);
  const existingVersion = existingDependencies[packageName];
  const version = normalizeVersion(
    options.version ?? (typeof existingVersion === "string" ? existingVersion : DEFAULT_DEPENDENCY_VERSION)
  );
  const dependencies = sortedRecord({
    ...existingDependencies,
    [packageName]: version
  });
  const nextPackage = { ...parsed, dependencies };
  const contents = `${JSON.stringify(nextPackage, null, 2)}\n`;
  return {
    packageJsonFile,
    packageName,
    version,
    changed: contents !== raw,
    contents
  };
}

function packageNameFromModuleSpecifier(moduleSpecifier: string): string | undefined {
  if (
    moduleSpecifier.startsWith(".") ||
    moduleSpecifier.startsWith("/") ||
    moduleSpecifier.startsWith("#") ||
    moduleSpecifier.includes(":")
  ) {
    return undefined;
  }
  const parts = moduleSpecifier.split("/").filter(Boolean);
  if (moduleSpecifier.startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
  }
  return parts[0];
}

async function readPackageJson(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new PackageJsonError(`Package manifest '${path}' was not found`, "package-json-not-found");
    }
    throw error;
  }
}

function parsePackageJson(raw: string, path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PackageJsonError(`Package manifest '${path}' is invalid JSON: ${detail}`, "package-json-invalid");
  }
  if (!isRecord(parsed)) {
    throw new PackageJsonError(`Package manifest '${path}' must contain a JSON object`, "package-json-invalid");
  }
  return parsed;
}

function dependencyRecord(packageJson: Record<string, unknown>, path: string): Record<string, unknown> {
  const dependencies = packageJson.dependencies;
  if (dependencies === undefined) {
    return {};
  }
  if (!isRecord(dependencies)) {
    throw new PackageJsonError(
      `Package manifest '${path}' has non-object dependencies`,
      "package-json-invalid"
    );
  }
  return dependencies;
}

function normalizeVersion(value: string): string {
  const version = value.trim();
  if (version.length === 0) {
    throw new PackageJsonError("Package dependency version is required", "invalid-version");
  }
  return version;
}

function sortedRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}
