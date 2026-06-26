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
  CustomFieldRemoteError,
  runRemoteCustomFieldCommand,
  type CustomFieldHeaderOption,
  type CustomFieldRemoteAction,
  type CustomFieldRemoteCommand
} from "./custom-fields.js";
import {
  DataPatchRemoteError,
  runRemoteDataPatchCommand,
  type DataPatchHeaderOption,
  type DataPatchRemoteAction,
  type DataPatchRemoteCommand
} from "./data-patches.js";
import {
  FieldPropertyRemoteError,
  runRemoteFieldPropertyCommand,
  type FieldPropertyHeaderOption,
  type FieldPropertyRemoteAction,
  type FieldPropertyRemoteCommand
} from "./field-properties.js";
import {
  JobRemoteError,
  runRemoteJobCommand,
  type JobHeaderOption,
  type JobRemoteAction,
  type JobRemoteCommand
} from "./jobs.js";
import {
  NotificationRuleRemoteError,
  runRemoteNotificationRuleCommand,
  type NotificationRuleHeaderOption,
  type NotificationRuleRecipientOption,
  type NotificationRuleRemoteAction,
  type NotificationRuleRemoteCommand
} from "./notification-rules.js";
import {
  FileRemoteError,
  runRemoteFileCommand,
  type FileHeaderOption,
  type FileRemoteAction,
  type FileRemoteCommand
} from "./files.js";
import {
  ResourceRemoteError,
  runRemoteResourceCommand,
  type ResourceHeaderOption,
  type ResourceRemoteAction,
  type ResourceRemoteCommand
} from "./resources.js";
import {
  RoleRemoteError,
  runRemoteRoleCommand,
  type RoleHeaderOption,
  type RoleRemoteAction,
  type RoleRemoteCommand
} from "./roles.js";
import {
  UserPermissionRemoteError,
  runRemoteUserPermissionCommand,
  type UserPermissionHeaderOption,
  type UserPermissionRemoteAction,
  type UserPermissionRemoteCommand
} from "./user-permissions.js";
import {
  WorkflowRemoteError,
  runRemoteWorkflowCommand,
  type WorkflowHeaderOption,
  type WorkflowRemoteAction,
  type WorkflowRemoteCommand
} from "./workflows.js";
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
  | CustomFieldRemoteCommand
  | DataPatchRemoteCommand
  | FieldPropertyRemoteCommand
  | JobRemoteCommand
  | NotificationRuleRemoteCommand
  | FileRemoteCommand
  | ResourceRemoteCommand
  | RoleRemoteCommand
  | UserPermissionRemoteCommand
  | WorkflowRemoteCommand
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
    if (command.kind === "custom-fields") {
      io.stdout.write(await runRemoteCustomFieldCommand(command, {
        ...(io.env === undefined ? {} : { env: io.env }),
        ...(io.fetch === undefined ? {} : { fetch: io.fetch })
      }));
      return 0;
    }
    if (command.kind === "data-patches") {
      io.stdout.write(await runRemoteDataPatchCommand(command, {
        ...(io.env === undefined ? {} : { env: io.env }),
        ...(io.fetch === undefined ? {} : { fetch: io.fetch })
      }));
      return 0;
    }
    if (command.kind === "field-properties") {
      io.stdout.write(await runRemoteFieldPropertyCommand(command, {
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
    if (command.kind === "notification-rules") {
      io.stdout.write(await runRemoteNotificationRuleCommand(command, {
        ...(io.env === undefined ? {} : { env: io.env }),
        ...(io.fetch === undefined ? {} : { fetch: io.fetch })
      }));
      return 0;
    }
    if (command.kind === "files") {
      io.stdout.write(await runRemoteFileCommand(command, {
        cwd: io.cwd(),
        ...(io.env === undefined ? {} : { env: io.env }),
        ...(io.fetch === undefined ? {} : { fetch: io.fetch })
      }));
      return 0;
    }
    if (command.kind === "resources") {
      io.stdout.write(await runRemoteResourceCommand(command, {
        cwd: io.cwd(),
        ...(io.env === undefined ? {} : { env: io.env }),
        ...(io.fetch === undefined ? {} : { fetch: io.fetch })
      }));
      return 0;
    }
    if (command.kind === "roles") {
      io.stdout.write(await runRemoteRoleCommand(command, {
        ...(io.env === undefined ? {} : { env: io.env }),
        ...(io.fetch === undefined ? {} : { fetch: io.fetch })
      }));
      return 0;
    }
    if (command.kind === "user-permissions") {
      io.stdout.write(await runRemoteUserPermissionCommand(command, {
        ...(io.env === undefined ? {} : { env: io.env }),
        ...(io.fetch === undefined ? {} : { fetch: io.fetch })
      }));
      return 0;
    }
    if (command.kind === "workflows") {
      io.stdout.write(await runRemoteWorkflowCommand(command, {
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
      error instanceof CustomFieldRemoteError ||
      error instanceof DataPatchRemoteError ||
      error instanceof FieldPropertyRemoteError ||
      error instanceof JobRemoteError ||
      error instanceof NotificationRuleRemoteError ||
      error instanceof FileRemoteError ||
      error instanceof ResourceRemoteError ||
      error instanceof RoleRemoteError ||
      error instanceof UserPermissionRemoteError ||
      error instanceof WorkflowRemoteError
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
  if (command === "custom-fields") {
    return parseCustomFieldsArgs(rest);
  }
  if (command === "data-patches") {
    return parseDataPatchesArgs(rest);
  }
  if (command === "field-properties") {
    return parseFieldPropertiesArgs(rest);
  }
  if (command === "jobs") {
    return parseJobsArgs(rest);
  }
  if (command === "notification-rules") {
    return parseNotificationRulesArgs(rest);
  }
  if (command === "files") {
    return parseFilesArgs(rest);
  }
  if (command === "resources") {
    return parseResourcesArgs(rest);
  }
  if (command === "roles") {
    return parseRolesArgs(rest);
  }
  if (command === "user-permissions") {
    return parseUserPermissionsArgs(rest);
  }
  if (command === "workflows") {
    return parseWorkflowsArgs(rest);
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

function parseCustomFieldsArgs(argv: readonly string[]): ParsedCommand {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    return { kind: "help" };
  }
  const action = customFieldAction(subcommand);
  if (action === undefined) {
    return { kind: "invalid", message: `Unknown custom-fields command '${subcommand}'` };
  }

  let url: string | undefined;
  const headers: CustomFieldHeaderOption[] = [];
  let doctype: string | undefined;
  let tenant: string | undefined;
  let fieldName: string | undefined;
  let field: Record<string, unknown> | undefined;
  let expectedVersion: number | undefined;

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
      const parsed = parseLiteralHeader(value, "Custom field");
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
      const parsed = parseEnvHeader(value, "Custom field");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      headers.push(parsed);
      index += 1;
      continue;
    }
    if (arg === "--doctype") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      doctype = value;
      index += 1;
      continue;
    }
    if (arg === "--tenant") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      tenant = value;
      index += 1;
      continue;
    }
    if (arg === "--field") {
      if (action !== "disable") {
        return { kind: "invalid", message: `Cannot use --field with custom-fields ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      fieldName = value;
      index += 1;
      continue;
    }
    if (arg === "--field-json") {
      if (action !== "save") {
        return { kind: "invalid", message: `Cannot use --field-json with custom-fields ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseJsonObject(value, "Custom field");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      field = parsed;
      index += 1;
      continue;
    }
    if (arg === "--expected-version") {
      if (action === "list") {
        return { kind: "invalid", message: "Cannot use --expected-version with custom-fields list" };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseNonNegativeInteger(value, "Custom field expected version");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      expectedVersion = parsed;
      index += 1;
      continue;
    }
    return { kind: "invalid", message: `Unknown custom-fields ${action} option '${arg}'` };
  }

  if (url === undefined) {
    return { kind: "invalid", message: "Missing value for --url" };
  }
  if (doctype === undefined) {
    return { kind: "invalid", message: `Custom field ${action} requires --doctype` };
  }
  if (action === "save" && field === undefined) {
    return { kind: "invalid", message: "Custom field save requires --field-json" };
  }
  if (action === "disable" && fieldName === undefined) {
    return { kind: "invalid", message: "Custom field disable requires --field" };
  }

  return {
    kind: "custom-fields",
    action,
    url,
    headers,
    doctype,
    ...(tenant === undefined ? {} : { tenant }),
    ...(fieldName === undefined ? {} : { fieldName }),
    ...(field === undefined ? {} : { field }),
    ...(expectedVersion === undefined ? {} : { expectedVersion })
  };
}

function parseFieldPropertiesArgs(argv: readonly string[]): ParsedCommand {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    return { kind: "help" };
  }
  const action = fieldPropertyAction(subcommand);
  if (action === undefined) {
    return { kind: "invalid", message: `Unknown field-properties command '${subcommand}'` };
  }

  let url: string | undefined;
  const headers: FieldPropertyHeaderOption[] = [];
  let doctype: string | undefined;
  let tenant: string | undefined;
  let fieldName: string | undefined;
  let overrides: Record<string, unknown> | undefined;
  let expectedVersion: number | undefined;

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
      const parsed = parseLiteralHeader(value, "Field property");
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
      const parsed = parseEnvHeader(value, "Field property");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      headers.push(parsed);
      index += 1;
      continue;
    }
    if (arg === "--doctype") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      doctype = value;
      index += 1;
      continue;
    }
    if (arg === "--tenant") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      tenant = value;
      index += 1;
      continue;
    }
    if (arg === "--field") {
      if (action === "list") {
        return { kind: "invalid", message: "Cannot use --field with field-properties list" };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      fieldName = value;
      index += 1;
      continue;
    }
    if (arg === "--overrides-json") {
      if (action !== "save") {
        return { kind: "invalid", message: `Cannot use --overrides-json with field-properties ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseJsonObject(value, "Field property overrides");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      overrides = parsed;
      index += 1;
      continue;
    }
    if (arg === "--expected-version") {
      if (action === "list") {
        return { kind: "invalid", message: "Cannot use --expected-version with field-properties list" };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseNonNegativeInteger(value, "Field property expected version");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      expectedVersion = parsed;
      index += 1;
      continue;
    }
    return { kind: "invalid", message: `Unknown field-properties ${action} option '${arg}'` };
  }

  if (url === undefined) {
    return { kind: "invalid", message: "Missing value for --url" };
  }
  if (doctype === undefined) {
    return { kind: "invalid", message: `Field property ${action} requires --doctype` };
  }
  if (action === "save" && fieldName === undefined) {
    return { kind: "invalid", message: "Field property save requires --field" };
  }
  if (action === "save" && overrides === undefined) {
    return { kind: "invalid", message: "Field property save requires --overrides-json" };
  }
  if (action === "clear" && fieldName === undefined) {
    return { kind: "invalid", message: "Field property clear requires --field" };
  }

  return {
    kind: "field-properties",
    action,
    url,
    headers,
    doctype,
    ...(tenant === undefined ? {} : { tenant }),
    ...(fieldName === undefined ? {} : { fieldName }),
    ...(overrides === undefined ? {} : { overrides }),
    ...(expectedVersion === undefined ? {} : { expectedVersion })
  };
}

function parseWorkflowsArgs(argv: readonly string[]): ParsedCommand {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    return { kind: "help" };
  }
  const action = workflowAction(subcommand);
  if (action === undefined) {
    return { kind: "invalid", message: `Unknown workflows command '${subcommand}'` };
  }

  let url: string | undefined;
  const headers: WorkflowHeaderOption[] = [];
  let doctype: string | undefined;
  let tenant: string | undefined;
  let workflow: Record<string, unknown> | undefined;
  let expectedVersion: number | undefined;

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
      const parsed = parseLiteralHeader(value, "Workflow");
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
      const parsed = parseEnvHeader(value, "Workflow");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      headers.push(parsed);
      index += 1;
      continue;
    }
    if (arg === "--doctype") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      doctype = value;
      index += 1;
      continue;
    }
    if (arg === "--tenant") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      tenant = value;
      index += 1;
      continue;
    }
    if (arg === "--workflow-json") {
      if (action !== "save") {
        return { kind: "invalid", message: `Cannot use --workflow-json with workflows ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseJsonObject(value, "Workflow");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      workflow = parsed;
      index += 1;
      continue;
    }
    if (arg === "--expected-version") {
      if (action === "get") {
        return { kind: "invalid", message: "Cannot use --expected-version with workflows get" };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseNonNegativeInteger(value, "Workflow expected version");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      expectedVersion = parsed;
      index += 1;
      continue;
    }
    return { kind: "invalid", message: `Unknown workflows ${action} option '${arg}'` };
  }

  if (url === undefined) {
    return { kind: "invalid", message: "Missing value for --url" };
  }
  if (doctype === undefined) {
    return { kind: "invalid", message: `Workflow ${action} requires --doctype` };
  }
  if (action === "save" && workflow === undefined) {
    return { kind: "invalid", message: "Workflow save requires --workflow-json" };
  }

  return {
    kind: "workflows",
    action,
    url,
    headers,
    doctype,
    ...(tenant === undefined ? {} : { tenant }),
    ...(workflow === undefined ? {} : { workflow }),
    ...(expectedVersion === undefined ? {} : { expectedVersion })
  };
}

function parseRolesArgs(argv: readonly string[]): ParsedCommand {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    return { kind: "help" };
  }
  const action = roleAction(subcommand);
  if (action === undefined) {
    return { kind: "invalid", message: `Unknown roles command '${subcommand}'` };
  }

  let url: string | undefined;
  const headers: RoleHeaderOption[] = [];
  let role: string | undefined;
  let tenant: string | undefined;
  let description: string | undefined;
  let enabled: boolean | undefined;
  let expectedVersion: number | undefined;

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
      const parsed = parseLiteralHeader(value, "Role");
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
      const parsed = parseEnvHeader(value, "Role");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      headers.push(parsed);
      index += 1;
      continue;
    }
    if (arg === "--role") {
      if (action === "list") {
        return { kind: "invalid", message: "Cannot use --role with roles list" };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      role = value;
      index += 1;
      continue;
    }
    if (arg === "--tenant") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      tenant = value;
      index += 1;
      continue;
    }
    if (arg === "--description") {
      if (action !== "create" && action !== "describe") {
        return { kind: "invalid", message: `Cannot use --description with roles ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      description = value;
      index += 1;
      continue;
    }
    if (arg === "--enabled" || arg === "--disabled") {
      if (action !== "create") {
        return { kind: "invalid", message: `Cannot use ${arg} with roles ${action}` };
      }
      const nextEnabled = arg === "--enabled";
      if (enabled !== undefined && enabled !== nextEnabled) {
        return { kind: "invalid", message: "Role create cannot use both --enabled and --disabled" };
      }
      enabled = nextEnabled;
      continue;
    }
    if (arg === "--expected-version") {
      if (action === "list" || action === "get") {
        return { kind: "invalid", message: `Cannot use --expected-version with roles ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseNonNegativeInteger(value, "Role expected version");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      expectedVersion = parsed;
      index += 1;
      continue;
    }
    return { kind: "invalid", message: `Unknown roles ${action} option '${arg}'` };
  }

  if (url === undefined) {
    return { kind: "invalid", message: "Missing value for --url" };
  }
  if (action !== "list" && role === undefined) {
    return { kind: "invalid", message: `Role ${action} requires --role` };
  }
  if (action === "describe" && description === undefined) {
    return { kind: "invalid", message: "Role describe requires --description" };
  }

  return {
    kind: "roles",
    action,
    url,
    headers,
    ...(role === undefined ? {} : { role }),
    ...(tenant === undefined ? {} : { tenant }),
    ...(description === undefined ? {} : { description }),
    ...(enabled === undefined ? {} : { enabled }),
    ...(expectedVersion === undefined ? {} : { expectedVersion })
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

function parseNotificationRulesArgs(argv: readonly string[]): ParsedCommand {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    return { kind: "help" };
  }
  const action = notificationRuleAction(subcommand);
  if (action === undefined) {
    return { kind: "invalid", message: `Unknown notification-rules command '${subcommand}'` };
  }

  let url: string | undefined;
  const headers: NotificationRuleHeaderOption[] = [];
  let doctype: string | undefined;
  let tenant: string | undefined;
  let ruleName: string | undefined;
  const events: string[] = [];
  const recipients: NotificationRuleRecipientOption[] = [];
  let subject: string | undefined;
  let enabled: boolean | undefined;
  let excludeActor: boolean | undefined;
  let expectedVersion: number | undefined;

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
      const parsed = parseLiteralHeader(value, "Notification rule");
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
      const parsed = parseEnvHeader(value, "Notification rule");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      headers.push(parsed);
      index += 1;
      continue;
    }
    if (arg === "--doctype") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      doctype = value;
      index += 1;
      continue;
    }
    if (arg === "--tenant") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      tenant = value;
      index += 1;
      continue;
    }
    if (arg === "--rule") {
      if (action === "list") {
        return { kind: "invalid", message: "Cannot use --rule with notification-rules list" };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      ruleName = value;
      index += 1;
      continue;
    }
    if (arg === "--event") {
      if (action !== "save") {
        return { kind: "invalid", message: `Cannot use --event with notification-rules ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      events.push(value);
      index += 1;
      continue;
    }
    if (arg === "--recipient-user") {
      if (action !== "save") {
        return { kind: "invalid", message: `Cannot use --recipient-user with notification-rules ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      recipients.push({ kind: "user", userId: value });
      index += 1;
      continue;
    }
    if (arg === "--recipient-field") {
      if (action !== "save") {
        return { kind: "invalid", message: `Cannot use --recipient-field with notification-rules ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      recipients.push({ kind: "field", field: value });
      index += 1;
      continue;
    }
    if (arg === "--recipient-owner") {
      if (action !== "save") {
        return { kind: "invalid", message: `Cannot use --recipient-owner with notification-rules ${action}` };
      }
      recipients.push({ kind: "documentOwner" });
      continue;
    }
    if (arg === "--subject") {
      if (action !== "save") {
        return { kind: "invalid", message: `Cannot use --subject with notification-rules ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      subject = value;
      index += 1;
      continue;
    }
    if (arg === "--enabled" || arg === "--disabled") {
      if (action !== "save") {
        return { kind: "invalid", message: `Cannot use ${arg} with notification-rules ${action}` };
      }
      const nextEnabled = arg === "--enabled";
      if (enabled !== undefined && enabled !== nextEnabled) {
        return { kind: "invalid", message: "Notification rule save cannot use both --enabled and --disabled" };
      }
      enabled = nextEnabled;
      continue;
    }
    if (arg === "--exclude-actor" || arg === "--include-actor") {
      if (action !== "save") {
        return { kind: "invalid", message: `Cannot use ${arg} with notification-rules ${action}` };
      }
      const nextExcludeActor = arg === "--exclude-actor";
      if (excludeActor !== undefined && excludeActor !== nextExcludeActor) {
        return { kind: "invalid", message: "Notification rule save cannot use both --exclude-actor and --include-actor" };
      }
      excludeActor = nextExcludeActor;
      continue;
    }
    if (arg === "--expected-version") {
      if (action === "list") {
        return { kind: "invalid", message: "Cannot use --expected-version with notification-rules list" };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseNonNegativeInteger(value, "Notification rule expected version");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      expectedVersion = parsed;
      index += 1;
      continue;
    }
    return { kind: "invalid", message: `Unknown notification-rules ${action} option '${arg}'` };
  }

  if (url === undefined) {
    return { kind: "invalid", message: "Missing value for --url" };
  }
  if (doctype === undefined) {
    return { kind: "invalid", message: `Notification rule ${action} requires --doctype` };
  }
  if (action !== "list" && ruleName === undefined) {
    return { kind: "invalid", message: `Notification rule ${action} requires --rule` };
  }
  if (action === "save" && events.length === 0) {
    return { kind: "invalid", message: "Notification rule save requires at least one --event" };
  }
  if (action === "save" && recipients.length === 0) {
    return {
      kind: "invalid",
      message: "Notification rule save requires at least one --recipient-user, --recipient-field, or --recipient-owner"
    };
  }

  return {
    kind: "notification-rules",
    action,
    url,
    headers,
    doctype,
    ...(tenant === undefined ? {} : { tenant }),
    ...(ruleName === undefined ? {} : { ruleName }),
    ...(events.length === 0 ? {} : { events }),
    ...(recipients.length === 0 ? {} : { recipients }),
    ...(subject === undefined ? {} : { subject }),
    ...(enabled === undefined ? {} : { enabled }),
    ...(excludeActor === undefined ? {} : { excludeActor }),
    ...(expectedVersion === undefined ? {} : { expectedVersion })
  };
}

function parseUserPermissionsArgs(argv: readonly string[]): ParsedCommand {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    return { kind: "help" };
  }
  const action = userPermissionAction(subcommand);
  if (action === undefined) {
    return { kind: "invalid", message: `Unknown user-permissions command '${subcommand}'` };
  }

  let url: string | undefined;
  const headers: UserPermissionHeaderOption[] = [];
  let userId: string | undefined;
  let tenant: string | undefined;
  let targetDoctype: string | undefined;
  let targetName: string | undefined;
  const applicableDoctypes: string[] = [];
  let expectedVersion: number | undefined;

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
      const parsed = parseLiteralHeader(value, "User permission");
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
      const parsed = parseEnvHeader(value, "User permission");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      headers.push(parsed);
      index += 1;
      continue;
    }
    if (arg === "--user-id") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      userId = value;
      index += 1;
      continue;
    }
    if (arg === "--tenant") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      tenant = value;
      index += 1;
      continue;
    }
    if (arg === "--target-doctype") {
      if (action === "list") {
        return { kind: "invalid", message: "Cannot use --target-doctype with user-permissions list" };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      targetDoctype = value;
      index += 1;
      continue;
    }
    if (arg === "--target-name") {
      if (action === "list") {
        return { kind: "invalid", message: "Cannot use --target-name with user-permissions list" };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      targetName = value;
      index += 1;
      continue;
    }
    if (arg === "--applicable-doctype") {
      if (action === "list") {
        return { kind: "invalid", message: "Cannot use --applicable-doctype with user-permissions list" };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      applicableDoctypes.push(value);
      index += 1;
      continue;
    }
    if (arg === "--expected-version") {
      if (action === "list") {
        return { kind: "invalid", message: "Cannot use --expected-version with user-permissions list" };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseNonNegativeInteger(value, "User permission expected version");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      expectedVersion = parsed;
      index += 1;
      continue;
    }
    return { kind: "invalid", message: `Unknown user-permissions ${action} option '${arg}'` };
  }

  if (url === undefined) {
    return { kind: "invalid", message: "Missing value for --url" };
  }
  if (userId === undefined) {
    return { kind: "invalid", message: `User permission ${action} requires --user-id` };
  }
  if (action !== "list" && targetDoctype === undefined) {
    return { kind: "invalid", message: `User permission ${action} requires --target-doctype` };
  }
  if (action !== "list" && targetName === undefined) {
    return { kind: "invalid", message: `User permission ${action} requires --target-name` };
  }

  return {
    kind: "user-permissions",
    action,
    url,
    headers,
    userId,
    ...(tenant === undefined ? {} : { tenant }),
    ...(targetDoctype === undefined ? {} : { targetDoctype }),
    ...(targetName === undefined ? {} : { targetName }),
    ...(applicableDoctypes.length === 0 ? {} : { applicableDoctypes }),
    ...(expectedVersion === undefined ? {} : { expectedVersion })
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
  let outputPath: string | undefined;
  let path: string | undefined;
  let renditionId: string | undefined;
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
  let width: number | undefined;
  let height: number | undefined;
  let fit: string | undefined;
  let format: string | undefined;
  let quality: number | undefined;
  let watermark: string | undefined;
  let watermarkPlacement: string | undefined;
  let watermarkOpacity: number | undefined;
  let watermarkColor: string | undefined;
  let watermarkFontSize: number | undefined;
  let overlay: string | undefined;
  let overlayPlacement: string | undefined;
  let overlayOpacity: number | undefined;
  let overlayWidth: number | undefined;
  let overlayHeight: number | undefined;

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
      if (
        action !== "delete" &&
        action !== "download" &&
        action !== "get" &&
        action !== "update" &&
        action !== "rendition" &&
        action !== "preview-download" &&
        action !== "rendition-download" &&
        action !== "transform-download"
      ) {
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
    if (arg === "--output") {
      if (!isFileDownloadAction(action)) {
        return { kind: "invalid", message: `Cannot use --output with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      outputPath = value;
      index += 1;
      continue;
    }
    if (arg === "--rendition-id") {
      if (action !== "rendition-download") {
        return { kind: "invalid", message: `Cannot use --rendition-id with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      renditionId = value;
      index += 1;
      continue;
    }
    if (arg === "--path") {
      if (action !== "upload") {
        return { kind: "invalid", message: `Cannot use --path with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      path = value;
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
    if (arg === "--width" || arg === "--height" || arg === "--quality") {
      if (!isFileTransformOptionAction(action)) {
        return { kind: "invalid", message: `Cannot use ${arg} with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parsePositiveInteger(value, fileTransformIntegerLabel(arg));
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      if (arg === "--width") {
        width = parsed;
      } else if (arg === "--height") {
        height = parsed;
      } else {
        quality = parsed;
      }
      index += 1;
      continue;
    }
    if (arg === "--fit" || arg === "--format" || arg === "--watermark" || arg === "--watermark-placement" || arg === "--watermark-color" || arg === "--overlay" || arg === "--overlay-placement") {
      if (!isFileTransformOptionAction(action)) {
        return { kind: "invalid", message: `Cannot use ${arg} with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      if (arg === "--fit") {
        fit = value;
      } else if (arg === "--format") {
        format = value;
      } else if (arg === "--watermark") {
        watermark = value;
      } else if (arg === "--watermark-placement") {
        watermarkPlacement = value;
      } else if (arg === "--watermark-color") {
        watermarkColor = value;
      } else if (arg === "--overlay") {
        overlay = value;
      } else {
        overlayPlacement = value;
      }
      index += 1;
      continue;
    }
    if (arg === "--watermark-opacity" || arg === "--watermark-font-size" || arg === "--overlay-opacity" || arg === "--overlay-width" || arg === "--overlay-height") {
      if (!isFileTransformOptionAction(action)) {
        return { kind: "invalid", message: `Cannot use ${arg} with files ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parsePositiveInteger(value, fileTransformIntegerLabel(arg));
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      if (arg === "--watermark-opacity") {
        watermarkOpacity = parsed;
      } else if (arg === "--watermark-font-size") {
        watermarkFontSize = parsed;
      } else if (arg === "--overlay-opacity") {
        overlayOpacity = parsed;
      } else if (arg === "--overlay-width") {
        overlayWidth = parsed;
      } else {
        overlayHeight = parsed;
      }
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
      if (action !== "list" && action !== "update" && action !== "bulk-update" && action !== "upload") {
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
      if (action !== "list" && action !== "update" && action !== "bulk-update" && action !== "upload") {
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
      if (action !== "list" && action !== "upload") {
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
      if (action !== "list" && action !== "update" && action !== "upload") {
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
      if (action !== "list" && action !== "update" && action !== "bulk-update" && action !== "upload") {
        return { kind: "invalid", message: `Cannot use --private with files ${action}` };
      }
      if (isPrivate !== undefined) {
        return { kind: "invalid", message: "Use only one of --private or --public" };
      }
      isPrivate = true;
      continue;
    }
    if (arg === "--public") {
      if (action !== "list" && action !== "update" && action !== "bulk-update" && action !== "upload") {
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
  if (
    (action === "delete" ||
      action === "download" ||
      action === "get" ||
      action === "update" ||
      action === "rendition" ||
      action === "preview-download" ||
      action === "rendition-download" ||
      action === "transform-download") &&
    name === undefined
  ) {
    return { kind: "invalid", message: `File ${action} requires --name` };
  }
  if (isFileDownloadAction(action)) {
    if (action === "rendition-download" && renditionId === undefined) {
      return { kind: "invalid", message: "File rendition download requires --rendition-id" };
    }
    if (outputPath === undefined) {
      return {
        kind: "invalid",
        message: fileDownloadOutputMessage(action)
      };
    }
  }
  if (action === "upload" && path === undefined) {
    return { kind: "invalid", message: "File upload requires --path" };
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
  if (watermark === undefined && (
    watermarkPlacement !== undefined ||
    watermarkOpacity !== undefined ||
    watermarkColor !== undefined ||
    watermarkFontSize !== undefined
  )) {
    return { kind: "invalid", message: "Use --watermark before watermark detail options" };
  }
  if (overlay === undefined && (
    overlayPlacement !== undefined ||
    overlayOpacity !== undefined ||
    overlayWidth !== undefined ||
    overlayHeight !== undefined
  )) {
    return { kind: "invalid", message: "Use --overlay before overlay detail options" };
  }
  if (action === "rendition" && !hasRenditionOption(width, height, fit, format, quality, watermark, overlay)) {
    return { kind: "invalid", message: "File rendition requires at least one transform option" };
  }
  if (action === "transform-download" && !hasRenditionOption(width, height, fit, format, quality, watermark, overlay)) {
    return { kind: "invalid", message: "File transform download requires at least one transform option" };
  }
  return {
    kind: "files",
    action,
    url,
    headers,
    ...(name === undefined ? {} : { name }),
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(path === undefined ? {} : { path }),
    ...(renditionId === undefined ? {} : { renditionId }),
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
    ...(clearAttachment ? { clearAttachment } : {}),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(fit === undefined ? {} : { fit }),
    ...(format === undefined ? {} : { format }),
    ...(quality === undefined ? {} : { quality }),
    ...(watermark === undefined ? {} : { watermark }),
    ...(watermarkPlacement === undefined ? {} : { watermarkPlacement }),
    ...(watermarkOpacity === undefined ? {} : { watermarkOpacity }),
    ...(watermarkColor === undefined ? {} : { watermarkColor }),
    ...(watermarkFontSize === undefined ? {} : { watermarkFontSize }),
    ...(overlay === undefined ? {} : { overlay }),
    ...(overlayPlacement === undefined ? {} : { overlayPlacement }),
    ...(overlayOpacity === undefined ? {} : { overlayOpacity }),
    ...(overlayWidth === undefined ? {} : { overlayWidth }),
    ...(overlayHeight === undefined ? {} : { overlayHeight })
  };
}

function parseResourcesArgs(argv: readonly string[]): ParsedCommand {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    return { kind: "help" };
  }
  const action = resourceAction(subcommand);
  if (action === undefined) {
    return { kind: "invalid", message: `Unknown resources command '${subcommand}'` };
  }

  let url: string | undefined;
  const headers: ResourceHeaderOption[] = [];
  let doctype: string | undefined;
  let name: string | undefined;
  let filterId: string | undefined;
  let userId: string | undefined;
  let assignee: string | undefined;
  let tag: string | undefined;
  let follower: string | undefined;
  let text: string | undefined;
  let subject: string | undefined;
  let activityType: string | undefined;
  let detail: string | undefined;
  let channel: string | undefined;
  let externalId: string | undefined;
  const permissions: string[] = [];
  let label: string | undefined;
  let transition: string | undefined;
  let commandName: string | undefined;
  let data: Record<string, unknown> | undefined;
  let newName: string | undefined;
  let outputPath: string | undefined;
  let path: string | undefined;
  let importMode: ResourceRemoteCommand["importMode"] | undefined;
  let expectedVersion: number | undefined;
  let maxRows: number | undefined;
  const documents: NonNullable<ResourceRemoteCommand["documents"]>[number][] = [];
  const filters: NonNullable<ResourceRemoteCommand["filters"]>[number][] = [];
  let filterExpression: Record<string, unknown> | undefined;
  let savedFilter: string | undefined;
  let limit: number | undefined;
  let beforeSequence: number | undefined;
  let offset: number | undefined;
  let orderBy: string | undefined;
  let order: ResourceRemoteCommand["order"] | undefined;
  let useDefaultFilters: boolean | undefined;

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
      const parsed = parseLiteralHeader(value, "Resource");
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
      const parsed = parseEnvHeader(value, "Resource");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      headers.push(parsed);
      index += 1;
      continue;
    }
    if (arg === "--doctype") {
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      doctype = value;
      index += 1;
      continue;
    }
    if (arg === "--name") {
      if (!isNamedResourceAction(action)) {
        return { kind: "invalid", message: `Cannot use --name with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      name = value;
      index += 1;
      continue;
    }
    if (arg === "--filter-id") {
      if (action !== "delete-filter") {
        return { kind: "invalid", message: `Cannot use --filter-id with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      filterId = value;
      index += 1;
      continue;
    }
    if (arg === "--user-id") {
      if (action !== "share" && action !== "unshare") {
        return { kind: "invalid", message: `Cannot use --user-id with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      userId = value;
      index += 1;
      continue;
    }
    if (arg === "--assignee") {
      if (action !== "assign" && action !== "unassign") {
        return { kind: "invalid", message: `Cannot use --assignee with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      assignee = value;
      index += 1;
      continue;
    }
    if (arg === "--tag") {
      if (action !== "tag" && action !== "untag") {
        return { kind: "invalid", message: `Cannot use --tag with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      tag = value;
      index += 1;
      continue;
    }
    if (arg === "--follower") {
      if (action !== "follow" && action !== "unfollow") {
        return { kind: "invalid", message: `Cannot use --follower with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      follower = value;
      index += 1;
      continue;
    }
    if (arg === "--text") {
      if (action !== "comment") {
        return { kind: "invalid", message: `Cannot use --text with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      text = value;
      index += 1;
      continue;
    }
    if (arg === "--subject") {
      if (action !== "activity") {
        return { kind: "invalid", message: `Cannot use --subject with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      subject = value;
      index += 1;
      continue;
    }
    if (arg === "--activity-type") {
      if (action !== "activity") {
        return { kind: "invalid", message: `Cannot use --activity-type with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      activityType = value;
      index += 1;
      continue;
    }
    if (arg === "--detail") {
      if (action !== "activity") {
        return { kind: "invalid", message: `Cannot use --detail with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      detail = value;
      index += 1;
      continue;
    }
    if (arg === "--channel") {
      if (action !== "activity") {
        return { kind: "invalid", message: `Cannot use --channel with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      channel = value;
      index += 1;
      continue;
    }
    if (arg === "--external-id") {
      if (action !== "activity") {
        return { kind: "invalid", message: `Cannot use --external-id with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      externalId = value;
      index += 1;
      continue;
    }
    if (arg === "--permission") {
      if (action !== "share") {
        return { kind: "invalid", message: `Cannot use --permission with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      permissions.push(value);
      index += 1;
      continue;
    }
    if (arg === "--label") {
      if (action !== "save-filter") {
        return { kind: "invalid", message: `Cannot use --label with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      label = value;
      index += 1;
      continue;
    }
    if (arg === "--data-json") {
      if (!isResourceDataAction(action)) {
        return { kind: "invalid", message: `Cannot use --data-json with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseJsonObject(value, "Resource data");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      data = parsed;
      index += 1;
      continue;
    }
    if (arg === "--new-name") {
      if (action !== "duplicate" && action !== "amend") {
        return { kind: "invalid", message: `Cannot use --new-name with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      newName = value;
      index += 1;
      continue;
    }
    if (arg === "--transition") {
      if (action !== "transition" && action !== "bulk-transition") {
        return { kind: "invalid", message: `Cannot use --transition with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      transition = value;
      index += 1;
      continue;
    }
    if (arg === "--command") {
      if (action !== "command") {
        return { kind: "invalid", message: `Cannot use --command with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      commandName = value;
      index += 1;
      continue;
    }
    if (arg === "--expected-version") {
      if (!isResourceVersionAction(action)) {
        return { kind: "invalid", message: `Cannot use --expected-version with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parsePositiveInteger(value, "Resource expected version");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      expectedVersion = parsed;
      index += 1;
      continue;
    }
    if (arg === "--output") {
      if (action !== "export" && action !== "import-template") {
        return { kind: "invalid", message: `Cannot use --output with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      outputPath = value;
      index += 1;
      continue;
    }
    if (arg === "--path") {
      if (action !== "import") {
        return { kind: "invalid", message: `Cannot use --path with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      path = value;
      index += 1;
      continue;
    }
    if (arg === "--mode") {
      if (action !== "import") {
        return { kind: "invalid", message: `Cannot use --mode with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      if (value !== "create" && value !== "update") {
        return { kind: "invalid", message: "Resource import mode must be create or update" };
      }
      importMode = value;
      index += 1;
      continue;
    }
    if (arg === "--max-rows") {
      if (action !== "import") {
        return { kind: "invalid", message: `Cannot use --max-rows with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parsePositiveInteger(value, "Resource import max rows");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      maxRows = parsed;
      index += 1;
      continue;
    }
    if (arg === "--document") {
      if (!isBulkResourceAction(action)) {
        return { kind: "invalid", message: `Cannot use --document with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      documents.push({ name: value });
      index += 1;
      continue;
    }
    if (arg === "--document-version") {
      if (!isBulkResourceAction(action)) {
        return { kind: "invalid", message: `Cannot use --document-version with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseResourceSelectionWithVersion(value);
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      documents.push(parsed);
      index += 1;
      continue;
    }
    if (arg === "--filter") {
      if (!isResourceFilterInputAction(action)) {
        return { kind: "invalid", message: `Cannot use --filter with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseResourceFilter(value);
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      filters.push(parsed);
      index += 1;
      continue;
    }
    if (arg === "--filter-expression-json") {
      if (!isResourceFilterInputAction(action)) {
        return { kind: "invalid", message: `Cannot use --filter-expression-json with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseJsonObject(value, "Resource filter expression");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      filterExpression = parsed;
      index += 1;
      continue;
    }
    if (arg === "--saved-filter") {
      if (!isResourceListQueryAction(action)) {
        return { kind: "invalid", message: `Cannot use --saved-filter with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      savedFilter = value;
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      if (!isResourceListQueryAction(action) && action !== "timeline") {
        return { kind: "invalid", message: `Cannot use --limit with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parsePositiveInteger(value, "Resource list limit");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      limit = parsed;
      index += 1;
      continue;
    }
    if (arg === "--before-sequence") {
      if (action !== "timeline") {
        return { kind: "invalid", message: `Cannot use --before-sequence with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parsePositiveInteger(value, "Resource timeline before sequence");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      beforeSequence = parsed;
      index += 1;
      continue;
    }
    if (arg === "--offset") {
      if (action !== "list") {
        return { kind: "invalid", message: `Cannot use --offset with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      const parsed = parseNonNegativeInteger(value, "Resource list offset");
      if (typeof parsed === "string") {
        return { kind: "invalid", message: parsed };
      }
      offset = parsed;
      index += 1;
      continue;
    }
    if (arg === "--order-by") {
      if (!isResourceListQueryAction(action)) {
        return { kind: "invalid", message: `Cannot use --order-by with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      orderBy = value;
      index += 1;
      continue;
    }
    if (arg === "--order") {
      if (!isResourceListQueryAction(action)) {
        return { kind: "invalid", message: `Cannot use --order with resources ${action}` };
      }
      const value = parseRequiredOption(rest, index, arg);
      if (typeof value !== "string") {
        return value;
      }
      if (value !== "asc" && value !== "desc") {
        return { kind: "invalid", message: "Resource list order must be asc or desc" };
      }
      order = value;
      index += 1;
      continue;
    }
    if (arg === "--no-default-filters") {
      if (!isResourceListQueryAction(action)) {
        return { kind: "invalid", message: `Cannot use --no-default-filters with resources ${action}` };
      }
      useDefaultFilters = false;
      continue;
    }
    return { kind: "invalid", message: `Unknown resources ${action} option '${arg}'` };
  }

  if (url === undefined) {
    return { kind: "invalid", message: "Missing value for --url" };
  }
  if (doctype === undefined) {
    return { kind: "invalid", message: "Resource command requires --doctype" };
  }
  if (isNamedResourceAction(action) && name === undefined) {
    return { kind: "invalid", message: `Resource ${action} requires --name` };
  }
  if ((action === "share" || action === "unshare") && userId === undefined) {
    return { kind: "invalid", message: `Resource ${action} requires --user-id` };
  }
  if ((action === "assign" || action === "unassign") && assignee === undefined) {
    return { kind: "invalid", message: `Resource ${action} requires --assignee` };
  }
  if ((action === "tag" || action === "untag") && tag === undefined) {
    return { kind: "invalid", message: `Resource ${action} requires --tag` };
  }
  if (action === "unfollow" && follower === undefined) {
    return { kind: "invalid", message: "Resource unfollow requires --follower" };
  }
  if (action === "comment" && text === undefined) {
    return { kind: "invalid", message: "Resource comment requires --text" };
  }
  if (action === "activity" && subject === undefined) {
    return { kind: "invalid", message: "Resource activity requires --subject" };
  }
  if ((action === "create" || action === "update") && data === undefined) {
    return { kind: "invalid", message: `Resource ${action} requires --data-json` };
  }
  if ((action === "transition" || action === "bulk-transition") && transition === undefined) {
    return { kind: "invalid", message: `Resource ${action} requires --transition` };
  }
  if (action === "command" && commandName === undefined) {
    return { kind: "invalid", message: "Resource command requires --command" };
  }
  if (action === "delete-filter" && filterId === undefined) {
    return { kind: "invalid", message: "Resource delete-filter requires --filter-id" };
  }
  if (action === "save-filter" && label === undefined) {
    return { kind: "invalid", message: "Resource save-filter requires --label" };
  }
  if ((action === "export" || action === "import-template") && outputPath === undefined) {
    return { kind: "invalid", message: `Resource ${action} requires --output` };
  }
  if (action === "import" && path === undefined) {
    return { kind: "invalid", message: "Resource import requires --path" };
  }
  if (isBulkResourceAction(action) && documents.length === 0) {
    return { kind: "invalid", message: `Resource ${action} requires at least one --document or --document-version` };
  }
  const duplicateDocument = duplicateResourceSelection(documents);
  if (duplicateDocument !== undefined) {
    return { kind: "invalid", message: `Duplicate resource selection '${duplicateDocument}'` };
  }
  return {
    kind: "resources",
    action,
    url,
    headers,
    doctype,
    ...(name === undefined ? {} : { name }),
    ...(filterId === undefined ? {} : { filterId }),
    ...(userId === undefined ? {} : { userId }),
    ...(assignee === undefined ? {} : { assignee }),
    ...(tag === undefined ? {} : { tag }),
    ...(follower === undefined ? {} : { follower }),
    ...(text === undefined ? {} : { text }),
    ...(subject === undefined ? {} : { subject }),
    ...(activityType === undefined ? {} : { activityType }),
    ...(detail === undefined ? {} : { detail }),
    ...(channel === undefined ? {} : { channel }),
    ...(externalId === undefined ? {} : { externalId }),
    ...(permissions.length === 0 ? {} : { permissions }),
    ...(label === undefined ? {} : { label }),
    ...(transition === undefined ? {} : { transition }),
    ...(commandName === undefined ? {} : { command: commandName }),
    ...(data === undefined ? {} : { data }),
    ...(newName === undefined ? {} : { newName }),
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(path === undefined ? {} : { path }),
    ...(importMode === undefined ? {} : { importMode }),
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    ...(maxRows === undefined ? {} : { maxRows }),
    ...(documents.length === 0 ? {} : { documents }),
    ...(filters.length === 0 ? {} : { filters }),
    ...(filterExpression === undefined ? {} : { filterExpression }),
    ...(savedFilter === undefined ? {} : { savedFilter }),
    ...(limit === undefined ? {} : { limit }),
    ...(beforeSequence === undefined ? {} : { beforeSequence }),
    ...(offset === undefined ? {} : { offset }),
    ...(orderBy === undefined ? {} : { orderBy }),
    ...(order === undefined ? {} : { order }),
    ...(useDefaultFilters === undefined ? {} : { useDefaultFilters })
  };
}

function fileAction(value: string): FileRemoteAction | undefined {
  return value === "list" ||
    value === "delete" ||
    value === "download" ||
    value === "get" ||
    value === "preview-download" ||
    value === "update" ||
    value === "bulk-delete" ||
    value === "bulk-update" ||
    value === "rendition" ||
    value === "rendition-download" ||
    value === "transform-download" ||
    value === "upload"
    ? value
    : undefined;
}

function customFieldAction(value: string): CustomFieldRemoteAction | undefined {
  return value === "disable" || value === "list" || value === "save" ? value : undefined;
}

function fieldPropertyAction(value: string): FieldPropertyRemoteAction | undefined {
  return value === "clear" || value === "list" || value === "save" ? value : undefined;
}

function userPermissionAction(value: string): UserPermissionRemoteAction | undefined {
  return value === "allow" || value === "list" || value === "revoke" ? value : undefined;
}

function notificationRuleAction(value: string): NotificationRuleRemoteAction | undefined {
  return value === "clear" || value === "list" || value === "save" ? value : undefined;
}

function workflowAction(value: string): WorkflowRemoteAction | undefined {
  return value === "clear" || value === "get" || value === "save" ? value : undefined;
}

function roleAction(value: string): RoleRemoteAction | undefined {
  return value === "create" ||
    value === "describe" ||
    value === "disable" ||
    value === "enable" ||
    value === "get" ||
    value === "list"
    ? value
    : undefined;
}

function resourceAction(value: string): ResourceRemoteAction | undefined {
  return value === "activity" ||
    value === "amend" ||
    value === "assign" ||
    value === "assignments" ||
    value === "bulk-cancel" ||
    value === "bulk-delete" ||
    value === "bulk-submit" ||
    value === "bulk-transition" ||
    value === "cancel" ||
    value === "comment" ||
    value === "command" ||
    value === "list" ||
    value === "get" ||
    value === "create" ||
    value === "duplicate" ||
    value === "export" ||
    value === "follow" ||
    value === "followers" ||
    value === "submit" ||
    value === "import" ||
    value === "import-template" ||
    value === "delete-filter" ||
    value === "save-filter" ||
    value === "saved-filters" ||
    value === "share" ||
    value === "shares" ||
    value === "tag" ||
    value === "tags" ||
    value === "timeline" ||
    value === "transition" ||
    value === "unassign" ||
    value === "unfollow" ||
    value === "unshare" ||
    value === "untag" ||
    value === "update" ||
    value === "delete"
    ? value
    : undefined;
}

function isNamedResourceAction(action: ResourceRemoteAction): boolean {
  return action === "activity" ||
    action === "amend" ||
    action === "assign" ||
    action === "assignments" ||
    action === "cancel" ||
    action === "comment" ||
    action === "command" ||
    action === "delete" ||
    action === "duplicate" ||
    action === "follow" ||
    action === "followers" ||
    action === "get" ||
    action === "share" ||
    action === "shares" ||
    action === "submit" ||
    action === "tag" ||
    action === "tags" ||
    action === "timeline" ||
    action === "transition" ||
    action === "unassign" ||
    action === "unfollow" ||
    action === "unshare" ||
    action === "untag" ||
    action === "update";
}

function isResourceDataAction(action: ResourceRemoteAction): boolean {
  return action === "amend" ||
    action === "command" ||
    action === "create" ||
    action === "duplicate" ||
    action === "update";
}

function isResourceVersionAction(action: ResourceRemoteAction): boolean {
  return action === "activity" ||
    action === "amend" ||
    action === "assign" ||
    action === "cancel" ||
    action === "comment" ||
    action === "command" ||
    action === "delete" ||
    action === "duplicate" ||
    action === "follow" ||
    action === "share" ||
    action === "submit" ||
    action === "tag" ||
    action === "transition" ||
    action === "unassign" ||
    action === "unfollow" ||
    action === "unshare" ||
    action === "untag" ||
    action === "update";
}

function isBulkResourceAction(action: ResourceRemoteAction): boolean {
  return action === "bulk-cancel" ||
    action === "bulk-delete" ||
    action === "bulk-submit" ||
    action === "bulk-transition";
}

function isResourceListQueryAction(action: ResourceRemoteAction): boolean {
  return action === "list" || action === "export";
}

function isResourceFilterInputAction(action: ResourceRemoteAction): boolean {
  return action === "list" || action === "export" || action === "save-filter";
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

function isFileTransformOptionAction(action: FileRemoteAction): boolean {
  return action === "rendition" || action === "transform-download";
}

function isFileDownloadAction(action: FileRemoteAction): boolean {
  return action === "download" ||
    action === "preview-download" ||
    action === "rendition-download" ||
    action === "transform-download";
}

function fileDownloadOutputMessage(action: FileRemoteAction): string {
  if (action === "preview-download") {
    return "File preview download requires --output";
  }
  if (action === "rendition-download") {
    return "File rendition download requires --output";
  }
  if (action === "transform-download") {
    return "File transform download requires --output";
  }
  return "File download requires --output";
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

function parseLiteralHeader(
  value: string,
  label: string
): CustomFieldHeaderOption | DataPatchHeaderOption | FieldPropertyHeaderOption | JobHeaderOption | NotificationRuleHeaderOption | FileHeaderOption | ResourceHeaderOption | RoleHeaderOption | WorkflowHeaderOption | string {
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

function parseEnvHeader(
  value: string,
  label: string
): CustomFieldHeaderOption | DataPatchHeaderOption | FieldPropertyHeaderOption | JobHeaderOption | NotificationRuleHeaderOption | FileHeaderOption | ResourceHeaderOption | RoleHeaderOption | WorkflowHeaderOption | string {
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

function parseResourceFilter(value: string): NonNullable<ResourceRemoteCommand["filters"]>[number] | string {
  const separator = value.indexOf("=");
  if (separator < 1) {
    return "Resource filter must use <field[__operator]>=<value>";
  }
  const key = value.slice(0, separator).trim();
  if (key.length === 0 || key.startsWith("filter_")) {
    return "Resource filter field must be non-empty and omit the filter_ prefix";
  }
  return { key, value: value.slice(separator + 1).trim() };
}

function parseResourceSelectionWithVersion(
  value: string
): NonNullable<ResourceRemoteCommand["documents"]>[number] | string {
  const separator = value.lastIndexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    return "Resource version selection must use <docname>:<expectedVersion>";
  }
  const expectedVersion = parsePositiveInteger(value.slice(separator + 1), "Resource expected version");
  if (typeof expectedVersion === "string") {
    return expectedVersion;
  }
  return { name: value.slice(0, separator), expectedVersion };
}

function duplicateResourceSelection(
  documents: readonly NonNullable<ResourceRemoteCommand["documents"]>[number][]
): string | undefined {
  const seen = new Set<string>();
  for (const document of documents) {
    if (seen.has(document.name)) {
      return document.name;
    }
    seen.add(document.name);
  }
  return undefined;
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

function fileTransformIntegerLabel(option: string): string {
  return `File rendition ${option.slice(2).replaceAll("-", " ")}`;
}

function hasRenditionOption(...values: readonly (number | string | undefined)[]): boolean {
  return values.some((value) => value !== undefined);
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
    "  cf-frappe custom-fields list --url <origin> --doctype <doctype> [--tenant <tenant>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe custom-fields save --url <origin> --doctype <doctype> --field-json <json> [--tenant <tenant>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe custom-fields disable --url <origin> --doctype <doctype> --field <fieldname> [--tenant <tenant>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe field-properties list --url <origin> --doctype <doctype> [--tenant <tenant>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe field-properties save --url <origin> --doctype <doctype> --field <fieldname> --overrides-json <json> [--tenant <tenant>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe field-properties clear --url <origin> --doctype <doctype> --field <fieldname> [--tenant <tenant>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
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
    "  cf-frappe notification-rules list --url <origin> --doctype <doctype> [--tenant <tenant>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe notification-rules save --url <origin> --doctype <doctype> --rule <name> --event <eventKind>... (--recipient-user <user>|--recipient-field <field>|--recipient-owner)... [--subject <text>] [--enabled|--disabled] [--exclude-actor|--include-actor] [--tenant <tenant>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe notification-rules clear --url <origin> --doctype <doctype> --rule <name> [--tenant <tenant>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe workflows get --url <origin> --doctype <doctype> [--tenant <tenant>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe workflows save --url <origin> --doctype <doctype> --workflow-json <json> [--tenant <tenant>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe workflows clear --url <origin> --doctype <doctype> [--tenant <tenant>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe roles list --url <origin> [--tenant <tenant>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe roles get --url <origin> --role <role> [--tenant <tenant>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe roles create --url <origin> --role <role> [--description <text>] [--enabled|--disabled] [--tenant <tenant>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe roles describe --url <origin> --role <role> --description <text> [--tenant <tenant>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe roles enable --url <origin> --role <role> [--tenant <tenant>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe roles disable --url <origin> --role <role> [--tenant <tenant>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources list --url <origin> --doctype <doctype> [--filter <field[__operator]=value>] [--filter-expression-json <json>] [--saved-filter <id>] [--limit <n>] [--offset <n>] [--order-by <field>] [--order <asc|desc>] [--no-default-filters] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources get --url <origin> --doctype <doctype> --name <docname> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources create --url <origin> --doctype <doctype> --data-json <json> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources update --url <origin> --doctype <doctype> --name <docname> --data-json <json> [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources delete --url <origin> --doctype <doctype> --name <docname> [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources submit --url <origin> --doctype <doctype> --name <docname> [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources cancel --url <origin> --doctype <doctype> --name <docname> [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources transition --url <origin> --doctype <doctype> --name <docname> --transition <action> [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources command --url <origin> --doctype <doctype> --name <docname> --command <name> [--data-json <json>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources duplicate --url <origin> --doctype <doctype> --name <docname> [--data-json <json>] [--new-name <docname>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources amend --url <origin> --doctype <doctype> --name <docname> [--data-json <json>] [--new-name <docname>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources timeline --url <origin> --doctype <doctype> --name <docname> [--limit <n>] [--before-sequence <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources comment --url <origin> --doctype <doctype> --name <docname> --text <text> [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources activity --url <origin> --doctype <doctype> --name <docname> --subject <subject> [--activity-type <type>] [--detail <detail>] [--channel <channel>] [--external-id <id>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources assignments --url <origin> --doctype <doctype> --name <docname> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources assign --url <origin> --doctype <doctype> --name <docname> --assignee <user> [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources unassign --url <origin> --doctype <doctype> --name <docname> --assignee <user> [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources tags --url <origin> --doctype <doctype> --name <docname> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources tag --url <origin> --doctype <doctype> --name <docname> --tag <tag> [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources untag --url <origin> --doctype <doctype> --name <docname> --tag <tag> [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources followers --url <origin> --doctype <doctype> --name <docname> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources follow --url <origin> --doctype <doctype> --name <docname> [--follower <user>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources unfollow --url <origin> --doctype <doctype> --name <docname> --follower <user> [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources shares --url <origin> --doctype <doctype> --name <docname> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources share --url <origin> --doctype <doctype> --name <docname> --user-id <user> [--permission <read|update|share|write>]... [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources unshare --url <origin> --doctype <doctype> --name <docname> --user-id <user> [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources saved-filters --url <origin> --doctype <doctype> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources save-filter --url <origin> --doctype <doctype> --label <name> [--filter <field[__operator]=value>] [--filter-expression-json <json>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources delete-filter --url <origin> --doctype <doctype> --filter-id <id> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources export --url <origin> --doctype <doctype> --output <localPath> [--filter <field[__operator]=value>] [--filter-expression-json <json>] [--saved-filter <id>] [--limit <n>] [--order-by <field>] [--order <asc|desc>] [--no-default-filters] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources import-template --url <origin> --doctype <doctype> --output <localPath> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources import --url <origin> --doctype <doctype> --path <localPath> [--mode <create|update>] [--max-rows <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources bulk-delete --url <origin> --doctype <doctype> (--document <docname>|--document-version <docname:version>)... [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources bulk-submit --url <origin> --doctype <doctype> (--document <docname>|--document-version <docname:version>)... [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources bulk-cancel --url <origin> --doctype <doctype> (--document <docname>|--document-version <docname:version>)... [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe resources bulk-transition --url <origin> --doctype <doctype> --transition <action> (--document <docname>|--document-version <docname:version>)... [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe user-permissions list --url <origin> --user-id <user> [--tenant <tenant>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe user-permissions allow --url <origin> --user-id <user> --target-doctype <doctype> --target-name <docname> [--applicable-doctype <doctype>]... [--tenant <tenant>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe user-permissions revoke --url <origin> --user-id <user> --target-doctype <doctype> --target-name <docname> [--applicable-doctype <doctype>]... [--tenant <tenant>] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files list --url <origin> [--filename <text>] [--content-type <type>] [--attached-to-doctype <doctype> --attached-to-name <name>] [--storage-state <state>] [--scan-status <status>] [--uploaded-by <user>] [--private|--public] [--limit <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files get --url <origin> --name <fileName> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files upload --url <origin> --path <localPath> [--filename <text>] [--content-type <type>] [--private|--public] [--attached-to-doctype <doctype> --attached-to-name <name>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files download --url <origin> --name <fileName> --output <localPath> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files preview-download --url <origin> --name <fileName> --output <localPath> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files update --url <origin> --name <fileName> [--filename <text>] [--private|--public] [--attached-to-doctype <doctype> --attached-to-name <name>|--clear-attachment] [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files bulk-update --url <origin> (--file <fileName>|--file-version <fileName:version>)... [--private|--public] [--attached-to-doctype <doctype> --attached-to-name <name>|--clear-attachment] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files bulk-delete --url <origin> (--file <fileName>|--file-version <fileName:version>)... [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files rendition --url <origin> --name <fileName> [--width <n>] [--height <n>] [--fit <mode>] [--format <type>] [--quality <n>] [--watermark <text> [--watermark-placement <place>] [--watermark-opacity <n>] [--watermark-color <hex>] [--watermark-font-size <n>]] [--overlay <fileName> [--overlay-placement <place>] [--overlay-opacity <n>] [--overlay-width <n>] [--overlay-height <n>]] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files rendition-download --url <origin> --name <fileName> --rendition-id <id> --output <localPath> [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files transform-download --url <origin> --name <fileName> --output <localPath> [--width <n>] [--height <n>] [--fit <mode>] [--format <type>] [--quality <n>] [--watermark <text> [--watermark-placement <place>] [--watermark-opacity <n>] [--watermark-color <hex>] [--watermark-font-size <n>]] [--overlay <fileName> [--overlay-placement <place>] [--overlay-opacity <n>] [--overlay-width <n>] [--overlay-height <n>]] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe files delete --url <origin> --name <fileName> [--expected-version <n>] [--header <name:value>] [--header-env <name=ENV>]",
    "  cf-frappe --help",
    "",
    "Commands:",
    "  init   Create a Cloudflare-ready cf-frappe starter app",
    "  install   Save, install, and wire an app module into a generated app registry",
    "  migrate generate   Write reviewable D1 migration files from app metadata",
    "  access   Plan or create Cloudflare Access application and policy resources for a starter app",
    "  custom-fields   Inspect and mutate event-sourced tenant custom field overlays through the admin API",
    "  field-properties   Inspect and mutate event-sourced tenant field property overrides through the admin API",
    "  data-patches   Inspect, plan, apply, rollback, or enqueue remote app-declared data patches through the admin API",
    "  jobs   Inspect remote job history, retry failed runs, and manage runtime schedules through the admin API",
    "  notification-rules   Inspect and mutate event-sourced document notification rules through the admin API",
    "  workflows   Inspect and mutate event-sourced tenant workflow definitions through the admin API",
    "  roles   Inspect and mutate event-sourced tenant role catalogs through the admin API",
    "  resources   Inspect and mutate deployed DocType resources through the generated resource API",
    "  user-permissions   Inspect and mutate event-sourced linked-record user permission grants",
    "  files   Upload, inspect, update, and delete remote File metadata/content through the admin API",
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
