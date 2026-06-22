/// <reference types="node" />
import { relative } from "node:path";
import { installAppModule, AppInstallError } from "./app-install.js";
import { scaffoldProject, ScaffoldError } from "./scaffold.js";

export interface CliIo {
  readonly cwd: () => string;
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
  readonly localName?: string;
  readonly registryFile?: string;
}

interface HelpCommand {
  readonly kind: "help";
}

interface InvalidCommand {
  readonly kind: "invalid";
  readonly message: string;
}

type ParsedCommand = InitCommand | InstallCommand | HelpCommand | InvalidCommand;

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
      const result = await installAppModule({
        cwd: io.cwd(),
        moduleSpecifier: command.moduleSpecifier,
        ...(command.exportName === undefined ? {} : { exportName: command.exportName }),
        ...(command.localName === undefined ? {} : { localName: command.localName }),
        ...(command.registryFile === undefined ? {} : { registryFile: command.registryFile })
      });
      io.stdout.write(
        `Wired ${result.moduleSpecifier} as ${result.localName} into ${result.registryFile}\n`
      );
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
    if (error instanceof ScaffoldError || error instanceof AppInstallError) {
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
  if (command !== "init") {
    return { kind: "invalid", message: `Unknown command '${command}'` };
  }
  return parseInitArgs(rest);
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
  let exportName: string | undefined;
  let localName: string | undefined;
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
    if (arg === "--as") {
      const value = argv[index + 1];
      if (value === undefined) {
        return { kind: "invalid", message: "Missing value for --as" };
      }
      localName = value;
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
  return {
    kind: "install",
    moduleSpecifier,
    ...(exportName === undefined ? {} : { exportName }),
    ...(localName === undefined ? {} : { localName }),
    ...(registryFile === undefined ? {} : { registryFile })
  };
}

function helpText(): string {
  return [
    "cf-frappe",
    "",
    "Usage:",
    "  cf-frappe init <directory> [--force]",
    "  cf-frappe install <module> [--export <name>] [--as <localName>] [--registry <path>]",
    "  cf-frappe --help",
    "",
    "Commands:",
    "  init   Create a Cloudflare-ready cf-frappe starter app",
    "  install   Wire an app module into a generated app registry",
    ""
  ].join("\n");
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
