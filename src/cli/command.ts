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
import {
  DataPatchRemoteError,
  runRemoteDataPatchCommand,
  type DataPatchHeaderOption,
  type DataPatchRemoteAction,
  type DataPatchRemoteCommand
} from "./data-patches.js";
import { scaffoldProject, ScaffoldError } from "./scaffold.js";

export interface CliIo {
  readonly cwd: () => string;
  readonly env?: (name: string) => string | undefined;
  readonly fetch?: typeof fetch;
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

type ParsedCommand =
  | InitCommand
  | InstallCommand
  | MigrateGenerateCommand
  | DataPatchRemoteCommand
  | HelpCommand
  | InvalidCommand;

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
    if (command.kind === "data-patches") {
      io.stdout.write(await runRemoteDataPatchCommand(command, {
        ...(io.env === undefined ? {} : { env: io.env }),
        ...(io.fetch === undefined ? {} : { fetch: io.fetch })
      }));
      return 0;
    }
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
      error instanceof PackageManagerError ||
      error instanceof DataPatchRemoteError
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
  if (command === "data-patches") {
    return parseDataPatchesArgs(rest);
  }
  if (command !== "init") {
    return { kind: "invalid", message: `Unknown command '${command}'` };
  }
  return parseInitArgs(rest);
}

function parseDataPatchesArgs(argv: readonly string[]): ParsedCommand {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    return { kind: "help" };
  }
  const action = dataPatchAction(subcommand);
  if (action === undefined) {
    return { kind: "invalid", message: `Unknown data-patches command '${subcommand}'` };
  }

  let url: string | undefined;
  const headers: DataPatchHeaderOption[] = [];
  const patchIds: string[] = [];
  let limit: number | undefined;
  let idempotencyKey: string | undefined;
  let delaySeconds: number | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === undefined) {
      break;
    }
    if (arg === "--help" || arg === "-h") {
      return { kind: "help" };
    }
    if (arg === "--url") {
      const value = rest[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --url" };
      }
      url = value;
      index += 1;
      continue;
    }
    if (arg === "--header") {
      const value = rest[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --header" };
      }
      const parsed = parseLiteralHeader(value);
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      headers.push(parsed);
      index += 1;
      continue;
    }
    if (arg === "--header-env") {
      const value = rest[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --header-env" };
      }
      const parsed = parseEnvHeader(value);
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      headers.push(parsed);
      index += 1;
      continue;
    }
    if (arg === "--id") {
      if (action === "status") {
        return { kind: "invalid", message: "Cannot use --id with data-patches status" };
      }
      const value = rest[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --id" };
      }
      patchIds.push(value);
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      if (action === "status" || action === "retry") {
        return { kind: "invalid", message: `Cannot use --limit with data-patches ${action}` };
      }
      const value = rest[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --limit" };
      }
      const parsed = parsePositiveInteger(value, "Data patch apply limit");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      limit = parsed;
      index += 1;
      continue;
    }
    if (arg === "--idempotency-key") {
      if (action !== "enqueue") {
        return { kind: "invalid", message: "Can only use --idempotency-key with data-patches enqueue" };
      }
      const value = rest[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --idempotency-key" };
      }
      if (value.trim().length === 0) {
        return { kind: "invalid", message: "Data patch idempotency key must be non-empty" };
      }
      idempotencyKey = value;
      index += 1;
      continue;
    }
    if (arg === "--delay-seconds") {
      if (action !== "enqueue") {
        return { kind: "invalid", message: "Can only use --delay-seconds with data-patches enqueue" };
      }
      const value = rest[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --delay-seconds" };
      }
      const parsed = parseNonNegativeInteger(value, "Data patch enqueue delay");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      delaySeconds = parsed;
      index += 1;
      continue;
    }
    return { kind: "invalid", message: `Unknown data-patches ${action} option '${arg}'` };
  }

  if (url === undefined) {
    return { kind: "invalid", message: "Missing value for --url" };
  }
  if (action === "retry" && patchIds.length !== 1) {
    return { kind: "invalid", message: "Data patch retry requires exactly one --id" };
  }
  return {
    kind: "data-patches",
    action,
    url,
    headers,
    ...(patchIds.length === 0 ? {} : { patchIds }),
    ...(limit === undefined ? {} : { limit }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(delaySeconds === undefined ? {} : { delaySeconds })
  };
}

function dataPatchAction(value: string): DataPatchRemoteAction | undefined {
  return value === "status" ||
    value === "plan" ||
    value === "rollback-plan" ||
    value === "apply" ||
    value === "enqueue" ||
    value === "retry"
    ? value
    : undefined;
}

function parseLiteralHeader(value: string): DataPatchHeaderOption | string {
  const separator = value.indexOf(":");
  if (separator < 1) {
    return "Data patch header must use 'Name: value' syntax";
  }
  const name = value.slice(0, separator).trim();
  const headerValue = value.slice(separator + 1).trim();
  if (!isHttpHeaderName(name)) {
    return `Data patch header name '${name}' is invalid`;
  }
  if (headerValue.length === 0) {
    return `Data patch header '${name}' must have a non-empty value`;
  }
  return { kind: "literal", name, value: headerValue };
}

function parseEnvHeader(value: string): DataPatchHeaderOption | string {
  const separator = value.indexOf("=");
  if (separator < 1) {
    return "Data patch environment header must use 'Name=ENV_VAR' syntax";
  }
  const name = value.slice(0, separator).trim();
  const envName = value.slice(separator + 1).trim();
  if (!isHttpHeaderName(name)) {
    return `Data patch header name '${name}' is invalid`;
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) {
    return `Data patch header env var '${envName}' is invalid`;
  }
  return { kind: "env", name, envName };
}

function parsePositiveInteger(value: string, label: string): number | string {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : `${label} must be a positive integer`;
}

function parseNonNegativeInteger(value: string, label: string): number | string {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : `${label} must be a non-negative integer`;
}

function isHttpHeaderName(value: string): boolean {
  return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value);
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
    "  cf-frappe data-patches status --url <origin> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe data-patches plan --url <origin> [--id <patchId>] [--limit <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe data-patches rollback-plan --url <origin> [--id <patchId>] [--limit <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe data-patches apply --url <origin> [--id <patchId>] [--limit <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe data-patches retry --url <origin> --id <patchId> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe data-patches enqueue --url <origin> [--id <patchId>] [--limit <n>] [--idempotency-key <key>] [--delay-seconds <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe --help",
    "",
    "Commands:",
    "  init   Create a Cloudflare-ready cf-frappe starter app",
    "  install   Save, install, and wire an app module into a generated app registry",
    "  migrate generate   Write reviewable D1 migration files from app metadata",
    "  data-patches   Inspect, plan, apply, or enqueue remote app-declared data patches through the admin API",
    "",
    "Use --header-env for secret-bearing auth headers so tokens stay out of shell history.",
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
