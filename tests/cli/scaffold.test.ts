/// <reference types="node" />
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";
import { scaffoldProject, ScaffoldError } from "../../src/cli/scaffold";

describe("cf-frappe CLI scaffold", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "cf-frappe-cli-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  }, 60_000);

  it("creates a Cloudflare-ready starter app", async () => {
    const target = join(tempRoot, "Demo App");

    const result = await scaffoldProject({
      targetDirectory: target,
      compatibilityDate: "2026-06-22",
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      wranglerVersion: "^4.103.0"
    });

    expect(result.projectName).toBe("demo-app");
    expect(result.files).toEqual([
      "package.json",
      "wrangler.jsonc",
      "tsconfig.json",
      ".gitignore",
      ".dev.vars.example",
      "README.md",
      "public/assets/task-form.js",
      "src/apps/tasks.ts",
      "src/apps/index.ts",
      "src/worker.ts",
      "migrations/0001_cf_frappe_core.sql",
      "migrations/0002_cf_frappe_job_executions.sql",
      "migrations/0003_cf_frappe_job_execution_messages.sql",
      "migrations/0004_task_indexes.sql"
    ]);

    const packageJson = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as {
      readonly name: string;
      readonly scripts: Record<string, string>;
      readonly dependencies: Record<string, string>;
      readonly devDependencies: Record<string, string>;
    };
    expect(packageJson.name).toBe("demo-app");
    expect(packageJson.scripts["cf:types"]).toBe("wrangler types");
    expect(packageJson.scripts["d1:migrate:local"]).toBe("wrangler d1 migrations apply demo-app-db --local");
    expect(packageJson.dependencies["cf-frappe"]).toBe("^0.1.0");
    expect(packageJson.devDependencies["@types/node"]).toBe("^26.0.0");

    await expect(readFile(join(target, "wrangler.jsonc"), "utf8")).resolves.toContain(
      '"new_sqlite_classes": ["AggregateCoordinator"]'
    );
    await expect(readFile(join(target, "wrangler.jsonc"), "utf8")).resolves.toContain(
      '"directory": "./public"'
    );
    await expect(readFile(join(target, "src/worker.ts"), "utf8")).resolves.toContain(
      "signedSessionActorResolver"
    );
    await expect(readFile(join(target, "src/worker.ts"), "utf8")).resolves.toContain(
      "type Env = Cloudflare.Env & CloudFrappeEnv"
    );
    await expect(readFile(join(target, "src/worker.ts"), "utf8")).resolves.toContain(
      'import { registry } from "./apps"'
    );
    await expect(readFile(join(target, "src/apps/tasks.ts"), "utf8")).resolves.toContain(
      "defineClientScript"
    );
    await expect(readFile(join(target, "src/apps/index.ts"), "utf8")).resolves.toContain(
      "/* cf-frappe app imports:start */"
    );
    await expect(readFile(join(target, "README.md"), "utf8")).resolves.toContain(
      "npx cf-frappe install @acme/cf-frappe-crm"
    );
    await expect(readFile(join(target, "public/assets/task-form.js"), "utf8")).resolves.toContain(
      "window.cfFrappe.form.on"
    );
    await expect(readFile(join(target, "public/assets/task-form.js"), "utf8")).resolves.toContain(
      "window.cfFrappe.resource.get"
    );
    await expect(readFile(join(target, "migrations/0001_cf_frappe_core.sql"), "utf8")).resolves.toContain(
      "CREATE TABLE IF NOT EXISTS cf_frappe_events"
    );
    await expect(readFile(join(target, "migrations/0002_cf_frappe_job_executions.sql"), "utf8")).resolves.toContain(
      "CREATE TABLE IF NOT EXISTS cf_frappe_job_executions"
    );
    await expect(readFile(join(target, "migrations/0003_cf_frappe_job_execution_messages.sql"), "utf8")).resolves.toContain(
      "ADD COLUMN payload_json"
    );
    await expect(readFile(join(target, "migrations/0004_task_indexes.sql"), "utf8")).resolves.toContain(
      "idx_cf_frappe_documents_task_workflow_state_priority_ea45bef5"
    );
  });

  it("refuses to write into a non-empty target unless forced", async () => {
    const target = join(tempRoot, "existing");
    await mkdir(target);
    await writeFile(join(target, "README.md"), "already here");

    let rejection: unknown;
    try {
      await scaffoldProject({
        targetDirectory: target,
        cfFrappeVersion: "0.1.0",
        nodeTypesVersion: "^26.0.0",
        typescriptVersion: "^5.7.2",
        wranglerVersion: "^4.103.0"
      });
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(ScaffoldError);
    expect(rejection).toMatchObject({ code: "target-not-empty" });

    await scaffoldProject({
      targetDirectory: target,
      force: true,
      compatibilityDate: "2026-06-22",
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      wranglerVersion: "^4.103.0"
    });

    await expect(readFile(join(target, "README.md"), "utf8")).resolves.toContain("# existing");
  });

  it("wires installed app modules into generated app registries", async () => {
    const target = join(tempRoot, "installable");
    await scaffoldProject({
      targetDirectory: target,
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      wranglerVersion: "^4.103.0"
    });

    const stdout = textBuffer();
    const stderr = textBuffer();
    const exitCode = await runCli(["install", "@acme/cf-frappe-crm", "--export", "crmApp", "--as", "crm"], {
      cwd: () => target,
      stdout,
      stderr
    });

    expect(exitCode).toBe(0);
    expect(stderr.text()).toBe("");
    expect(stdout.text()).toContain("Wired @acme/cf-frappe-crm as crm into src/apps/index.ts");
    await expect(readFile(join(target, "src/apps/index.ts"), "utf8")).resolves.toContain(
      'import { crmApp as crm } from "@acme/cf-frappe-crm";'
    );
    await expect(readFile(join(target, "src/apps/index.ts"), "utf8")).resolves.toContain("  crm,");

    await writeFile(
      join(target, "src/custom-apps.ts"),
      [
        'import { createRegistryFromApps } from "cf-frappe";',
        "/* cf-frappe app imports:start */",
        "/* cf-frappe app imports:end */",
        "",
        "export const installedApps = [",
        "  /* cf-frappe apps:start */",
        "  /* cf-frappe apps:end */",
        "] as const;",
        "",
        "export const registry = createRegistryFromApps(installedApps);",
        ""
      ].join("\n")
    );
    const customStdout = textBuffer();
    const custom = await runCli(["install", "@acme/cf-frappe-helpdesk", "--registry", "src/custom-apps.ts"], {
      cwd: () => target,
      stdout: customStdout,
      stderr: textBuffer()
    });
    expect(custom).toBe(0);
    expect(customStdout.text()).toContain(
      "Wired @acme/cf-frappe-helpdesk as cfFrappeHelpdeskApp into src/custom-apps.ts"
    );
    await expect(readFile(join(target, "src/custom-apps.ts"), "utf8")).resolves.toContain(
      'import cfFrappeHelpdeskApp from "@acme/cf-frappe-helpdesk";'
    );
    await expect(readFile(join(target, "src/custom-apps.ts"), "utf8")).resolves.toContain(
      "  cfFrappeHelpdeskApp,"
    );

    const duplicateErr = textBuffer();
    const duplicate = await runCli(["install", "@acme/cf-frappe-crm"], {
      cwd: () => target,
      stdout: textBuffer(),
      stderr: duplicateErr
    });
    expect(duplicate).toBe(1);
    expect(duplicateErr.text()).toContain("already installed");

    await writeFile(join(target, "src/bad-apps.ts"), "export const installedApps = [];\n");
    const invalidErr = textBuffer();
    const invalidRegistry = await runCli(["install", "@acme/cf-frappe-bad", "--registry", "src/bad-apps.ts"], {
      cwd: () => target,
      stdout: textBuffer(),
      stderr: invalidErr
    });
    expect(invalidRegistry).toBe(1);
    expect(invalidErr.text()).toContain("App registry install markers are invalid");
  });

  it("parses init commands and reports next steps", async () => {
    expect(parseCliArgs(["init", "demo", "--force"])).toEqual({
      kind: "init",
      targetDirectory: "demo",
      force: true
    });
    expect(parseCliArgs(["install", "@acme/cf-frappe-crm", "--export", "crmApp", "--as", "crm"])).toEqual({
      kind: "install",
      moduleSpecifier: "@acme/cf-frappe-crm",
      exportName: "crmApp",
      localName: "crm"
    });

    const stdout = textBuffer();
    const stderr = textBuffer();
    const exitCode = await runCli(["init", "demo"], {
      cwd: () => tempRoot,
      stdout,
      stderr
    });

    expect(exitCode).toBe(0);
    expect(stderr.text()).toBe("");
    expect(stdout.text()).toContain("Created cf-frappe app at demo");
    expect(stdout.text()).toContain("npm run d1:migrate:local");
  });
});

function textBuffer(): WritableText & { readonly text: () => string } {
  let value = "";
  return {
    write(chunk) {
      value += chunk;
    },
    text() {
      return value;
    }
  };
}
