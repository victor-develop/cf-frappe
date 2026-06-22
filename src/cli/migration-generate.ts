/// <reference types="node" />
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { DocTypeDefinition } from "../core/types";
import type { ModelRegistry } from "../core/registry";
import { planD1Migrations, renderD1MigrationFile, type D1Migration } from "../adapters/d1/schema-planner.js";

const DEFAULT_REGISTRY_FILE = "src/apps/index.ts";
const DEFAULT_MIGRATIONS_DIR = "migrations";

export interface MigrationRegistryLoader {
  load(options: MigrationRegistryLoadOptions): Promise<ModelRegistry>;
}

export interface MigrationRegistryLoadOptions {
  readonly cwd: string;
  readonly registryFile: string;
}

export interface GenerateD1MigrationFilesOptions {
  readonly cwd?: string;
  readonly registryFile?: string;
  readonly migrationsDir?: string;
  readonly includeCore?: boolean;
  readonly registryLoader?: MigrationRegistryLoader;
}

export interface GeneratedD1MigrationFile {
  readonly migration: D1Migration;
  readonly path: string;
}

export interface GenerateD1MigrationFilesResult {
  readonly registryFile: string;
  readonly migrationsDir: string;
  readonly generated: readonly GeneratedD1MigrationFile[];
  readonly skipped: readonly string[];
}

export class MigrationGenerateError extends Error {
  constructor(
    message: string,
    readonly code: "registry-invalid" | "checksum-mismatch"
  ) {
    super(message);
    this.name = "MigrationGenerateError";
  }
}

export async function generateD1MigrationFiles(
  options: GenerateD1MigrationFilesOptions = {}
): Promise<GenerateD1MigrationFilesResult> {
  const cwd = options.cwd ?? ".";
  const registryFile = options.registryFile ?? DEFAULT_REGISTRY_FILE;
  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const registry = await (options.registryLoader ?? dynamicMigrationRegistryLoader()).load({ cwd, registryFile });
  const migrations = planD1Migrations(registry.list(), { includeCore: options.includeCore ?? true });
  const migrationsPath = resolve(cwd, migrationsDir);
  const existing = await readExistingMigrationFiles(migrationsPath);
  const existingById = new Map(existing.flatMap((file) => file.migrationIds.map((id) => [id, file] as const)));
  let nextSequence = existing.reduce((highest, file) => Math.max(highest, file.sequence), 0) + 1;
  const generated: GeneratedD1MigrationFile[] = [];
  await mkdir(migrationsPath, { recursive: true });
  for (const migration of migrations) {
    const existingFile = existingById.get(migration.id);
    if (existingFile !== undefined) {
      assertExistingMigrationChecksum(migration, existingFile);
      continue;
    }
    const relativePath = `${migrationsDir}/${migrationFileName(nextSequence, migration.id)}`;
    await writeFile(resolve(cwd, relativePath), renderD1MigrationFile(migration), "utf8");
    generated.push({ migration, path: relativePath });
    nextSequence += 1;
  }
  return {
    registryFile,
    migrationsDir,
    generated,
    skipped: [...existingById.keys()].sort()
  };
}

export function dynamicMigrationRegistryLoader(): MigrationRegistryLoader {
  return {
    async load(options) {
      const moduleUrl = pathToFileURL(resolve(options.cwd, options.registryFile)).href;
      const loaded = await import(moduleUrl) as { readonly registry?: unknown; readonly default?: unknown };
      const registry = isRegistry(loaded.registry) ? loaded.registry : loaded.default;
      if (!isRegistry(registry)) {
        throw new MigrationGenerateError(
          `Registry module '${options.registryFile}' must export a ModelRegistry as 'registry' or default`,
          "registry-invalid"
        );
      }
      return registry;
    }
  };
}

function migrationFileName(sequence: number, id: string): string {
  const sequencePrefix = `${String(sequence).padStart(4, "0")}_`;
  return id.startsWith(sequencePrefix) ? `${id}.sql` : `${sequencePrefix}${id}.sql`;
}

interface ExistingMigrationFile {
  readonly checksum?: string;
  readonly filename: string;
  readonly migrationIds: readonly string[];
  readonly sequence: number;
}

async function readExistingMigrationFiles(
  migrationsPath: string
): Promise<readonly ExistingMigrationFile[]> {
  let entries: readonly string[];
  try {
    entries = await readdir(migrationsPath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
  const files = entries.flatMap((entry) => {
    const match = /^(\d{4})_(.+)\.sql$/u.exec(entry);
    if (match === null) {
      return [];
    }
    const basename = entry.slice(0, -".sql".length);
    return [{ filename: entry, sequence: Number(match[1]), migrationIds: [basename, match[2]!] }];
  });
  return Promise.all(files.map(async (file) => ({
    ...file,
    ...checksumFromFile(await readFile(resolve(migrationsPath, file.filename), "utf8"))
  })));
}

function checksumFromFile(contents: string): { readonly checksum?: string } {
  const match = /^-- checksum:\s*(\S+)\s*$/mu.exec(contents);
  return match === null ? {} : { checksum: match[1]! };
}

function assertExistingMigrationChecksum(migration: D1Migration, file: ExistingMigrationFile): void {
  if (file.checksum === undefined || file.checksum === migration.checksum) {
    return;
  }
  throw new MigrationGenerateError(
    `Existing migration file '${file.filename}' has checksum '${file.checksum}' but planned '${migration.checksum}' for '${migration.id}'. Bump the DocType version for a new migration or update the file deliberately.`,
    "checksum-mismatch"
  );
}

function isRegistry(value: unknown): value is ModelRegistry {
  return typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly list?: unknown }).list === "function" &&
    isDocTypeArray((value as { readonly list: () => unknown }).list());
}

function isDocTypeArray(value: unknown): value is readonly DocTypeDefinition[] {
  return Array.isArray(value) && value.every((item) =>
    typeof item === "object" &&
    item !== null &&
    typeof (item as { readonly name?: unknown }).name === "string" &&
    Array.isArray((item as { readonly fields?: unknown }).fields)
  );
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
