/// <reference types="node" />
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

export type PackageManagerName = "npm" | "pnpm" | "yarn" | "bun";

export interface WritableText {
  write(chunk: string): unknown;
}

export interface PackageManagerInstallOptions {
  readonly cwd: string;
  readonly packageManager?: PackageManagerName;
}

export interface PackageManagerInstallResult {
  readonly packageManager: PackageManagerName;
  readonly command: string;
  readonly args: readonly string[];
}

export interface PackageManagerRunner {
  install(options: PackageManagerInstallOptions): Promise<PackageManagerInstallResult>;
}

export class PackageManagerError extends Error {
  constructor(
    message: string,
    readonly code: "install-failed"
  ) {
    super(message);
    this.name = "PackageManagerError";
  }
}

interface NodePackageManagerRunnerOptions {
  readonly stdout: WritableText;
  readonly stderr: WritableText;
}

const lockfileManagers: readonly { readonly file: string; readonly manager: PackageManagerName }[] = [
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "bun.lockb", manager: "bun" },
  { file: "bun.lock", manager: "bun" },
  { file: "package-lock.json", manager: "npm" },
  { file: "npm-shrinkwrap.json", manager: "npm" }
];

export function createNodePackageManagerRunner(
  io: NodePackageManagerRunnerOptions
): PackageManagerRunner {
  return {
    async install(options) {
      const packageManager = options.packageManager ?? await detectPackageManager(options.cwd);
      const command = installCommand(packageManager);
      await runPackageManagerCommand({ ...command, cwd: options.cwd, stdout: io.stdout, stderr: io.stderr });
      return command;
    }
  };
}

export async function detectPackageManager(cwd: string): Promise<PackageManagerName> {
  for (const candidate of lockfileManagers) {
    if (await fileExists(resolve(cwd, candidate.file))) {
      return candidate.manager;
    }
  }
  return await packageManagerFromManifest(cwd) ?? "npm";
}

function installCommand(packageManager: PackageManagerName): PackageManagerInstallResult {
  return {
    packageManager,
    command: packageManager,
    args: ["install"]
  };
}

function runPackageManagerCommand(options: {
  readonly cwd: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly stdout: WritableText;
  readonly stderr: WritableText;
}): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => options.stdout.write(String(chunk)));
    child.stderr.on("data", (chunk) => options.stderr.write(String(chunk)));
    child.on("error", (error) => {
      reject(new PackageManagerError(
        `Package manager command failed to start: ${options.command} ${options.args.join(" ")} (${error.message})`,
        "install-failed"
      ));
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const detail = code === null ? `signal ${signal ?? "unknown"}` : `exit code ${code}`;
      reject(new PackageManagerError(
        `Package manager command failed: ${options.command} ${options.args.join(" ")} (${detail})`,
        "install-failed"
      ));
    });
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function packageManagerFromManifest(cwd: string): Promise<PackageManagerName | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolve(cwd, "package.json"), "utf8")) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed.packageManager !== "string") {
    return undefined;
  }
  return packageManagerNameFromSpec(parsed.packageManager);
}

function packageManagerNameFromSpec(value: string): PackageManagerName | undefined {
  const name = value.split("@", 1)[0];
  return name === "npm" || name === "pnpm" || name === "yarn" || name === "bun" ? name : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
