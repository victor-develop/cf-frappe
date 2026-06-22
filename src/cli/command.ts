/// <reference types="node" />
import { relative } from "node:path";
import {
  AppInstallError,
  planInstallAppModule,
  writeInstallDependency,
  writeInstallRegistry,
  type InstallAppModuleResult
} from "./app-install.js";
import {
  generateD1MigrationFiles,
  MigrationGenerateError,
  type GenerateD1MigrationFilesResult,
  type MigrationRegistryLoader
} from "./migration-generate.js";
import { PackageJsonError } from "./package-json.js";
import {
  createNodePackageManagerRunner,
  PackageManagerError,
  type PackageManagerInstallResult,
  type PackageManagerName,
  type PackageManagerRunner
} from "./package-manager.js";
import { scaffoldProject, ScaffoldError } from "./scaffold.js";

export interface CliIo {
  readonly cwd: () => string;
  readonly migrationRegistryLoader?: MigrationRegistryLoader;
  readonly packageManager?: PackageManagerRunner;
  readonly stderr: WritableText;
  readonly stdout: WritableText;
}

export interface WritableText {
  write(chunk: string): unknown;
}

interface InitCommand {
  readonly kind: "init";
  readonly targetDirectory: string;
  readonly force: boolean;
}

interface InstallCommand {
  readonly kind: "install";
  readonly moduleSpecifier: string;
  readonly exportName?: string;
  readonly dependencyVersion?: string;
  readonly localName?: string;
  readonly packageManager?: PackageManagerName;
  readonly runPackageManager: boolean;
  readonly saveDependency: boolean;
  readonly registryFile?: string;
}

interface MigrateGenerateCommand {
  readonly kind: "migrate-generate";
  readonly includeCore: boolean;
  readonly migrationsDir?: string;
  readonly registryFile?: string;
}

interface HelpCommand {
  readonly kind: "help";
}

interface InvalidCommand {
  readonly kind: "invalid";
  readonly message: string;
}

type ParsedCommand = InitCommand | InstallCommand | MigrateGenerateCommand | HelpCommand | InvalidCommand;

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const command = parseCliArgs(argv);
  if (command.kind === "help") {
    io.stdout.write(helpText());
    return 0;
  }
  if (command.kind === "invalid") {
    io.stderr.write(`cf-frappe: ${command.message}\n\n${helpText()}`);
    return 1;
  }

  try {
    if (command.kind === "install") {
      const installOptions = {
        cwd: io.cwd(),
        moduleSpecifier: command.moduleSpecifier,
        saveDependency: command.saveDependency,
        ...(command.dependencyVersion === undefined ? {} : { dependencyVersion: command.dependencyVersion }),
        ...(command.exportName === undefined ? {} : { exportName: command.exportName }),
        ...(command.localName === undefined ? {} : { localName: command.localName }),
        ...(command.registryFile === undefined ? {} : { registryFile: command.registryFile })
      };
      const result = await planInstallAppModule(installOptions);
      await writeInstallDependency(result);
      const packageManagerResult = command.runPackageManager && result.dependency !== undefined
        ? await (io.packageManager ?? createNodePackageManagerRunner(io)).install({
            cwd: io.cwd(),
            ...(command.packageManager === undefined ? {} : { packageManager: command.packageManager })
          })
        : undefined;
      const registryResult = packageManagerResult === undefined
        ? result
        : await planInstallAppModule(installOptions);
      await writeInstallRegistry(registryResult);
      io.stdout.write(installSuccessText(result, {
        runPackageManager: command.runPackageManager,
        ...(packageManagerResult === undefined ? {} : { packageManager: packageManagerResult })
      }));
      return 0;
    }
    if (command.kind === "migrate-generate") {
      const result = await generateD1MigrationFiles({
        cwd: io.cwd(),
        includeCore: command.includeCore,
        ...(command.migrationsDir === undefined ? {} : { migrationsDir: command.migrationsDir }),
        ...(command.registryFile === undefined ? {} : { registryFile: command.registryFile }),
        ...(io.migrationRegistryLoader === undefined ? {} : { registryLoader: io.migrationRegistryLoader })
      });
      io.stdout.write(migrationGenerateSuccessText(result));
      return 0;
    }
    const result = await scaffoldProject({
      cwd: io.cwd(),
      force: command.force,
      targetDirectory: command.targetDirectory
    });
    const projectPath = displayPath(io.cwd(), result.projectDirectory);
    io.stdout.write(
      [
        `Created cf-frappe app at ${projectPath}`,
        "",
        "Next steps:",
        `  cd ${shellQuote(projectPath)}`,
        "  npm install",
        "  cp .dev.vars.example .dev.vars",
        "  npm run cf:types",
        "  npm run d1:migrate:local",
        "  npm run dev",
        ""
      ].join("\n")
    );
    return 0;
  } catch (error) {
    if (
      error instanceof ScaffoldError ||
      error instanceof AppInstallError ||
      error instanceof MigrationGenerateError ||
      error instanceof PackageJsonError ||
      error instanceof PackageManagerError
    ) {
      io.stderr.write(`cf-frappe: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

export function parseCliArgs(argv: readonly string[]): ParsedCommand {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    return { kind: "help" };
  }
  if (command === "install") {
    return parseInstallArgs(rest);
  }
  if (command === "migrate") {
    return parseMigrateArgs(rest);
  }
  if (command !== "init") {
    return { kind: "invalid", message: `Unknown command '${command}'` };
  }
  return parseInitArgs(rest);
}

function parseMigrateArgs(argv: readonly string[]): ParsedCommand {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    return { kind: "help" };
  }
  if (subcommand !== "generate") {
    return { kind: "invalid", message: `Unknown migrate command '${subcommand}'` };
  }
  let includeCore = true;
  let migrationsDir: string | undefined;
  let registryFile: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === undefined) {
      break;
    }
    if (arg === "--help" || arg === "-h") {
      return { kind: "help" };
    }
    if (arg === "--no-core") {
      includeCore = false;
      continue;
    }
    if (arg === "--registry") {
      const value = rest[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --registry" };
      }
      registryFile = value;
      index += 1;
      continue;
    }
    if (arg === "--migrations") {
      const value = rest[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --migrations" };
      }
      migrationsDir = value;
      index += 1;
      continue;
    }
    return { kind: "invalid", message: `Unknown migrate generate option '${arg}'` };
  }
  return {
    kind: "migrate-generate",
    includeCore,
    ...(migrationsDir === undefined ? {} : { migrationsDir }),
    ...(registryFile === undefined ? {} : { registryFile })
  };
}

function parseInitArgs(argv: readonly string[]): ParsedCommand {
  let targetDirectory: string | undefined;
  let force = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      return { kind: "help" };
    }
    if (arg === "--force" || arg === "-f") {
      force = true;
      continue;
    }
    if (arg.startsWith("-")) {
      return { kind: "invalid", message: `Unknown init option '${arg}'` };
    }
    if (targetDirectory !== undefined) {
      return { kind: "invalid", message: "Expected exactly one project directory" };
    }
    targetDirectory = arg;
  }

  if (targetDirectory === undefined) {
    return { kind: "invalid", message: "Missing project directory" };
  }
  return { kind: "init", targetDirectory, force };
}

function parseInstallArgs(argv: readonly string[]): ParsedCommand {
  let moduleSpecifier: string | undefined;
  let dependencyVersion: string | undefined;
  let exportName: string | undefined;
  let localName: string | undefined;
  let packageManager: PackageManagerName | undefined;
  let runPackageManager = true;
  let saveDependency = true;
  let registryFile: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      break;
    }
    if (arg === "--help" || arg === "-h") {
      return { kind: "help" };
    }
    if (arg === "--export") {
      const value = argv[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --export" };
      }
      exportName = value;
      index += 1;
      continue;
    }
    if (arg === "--version") {
      const value = argv[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --version" };
      }
      dependencyVersion = value;
      index += 1;
      continue;
    }
    if (arg === "--as") {
      const value = argv[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --as" };
      }
      localName = value;
      index += 1;
      continue;
    }
    if (arg === "--no-save") {
      saveDependency = false;
      continue;
    }
    if (arg === "--no-install") {
      runPackageManager = false;
      continue;
    }
    if (arg === "--package-manager") {
      const value = argv[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --package-manager" };
      }
      const parsed = packageManagerName(value);
      if (parsed === undefined) {
        return { kind: "invalid", message: `Unsupported package manager '${value}'` };
      }
      packageManager = parsed;
      index += 1;
      continue;
    }
    if (arg === "--registry") {
      const value = argv[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --registry" };
      }
      registryFile = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      return { kind: "invalid", message: `Unknown install option '${arg}'` };
    }
    if (moduleSpecifier !== undefined) {
      return { kind: "invalid", message: "Expected exactly one app module" };
    }
    moduleSpecifier = arg;
  }

  if (moduleSpecifier === undefined) {
    return { kind: "invalid", message: "Missing app module" };
  }
  if (!saveDependency && dependencyVersion !== undefined) {
    return { kind: "invalid", message: "Cannot combine --version with --no-save" };
  }
  if (!runPackageManager && packageManager !== undefined) {
    return { kind: "invalid", message: "Cannot combine --package-manager with --no-install" };
  }
  return {
    kind: "install",
    moduleSpecifier,
    runPackageManager,
    saveDependency,
    ...(dependencyVersion === undefined ? {} : { dependencyVersion }),
    ...(exportName === undefined ? {} : { exportName }),
    ...(localName === undefined ? {} : { localName }),
    ...(packageManager === undefined ? {} : { packageManager }),
    ...(registryFile === undefined ? {} : { registryFile })
  };
}

function helpText(): string {
  return [
    "cf-frappe",
    "",
    "Usage:",
    "  cf-frappe init <directory> [--force]",
    "  cf-frappe install <module> [--version <range>] [--export <name>] [--as <localName>] [--registry <path>] [--package-manager <npm|pnpm|yarn|bun>] [--no-install] [--no-save]",
    "  cf-frappe migrate generate [--registry <path>] [--migrations <dir>] [--no-core]",
    "  cf-frappe --help",
    "",
    "Commands:",
    "  init   Create a Cloudflare-ready cf-frappe starter app",
    "  install   Save, install, and wire an app module into a generated app registry",
    "  migrate generate   Write reviewable D1 migration files from app metadata",
    ""
  ].join("\n");
}

function migrationGenerateSuccessText(result: GenerateD1MigrationFilesResult): string {
  const lines = [`Planned D1 migrations from ${result.registryFile} into ${result.migrationsDir}`];
  if (result.generated.length === 0) {
    lines.push("No new migration files were needed.");
    return `${lines.join("\n")}\n`;
  }
  for (const file of result.generated) {
    lines.push(`Wrote ${file.path} (${file.migration.statements.length} statements)`);
  }
  return `${lines.join("\n")}\n`;
}

function installSuccessText(
  result: InstallAppModuleResult,
  options: {
    readonly runPackageManager: boolean;
    readonly packageManager?: PackageManagerInstallResult;
  }
): string {
  const lines = [`Wired ${result.moduleSpecifier} as ${result.localName} into ${result.registryFile}`];
  if (result.dependency !== undefined) {
    const status = result.dependency.changed ? "Saved" : "Kept";
    lines.push(`${status} dependency ${result.dependency.packageName}@${result.dependency.version} in ${result.dependency.packageJsonFile}`);
    if (options.packageManager !== undefined) {
      lines.push(`Ran ${options.packageManager.command} ${options.packageManager.args.join(" ")} to update node_modules and lockfile.`);
    } else if (options.runPackageManager) {
      lines.push("No package manager run was needed.");
    } else {
      lines.push("Skipped package manager install; run your package manager to update node_modules and lockfile.");
    }
  }
  return `${lines.join("\n")}\n`;
}

function packageManagerName(value: string): PackageManagerName | undefined {
  return value === "npm" || value === "pnpm" || value === "yarn" || value === "bun" ? value : undefined;
}

function displayPath(cwd: string, projectDirectory: string): string {
  const relativePath = relative(cwd, projectDirectory);
  return relativePath === "" ? "." : relativePath;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
