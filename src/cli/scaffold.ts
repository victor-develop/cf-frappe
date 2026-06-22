/// <reference types="node" />
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { starterProjectFiles } from "./templates.js";

const DEFAULT_COMPATIBILITY_DATE = "2026-06-22";

export interface ScaffoldProjectOptions {
  readonly targetDirectory: string;
  readonly cwd?: string;
  readonly force?: boolean;
  readonly compatibilityDate?: string;
  readonly cfFrappeVersion?: string;
  readonly nodeTypesVersion?: string;
  readonly typescriptVersion?: string;
  readonly tsxVersion?: string;
  readonly wranglerVersion?: string;
}

export interface ScaffoldProjectResult {
  readonly projectDirectory: string;
  readonly projectName: string;
  readonly files: readonly string[];
}

export class ScaffoldError extends Error {
  constructor(
    message: string,
    readonly code: "invalid-target" | "target-not-empty" | "target-is-file"
  ) {
    super(message);
    this.name = "ScaffoldError";
  }
}

interface PackageMetadata {
  readonly cfFrappeVersion: string;
  readonly nodeTypesVersion: string;
  readonly typescriptVersion: string;
  readonly tsxVersion: string;
  readonly wranglerVersion: string;
}

export async function scaffoldProject(options: ScaffoldProjectOptions): Promise<ScaffoldProjectResult> {
  const rawTarget = options.targetDirectory.trim();
  if (rawTarget.length === 0) {
    throw new ScaffoldError("Project directory is required", "invalid-target");
  }

  const projectDirectory = resolve(options.cwd ?? ".", rawTarget);
  const existingEntries = await readDirectory(projectDirectory);
  if (existingEntries?.kind === "file") {
    throw new ScaffoldError(`Target '${projectDirectory}' already exists and is not a directory`, "target-is-file");
  }
  if (existingEntries && existingEntries.entries.length > 0 && !options.force) {
    throw new ScaffoldError(
      `Target '${projectDirectory}' is not empty. Re-run with --force to overwrite scaffold files.`,
      "target-not-empty"
    );
  }

  const metadata = await packageMetadata(options);
  const projectName = normalizeName(basename(projectDirectory), "cf-frappe-app");
  const files = starterProjectFiles({
    cfFrappeVersion: metadata.cfFrappeVersion,
    compatibilityDate: options.compatibilityDate ?? DEFAULT_COMPATIBILITY_DATE,
    databaseName: `${projectName}-db`,
    nodeTypesVersion: metadata.nodeTypesVersion,
    packageName: projectName,
    projectName,
    typescriptVersion: metadata.typescriptVersion,
    tsxVersion: metadata.tsxVersion,
    wranglerVersion: metadata.wranglerVersion
  });

  await mkdir(projectDirectory, { recursive: true });
  for (const file of files) {
    const destination = join(projectDirectory, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.contents, {
      encoding: "utf8",
      flag: options.force ? "w" : "wx"
    });
  }

  return {
    files: files.map((file) => file.path),
    projectDirectory,
    projectName
  };
}

function normalizeName(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  return normalized.length > 0 ? normalized : fallback;
}

async function readDirectory(path: string): Promise<{ readonly kind: "directory"; readonly entries: readonly string[] } | { readonly kind: "file" } | null> {
  try {
    return { kind: "directory", entries: await readdir(path) };
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    if (isNodeError(error, "ENOTDIR")) {
      return { kind: "file" };
    }
    throw error;
  }
}

async function packageMetadata(options: ScaffoldProjectOptions): Promise<PackageMetadata> {
  const rootPackage = await readRootPackageJson();
  return {
    cfFrappeVersion: options.cfFrappeVersion ?? stringField(rootPackage.version, "0.1.0"),
    nodeTypesVersion: options.nodeTypesVersion ?? dependencyVersion(rootPackage, "@types/node", "^26.0.0"),
    typescriptVersion: options.typescriptVersion ?? dependencyVersion(rootPackage, "typescript", "^5.7.2"),
    tsxVersion: options.tsxVersion ?? dependencyVersion(rootPackage, "tsx", "^4.20.6"),
    wranglerVersion: options.wranglerVersion ?? dependencyVersion(rootPackage, "wrangler", "^4.103.0")
  };
}

async function readRootPackageJson(): Promise<Record<string, unknown>> {
  const raw = await readFirstExistingFile([
    new URL("../../package.json", import.meta.url),
    new URL("../../../package.json", import.meta.url)
  ]);
  const parsed = JSON.parse(raw) as unknown;
  return isRecord(parsed) ? parsed : {};
}

async function readFirstExistingFile(urls: readonly URL[]): Promise<string> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await readFile(url, "utf8");
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to locate package.json");
}

function dependencyVersion(packageJson: Record<string, unknown>, name: string, fallback: string): string {
  const devDependencies = packageJson.devDependencies;
  if (!isRecord(devDependencies)) {
    return fallback;
  }
  return stringField(devDependencies[name], fallback);
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}
