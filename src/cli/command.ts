/// <reference types="node" />
import { relative } from "node:path";
import { MAX_JOB_QUEUE_DELAY_SECONDS } from "../ports/job-queue.js";
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
  CloudflareAccessSetupError,
  runCloudflareAccessSetupCommand,
  type CloudflareAccessPolicyInclude,
  type CloudflareAccessSetupCommand,
  type CloudflareAccessSetupScope
} from "./access-setup.js";
import {
  DataPatchRemoteError,
  runRemoteDataPatchCommand,
  type DataPatchHeaderOption,
  type DataPatchRemoteAction,
  type DataPatchRemoteCommand
} from "./data-patches.js";
import {
  JobRemoteError,
  runRemoteJobCommand,
  type JobHeaderOption,
  type JobRemoteAction,
  type JobRemoteCommand
} from "./jobs.js";
import {
  FileRemoteError,
  runRemoteFileCommand,
  type FileHeaderOption,
  type FileRemoteAction,
  type FileRemoteCommand
} from "./files.js";
import { scaffoldProject, ScaffoldError } from "./scaffold.js";
import type { StarterAuthMode } from "./templates.js";

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
  readonly authMode?: StarterAuthMode;
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
  | CloudflareAccessSetupCommand
  | DataPatchRemoteCommand
  | JobRemoteCommand
  | FileRemoteCommand
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
    if (command.kind === "jobs") {
      io.stdout.write(await runRemoteJobCommand(command, {
        ...(io.env === undefined ? {} : { env: io.env }),
        ...(io.fetch === undefined ? {} : { fetch: io.fetch })
      }));
      return 0;
    }
    if (command.kind === "files") {
      io.stdout.write(await runRemoteFileCommand(command, {
        ...(io.env === undefined ? {} : { env: io.env }),
        ...(io.fetch === undefined ? {} : { fetch: io.fetch })
      }));
      return 0;
    }
    if (command.kind === "access-setup") {
      io.stdout.write(await runCloudflareAccessSetupCommand(command, {
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
      targetDirectory: command.targetDirectory,
      ...(command.authMode === undefined ? {} : { authMode: command.authMode })
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
      error instanceof CloudflareAccessSetupError ||
      error instanceof DataPatchRemoteError ||
      error instanceof JobRemoteError ||
      error instanceof FileRemoteError
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
  if (command === "jobs") {
    return parseJobsArgs(rest);
  }
  if (command === "files") {
    return parseFilesArgs(rest);
  }
  if (command === "access") {
    return parseAccessArgs(rest);
  }
  if (command !== "init") {
    return { kind: "invalid", message: `Unknown command '${command}'` };
  }
  return parseInitArgs(rest);
}

function parseAccessArgs(argv: readonly string[]): ParsedCommand {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    return { kind: "help" };
  }
  if (subcommand !== "plan" && subcommand !== "apply") {
    return { kind: "invalid", message: `Unknown access command '${subcommand}'` };
  }

  let accountId: string | undefined;
  let zoneId: string | undefined;
  let name: string | undefined;
  let domain: string | undefined;
  let teamDomain: string | undefined;
  let policyName: string | undefined;
  let sessionDuration: string | undefined;
  let apiTokenEnv: string | undefined;
  let apiBaseUrl: string | undefined;
  const includes: CloudflareAccessPolicyInclude[] = [];
  const allowedIdps: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === undefined) {
      break;
    }
    if (arg === "--help" || arg === "-h") {
      return { kind: "help" };
    }
    if (arg === "--account-id") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      accountId = value;
      index += 1;
      continue;
    }
    if (arg === "--zone-id") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      zoneId = value;
      index += 1;
      continue;
    }
    if (arg === "--name") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      name = value;
      index += 1;
      continue;
    }
    if (arg === "--domain") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      domain = value;
      index += 1;
      continue;
    }
    if (arg === "--team-domain") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      teamDomain = value;
      index += 1;
      continue;
    }
    if (arg === "--policy-name") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      policyName = value;
      index += 1;
      continue;
    }
    if (arg === "--session-duration") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      sessionDuration = value;
      index += 1;
      continue;
    }
    if (arg === "--api-token-env") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        return { kind: "invalid", message: `Cloudflare API token env var '${value}' is invalid` };
      }
      apiTokenEnv = value;
      index += 1;
      continue;
    }
    if (arg === "--api-base-url") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      apiBaseUrl = value;
      index += 1;
      continue;
    }
    if (arg === "--email") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      includes.push({ kind: "email", email: value });
      index += 1;
      continue;
    }
    if (arg === "--email-domain") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      includes.push({ kind: "email-domain", domain: value });
      index += 1;
      continue;
    }
    if (arg === "--group") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      includes.push({ kind: "group", id: value });
      index += 1;
      continue;
    }
    if (arg === "--everyone") {
      includes.push({ kind: "everyone" });
      continue;
    }
    if (arg === "--allowed-idp") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      allowedIdps.push(value);
      index += 1;
      continue;
    }
    return { kind: "invalid", message: `Unknown access ${subcommand} option '${arg}'` };
  }

  if (accountId !== undefined && zoneId !== undefined) {
    return { kind: "invalid", message: "Provide only one of --account-id or --zone-id" };
  }
  if (accountId === undefined && zoneId === undefined) {
    return { kind: "invalid", message: "Cloudflare Access setup requires --account-id or --zone-id" };
  }
  const scope: CloudflareAccessSetupScope = accountId === undefined
    ? { kind: "zone", id: zoneId! }
    : { kind: "account", id: accountId };
  if (name === undefined) {
    return { kind: "invalid", message: "Cloudflare Access setup requires --name" };
  }
  if (domain === undefined) {
    return { kind: "invalid", message: "Cloudflare Access setup requires --domain" };
  }
  if (teamDomain === undefined) {
    return { kind: "invalid", message: "Cloudflare Access setup requires --team-domain" };
  }
  if (includes.length === 0) {
    return { kind: "invalid", message: "Cloudflare Access setup requires at least one policy include selector" };
  }
  if (subcommand === "apply" && apiTokenEnv === undefined) {
    return { kind: "invalid", message: "Cloudflare Access apply requires --api-token-env" };
  }
  return {
    kind: "access-setup",
    action: subcommand,
    scope,
    name,
    domain,
    teamDomain,
    policyName: policyName ?? `${name} allow`,
    includes,
    ...(allowedIdps.length === 0 ? {} : { allowedIdps }),
    ...(sessionDuration === undefined ? {} : { sessionDuration }),
    ...(apiTokenEnv === undefined ? {} : { apiTokenEnv }),
    ...(apiBaseUrl === undefined ? {} : { apiBaseUrl })
  };
}

function parseRequiredOption(
  argv: readonly string[],
  index: number,
  option: string
): string | InvalidCommand {
  const value = argv[index + 1];
  if (value === undefined) {
    return { kind: "invalid", message: `Missing value for ${option}` };
  }
  if (value.startsWith("-")) {
    return { kind: "invalid", message: `Missing value for ${option}` };
  }
  if (value.trim().length === 0) {
    return { kind: "invalid", message: `${option} must be non-empty` };
  }
  return value.trim();
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
      const parsed = parseLiteralHeader(value, "Data patch");
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
      const parsed = parseEnvHeader(value, "Data patch");
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
      if (action === "status" || isSingleDataPatchAction(action)) {
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
      if (!isDataPatchQueueAction(action)) {
        return { kind: "invalid", message: "Can only use --idempotency-key with data-patches enqueue commands" };
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
      if (!isDataPatchQueueAction(action)) {
        return { kind: "invalid", message: "Can only use --delay-seconds with data-patches enqueue commands" };
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
  if (isSingleDataPatchAction(action) && patchIds.length !== 1) {
    return { kind: "invalid", message: `Data patch ${dataPatchActionLabel(action)} requires exactly one --id` };
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
    value === "rollback" ||
    value === "enqueue" ||
    value === "rollback-enqueue" ||
    value === "retry" ||
    value === "rollback-retry" ||
    value === "rollback-retry-enqueue"
    ? value
    : undefined;
}

function isSingleDataPatchAction(action: DataPatchRemoteAction): boolean {
  return action === "retry" || action === "rollback-retry" || action === "rollback-retry-enqueue";
}

function dataPatchActionLabel(action: DataPatchRemoteAction): string {
  if (action === "rollback-retry") {
    return "rollback retry";
  }
  if (action === "rollback-retry-enqueue") {
    return "rollback retry enqueue";
  }
  return action;
}

function isDataPatchQueueAction(action: DataPatchRemoteAction): boolean {
  return action === "enqueue" || action === "rollback-enqueue" || action === "rollback-retry-enqueue";
}

function parseJobsArgs(argv: readonly string[]): ParsedCommand {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    return { kind: "help" };
  }
  const action = jobAction(subcommand);
  if (action === undefined) {
    return { kind: "invalid", message: `Unknown jobs command '${subcommand}'` };
  }

  let url: string | undefined;
  const headers: JobHeaderOption[] = [];
  let jobName: string | undefined;
  let runId: string | undefined;
  let status: JobRemoteCommand["status"] | undefined;
  let limit: number | undefined;
  let idempotencyKey: string | undefined;
  let scheduleId: string | undefined;
  let cron: string | undefined;
  let scheduleEnabled: boolean | undefined;
  let pauseUntil: string | undefined;
  let payload: Record<string, unknown> | undefined;
  let metadata: Record<string, unknown> | undefined;
  let scheduleIdempotencyKey: string | undefined;
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
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      url = value;
      index += 1;
      continue;
    }
    if (arg === "--header") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseLiteralHeader(value, "Job");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      headers.push(parsed);
      index += 1;
      continue;
    }
    if (arg === "--header-env") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseEnvHeader(value, "Job");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      headers.push(parsed);
      index += 1;
      continue;
    }
    if (arg === "--job") {
      if (action !== "list" && action !== "schedules" && action !== "schedule-save") {
        return { kind: "invalid", message: `Cannot use --job with jobs ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      jobName = value;
      index += 1;
      continue;
    }
    if (arg === "--run-id") {
      if (action !== "list") {
        return { kind: "invalid", message: `Cannot use --run-id with jobs ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      runId = value;
      index += 1;
      continue;
    }
    if (arg === "--status") {
      if (action !== "list") {
        return { kind: "invalid", message: `Cannot use --status with jobs ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = jobStatus(value);
      if (parsed === undefined) {
        return { kind: "invalid", message: "Job status must be running, succeeded, or failed" };
      }
      status = parsed;
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      if (action !== "list") {
        return { kind: "invalid", message: `Cannot use --limit with jobs ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parsePositiveInteger(value, "Job history limit");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      limit = parsed;
      index += 1;
      continue;
    }
    if (arg === "--idempotency-key") {
      if (action !== "get" && action !== "retry" && action !== "schedule-save") {
        return { kind: "invalid", message: `Cannot use --idempotency-key with jobs ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      if (action === "schedule-save") {
        scheduleIdempotencyKey = value;
      } else {
        idempotencyKey = value;
      }
      index += 1;
      continue;
    }
    if (arg === "--id") {
      if (!isJobScheduleAction(action)) {
        return { kind: "invalid", message: `Cannot use --id with jobs ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      scheduleId = value;
      index += 1;
      continue;
    }
    if (arg === "--cron") {
      if (action !== "schedules" && action !== "schedule-save") {
        return { kind: "invalid", message: `Cannot use --cron with jobs ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      cron = value;
      index += 1;
      continue;
    }
    if (arg === "--enabled" || arg === "--disabled") {
      if (action !== "schedule-save") {
        return { kind: "invalid", message: `Cannot use ${arg} with jobs ${action}` };
      }
      if (scheduleEnabled !== undefined) {
        return { kind: "invalid", message: "Use only one of --enabled or --disabled" };
      }
      scheduleEnabled = arg === "--enabled";
      continue;
    }
    if (arg === "--until") {
      if (action !== "schedule-pause") {
        return { kind: "invalid", message: `Cannot use --until with jobs ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      pauseUntil = value;
      index += 1;
      continue;
    }
    if (arg === "--payload-json" || arg === "--metadata-json") {
      if (action !== "schedule-save") {
        return { kind: "invalid", message: `Cannot use ${arg} with jobs ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseJsonObject(value, arg === "--payload-json" ? "Job schedule payload" : "Job schedule metadata");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      if (arg === "--payload-json") {
        payload = parsed;
      } else {
        metadata = parsed;
      }
      index += 1;
      continue;
    }
    if (arg === "--delay-seconds") {
      if (action !== "schedule-save") {
        return { kind: "invalid", message: `Cannot use --delay-seconds with jobs ${action}` };
      }
      const value = rest[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --delay-seconds" };
      }
      const parsed = parseIntegerBetween(value, "Job schedule delay", 0, MAX_JOB_QUEUE_DELAY_SECONDS);
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      delaySeconds = parsed;
      index += 1;
      continue;
    }
    return { kind: "invalid", message: `Unknown jobs ${action} option '${arg}'` };
  }

  if (url === undefined) {
    return { kind: "invalid", message: "Missing value for --url" };
  }
  if ((action === "get" || action === "retry") && idempotencyKey === undefined) {
    return { kind: "invalid", message: `Job ${action} requires --idempotency-key` };
  }
  if (isRequiredScheduleIdAction(action) && scheduleId === undefined) {
    return { kind: "invalid", message: `Job schedule ${jobScheduleActionLabel(action)} requires --id` };
  }
  if (action === "schedule-pause" && pauseUntil === undefined) {
    return { kind: "invalid", message: "Job schedule pause requires --until" };
  }
  if (action === "schedule-save" && cron === undefined) {
    return { kind: "invalid", message: "Job schedule save requires --cron" };
  }
  if (action === "schedule-save" && jobName === undefined) {
    return { kind: "invalid", message: "Job schedule save requires --job" };
  }
  return {
    kind: "jobs",
    action,
    url,
    headers,
    ...(jobName === undefined ? {} : { jobName }),
    ...(runId === undefined ? {} : { runId }),
    ...(status === undefined ? {} : { status }),
    ...(limit === undefined ? {} : { limit }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(scheduleId === undefined ? {} : { scheduleId }),
    ...(cron === undefined ? {} : { cron }),
    ...(scheduleEnabled === undefined ? {} : { scheduleEnabled }),
    ...(pauseUntil === undefined ? {} : { pauseUntil }),
    ...(payload === undefined ? {} : { payload }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(scheduleIdempotencyKey === undefined ? {} : { scheduleIdempotencyKey }),
    ...(delaySeconds === undefined ? {} : { delaySeconds })
  };
}

function parseFilesArgs(argv: readonly string[]): ParsedCommand {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    return { kind: "help" };
  }
  const action = fileAction(subcommand);
  if (action === undefined) {
    return { kind: "invalid", message: `Unknown files command '${subcommand}'` };
  }

  let url: string | undefined;
  const headers: FileHeaderOption[] = [];
  let name: string | undefined;
  const files: NonNullable<FileRemoteCommand["files"]>[number][] = [];
  let attachedToDoctype: string | undefined;
  let attachedToName: string | undefined;
  let contentType: string | undefined;
  let filename: string | undefined;
  let isPrivate: boolean | undefined;
  let limit: number | undefined;
  let scanStatus: string | undefined;
  let storageState: string | undefined;
  let uploadedBy: string | undefined;
  let expectedVersion: number | undefined;
  let clearAttachment = false;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === undefined) {
      break;
    }
    if (arg === "--help" || arg === "-h") {
      return { kind: "help" };
    }
    if (arg === "--url") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      url = value;
      index += 1;
      continue;
    }
    if (arg === "--header") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseLiteralHeader(value, "File");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      headers.push(parsed);
      index += 1;
      continue;
    }
    if (arg === "--header-env") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseEnvHeader(value, "File");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      headers.push(parsed);
      index += 1;
      continue;
    }
    if (arg === "--name") {
      if (action !== "delete" && action !== "update") {
        return { kind: "invalid", message: `Cannot use --name with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      name = value;
      index += 1;
      continue;
    }
    if (arg === "--file") {
      if (action !== "bulk-delete" && action !== "bulk-update") {
        return { kind: "invalid", message: `Cannot use --file with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      files.push({ name: value });
      index += 1;
      continue;
    }
    if (arg === "--file-version") {
      if (action !== "bulk-delete" && action !== "bulk-update") {
        return { kind: "invalid", message: `Cannot use --file-version with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseFileSelectionWithVersion(value);
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      files.push(parsed);
      index += 1;
      continue;
    }
    if (arg === "--expected-version") {
      if (action !== "delete" && action !== "update") {
        return { kind: "invalid", message: `Cannot use --expected-version with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parsePositiveInteger(value, "File expected version");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      expectedVersion = parsed;
      index += 1;
      continue;
    }
    if (arg === "--attached-to-doctype") {
      if (action !== "list" && action !== "update" && action !== "bulk-update") {
        return { kind: "invalid", message: `Cannot use --attached-to-doctype with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      attachedToDoctype = value;
      index += 1;
      continue;
    }
    if (arg === "--attached-to-name") {
      if (action !== "list" && action !== "update" && action !== "bulk-update") {
        return { kind: "invalid", message: `Cannot use --attached-to-name with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      attachedToName = value;
      index += 1;
      continue;
    }
    if (arg === "--content-type") {
      if (action !== "list") {
        return { kind: "invalid", message: `Cannot use --content-type with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      contentType = value;
      index += 1;
      continue;
    }
    if (arg === "--filename") {
      if (action !== "list" && action !== "update") {
        return { kind: "invalid", message: `Cannot use --filename with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      filename = value;
      index += 1;
      continue;
    }
    if (arg === "--private") {
      if (action !== "list" && action !== "update" && action !== "bulk-update") {
        return { kind: "invalid", message: `Cannot use --private with files ${action}` };
      }
      if (isPrivate !== undefined) {
        return { kind: "invalid", message: "Use only one of --private or --public" };
      }
      isPrivate = true;
      continue;
    }
    if (arg === "--public") {
      if (action !== "list" && action !== "update" && action !== "bulk-update") {
        return { kind: "invalid", message: `Cannot use --public with files ${action}` };
      }
      if (isPrivate !== undefined) {
        return { kind: "invalid", message: "Use only one of --private or --public" };
      }
      isPrivate = false;
      continue;
    }
    if (arg === "--clear-attachment") {
      if (action !== "update" && action !== "bulk-update") {
        return { kind: "invalid", message: `Cannot use --clear-attachment with files ${action}` };
      }
      clearAttachment = true;
      continue;
    }
    if (arg === "--limit") {
      if (action !== "list") {
        return { kind: "invalid", message: `Cannot use --limit with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parsePositiveInteger(value, "File list limit");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      limit = parsed;
      index += 1;
      continue;
    }
    if (arg === "--scan-status") {
      if (action !== "list") {
        return { kind: "invalid", message: `Cannot use --scan-status with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      scanStatus = value;
      index += 1;
      continue;
    }
    if (arg === "--storage-state") {
      if (action !== "list") {
        return { kind: "invalid", message: `Cannot use --storage-state with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      storageState = value;
      index += 1;
      continue;
    }
    if (arg === "--uploaded-by") {
      if (action !== "list") {
        return { kind: "invalid", message: `Cannot use --uploaded-by with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      uploadedBy = value;
      index += 1;
      continue;
    }
    return { kind: "invalid", message: `Unknown files ${action} option '${arg}'` };
  }

  if (url === undefined) {
    return { kind: "invalid", message: "Missing value for --url" };
  }
  if ((attachedToDoctype === undefined) !== (attachedToName === undefined)) {
    return { kind: "invalid", message: "Use --attached-to-doctype and --attached-to-name together" };
  }
  if ((action === "delete" || action === "update") && name === undefined) {
    return { kind: "invalid", message: `File ${action} requires --name` };
  }
  if ((action === "bulk-delete" || action === "bulk-update") && files.length === 0) {
    return { kind: "invalid", message: `File ${action} requires at least one --file or --file-version` };
  }
  const duplicateFile = duplicateFileSelection(files);
  if (duplicateFile !== undefined) {
    return { kind: "invalid", message: `Duplicate file selection '${duplicateFile}'` };
  }
  if (clearAttachment && (attachedToDoctype !== undefined || attachedToName !== undefined)) {
    return { kind: "invalid", message: "Use only one of --clear-attachment or --attached-to-doctype/--attached-to-name" };
  }
  if (
    (action === "update" || action === "bulk-update") &&
    filename === undefined &&
    isPrivate === undefined &&
    !clearAttachment &&
    attachedToDoctype === undefined
  ) {
    return { kind: "invalid", message: `File ${action} requires at least one metadata change` };
  }
  return {
    kind: "files",
    action,
    url,
    headers,
    ...(name === undefined ? {} : { name }),
    ...(files.length === 0 ? {} : { files }),
    ...(attachedToDoctype === undefined ? {} : { attachedToDoctype }),
    ...(attachedToName === undefined ? {} : { attachedToName }),
    ...(contentType === undefined ? {} : { contentType }),
    ...(filename === undefined ? {} : { filename }),
    ...(isPrivate === undefined ? {} : { isPrivate }),
    ...(limit === undefined ? {} : { limit }),
    ...(scanStatus === undefined ? {} : { scanStatus }),
    ...(storageState === undefined ? {} : { storageState }),
    ...(uploadedBy === undefined ? {} : { uploadedBy }),
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    ...(clearAttachment ? { clearAttachment } : {})
  };
}

function fileAction(value: string): FileRemoteAction | undefined {
  return value === "list" || value === "delete" || value === "update" || value === "bulk-delete" || value === "bulk-update"
    ? value
    : undefined;
}

function jobAction(value: string): JobRemoteAction | undefined {
  return value === "list" ||
    value === "get" ||
    value === "retry" ||
    value === "schedules" ||
    value === "schedule-run" ||
    value === "schedule-enable" ||
    value === "schedule-disable" ||
    value === "schedule-pause" ||
    value === "schedule-reset" ||
    value === "schedule-save" ||
    value === "schedule-delete"
    ? value
    : undefined;
}

function jobStatus(value: string): JobRemoteCommand["status"] | undefined {
  return value === "running" || value === "succeeded" || value === "failed" ? value : undefined;
}

function isJobScheduleAction(action: JobRemoteAction): boolean {
  return action.startsWith("schedule-");
}

function isRequiredScheduleIdAction(action: JobRemoteAction): boolean {
  return isJobScheduleAction(action) && action !== "schedule-save";
}

function jobScheduleActionLabel(action: JobRemoteAction): string {
  if (action === "schedule-run") {
    return "run";
  }
  if (action === "schedule-enable") {
    return "enable";
  }
  if (action === "schedule-disable") {
    return "disable";
  }
  if (action === "schedule-pause") {
    return "pause";
  }
  if (action === "schedule-reset") {
    return "reset";
  }
  if (action === "schedule-delete") {
    return "delete";
  }
  return "save";
}

function parseJsonObject(value: string, label: string): Record<string, unknown> | string {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to the single validation message below.
  }
  return `${label} must be a valid JSON object`;
}

function parseLiteralHeader(value: string, label: string): DataPatchHeaderOption | JobHeaderOption | FileHeaderOption | string {
  const separator = value.indexOf(":");
  if (separator < 1) {
    return `${label} header must use 'Name: value' syntax`;
  }
  const name = value.slice(0, separator).trim();
  const headerValue = value.slice(separator + 1).trim();
  if (!isHttpHeaderName(name)) {
    return `${label} header name '${name}' is invalid`;
  }
  if (headerValue.length === 0) {
    return `${label} header '${name}' must have a non-empty value`;
  }
  return { kind: "literal", name, value: headerValue };
}

function parseEnvHeader(value: string, label: string): DataPatchHeaderOption | JobHeaderOption | FileHeaderOption | string {
  const separator = value.indexOf("=");
  if (separator < 1) {
    return `${label} environment header must use 'Name=ENV_VAR' syntax`;
  }
  const name = value.slice(0, separator).trim();
  const envName = value.slice(separator + 1).trim();
  if (!isHttpHeaderName(name)) {
    return `${label} header name '${name}' is invalid`;
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) {
    return `${label} header env var '${envName}' is invalid`;
  }
  return { kind: "env", name, envName };
}

function parsePositiveInteger(value: string, label: string): number | string {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : `${label} must be a positive integer`;
}

function parseFileSelectionWithVersion(value: string): NonNullable<FileRemoteCommand["files"]>[number] | string {
  const separator = value.lastIndexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    return "File version selection must use <fileName>:<expectedVersion>";
  }
  const expectedVersion = parsePositiveInteger(value.slice(separator + 1), "File expected version");
  if (typeof expectedVersion === "string") {
    return expectedVersion;
  }
  return { name: value.slice(0, separator), expectedVersion };
}

function duplicateFileSelection(files: readonly NonNullable<FileRemoteCommand["files"]>[number][]): string | undefined {
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.name)) {
      return file.name;
    }
    seen.add(file.name);
  }
  return undefined;
}

function parseNonNegativeInteger(value: string, label: string): number | string {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : `${label} must be a non-negative integer`;
}

function parseIntegerBetween(value: string, label: string, min: number, max: number): number | string {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : `${label} must be an integer between ${min} and ${max}`;
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
  let authMode: StarterAuthMode | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      break;
    }
    if (arg === "--help" || arg === "-h") {
      return { kind: "help" };
    }
    if (arg === "--force" || arg === "-f") {
      force = true;
      continue;
    }
    if (arg === "--auth") {
      const value = argv[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --auth" };
      }
      const parsed = starterAuthMode(value);
      if (parsed === undefined) {
        return { kind: "invalid", message: `Unsupported starter auth mode '${value}'` };
      }
      authMode = parsed;
      index += 1;
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
  return {
    kind: "init",
    targetDirectory,
    force,
    ...(authMode === undefined ? {} : { authMode })
  };
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
    "  cf-frappe init <directory> [--force] [--auth <signed-session|cloudflare-access|oidc>]",
    "  cf-frappe install <module> [--version <range>] [--export <name>] [--as <localName>] [--registry <path>] [--package-manager <npm|pnpm|yarn|bun>] [--no-install] [--no-save]",
    "  cf-frappe migrate generate [--registry <path>] [--migrations <dir>] [--no-core]",
    "  cf-frappe access plan (--account-id <id>|--zone-id <id>) --team-domain <team.cloudflareaccess.com> --name <appName> --domain <host[/path]> (--email <user>|--email-domain <domain>|--group <id>|--everyone) [--policy-name <name>] [--allowed-idp <id>] [--session-duration <duration>]",
    "  cf-frappe access apply (--account-id <id>|--zone-id <id>) --team-domain <team.cloudflareaccess.com> --name <appName> --domain <host[/path]> (--email <user>|--email-domain <domain>|--group <id>|--everyone) --api-token-env <ENV> [--policy-name <name>] [--allowed-idp <id>] [--session-duration <duration>]",
    "  cf-frappe data-patches status --url <origin> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe data-patches plan --url <origin> [--id <patchId>] [--limit <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe data-patches rollback-plan --url <origin> [--id <patchId>] [--limit <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe data-patches apply --url <origin> [--id <patchId>] [--limit <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe data-patches rollback --url <origin> [--id <patchId>] [--limit <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe data-patches retry --url <origin> --id <patchId> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe data-patches rollback-retry --url <origin> --id <patchId> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe data-patches enqueue --url <origin> [--id <patchId>] [--limit <n>] [--idempotency-key <key>] [--delay-seconds <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe data-patches rollback-enqueue --url <origin> [--id <patchId>] [--limit <n>] [--idempotency-key <key>] [--delay-seconds <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe data-patches rollback-retry-enqueue --url <origin> --id <patchId> [--idempotency-key <key>] [--delay-seconds <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe jobs list --url <origin> [--job <name>] [--run-id <id>] [--status <running|succeeded|failed>] [--limit <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe jobs get --url <origin> --idempotency-key <key> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe jobs retry --url <origin> --idempotency-key <key> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe jobs schedules --url <origin> [--job <name>] [--cron <expr>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe jobs schedule-run --url <origin> --id <scheduleId> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe jobs schedule-enable --url <origin> --id <scheduleId> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe jobs schedule-disable --url <origin> --id <scheduleId> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe jobs schedule-pause --url <origin> --id <scheduleId> --until <timestamp> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe jobs schedule-reset --url <origin> --id <scheduleId> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe jobs schedule-save --url <origin> [--id <scheduleId>] --cron <expr> --job <name> [--enabled|--disabled] [--payload-json <json>] [--metadata-json <json>] [--idempotency-key <key>] [--delay-seconds <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe jobs schedule-delete --url <origin> --id <scheduleId> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files list --url <origin> [--filename <text>] [--content-type <type>] [--attached-to-doctype <doctype> --attached-to-name <name>] [--storage-state <state>] [--scan-status <status>] [--uploaded-by <user>] [--private|--public] [--limit <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files update --url <origin> --name <fileName> [--filename <text>] [--private|--public] [--attached-to-doctype <doctype> --attached-to-name <name>|--clear-attachment] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files bulk-update --url <origin> (--file <fileName>|--file-version <fileName:version>)... [--private|--public] [--attached-to-doctype <doctype> --attached-to-name <name>|--clear-attachment] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files bulk-delete --url <origin> (--file <fileName>|--file-version <fileName:version>)... [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files delete --url <origin> --name <fileName> [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe --help",
    "",
    "Commands:",
    "  init   Create a Cloudflare-ready cf-frappe starter app",
    "  install   Save, install, and wire an app module into a generated app registry",
    "  migrate generate   Write reviewable D1 migration files from app metadata",
    "  access   Plan or create Cloudflare Access application and policy resources for a starter app",
    "  data-patches   Inspect, plan, apply, rollback, or enqueue remote app-declared data patches through the admin API",
    "  jobs   Inspect remote job history, retry failed runs, and manage runtime schedules through the admin API",
    "  files   Inspect, update, and delete remote File metadata/content through the admin API",
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

function starterAuthMode(value: string): StarterAuthMode | undefined {
  return value === "signed-session" || value === "cloudflare-access" || value === "oidc" ? value : undefined;
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
