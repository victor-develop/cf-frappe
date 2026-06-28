/// <reference types="node" />
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";
import { createRegistry, defineDocType } from "../../src";
import type { ModelRegistry } from "../../src";
import { detectPackageManager, PackageManagerError, type PackageManagerRunner } from "../../src/cli/package-manager";
import { scaffoldProject, ScaffoldError } from "../../src/cli/scaffold";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

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
      "migrations/0004_cf_frappe_data_patches.sql",
      "migrations/0005_cf_frappe_data_patch_rollbacks.sql",
      "migrations/0006_doctype_file_v1_indexes.sql",
      "migrations/0007_doctype_task_v1_indexes.sql"
    ]);

    const packageJson = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as {
      readonly name: string;
      readonly scripts: Record<string, string>;
      readonly dependencies: Record<string, string>;
      readonly devDependencies: Record<string, string>;
    };
    expect(packageJson.name).toBe("demo-app");
    expect(packageJson.scripts["cf:types"]).toBe("wrangler types");
    expect(packageJson.scripts["d1:generate"]).toBe("node --import tsx ./node_modules/cf-frappe/dist/cli.js migrate generate");
    expect(packageJson.scripts["d1:migrate:local"]).toBe("wrangler d1 migrations apply demo-app-db --local");
    expect(packageJson.scripts["r2:create"]).toBe("wrangler r2 bucket create demo-app-files");
    expect(packageJson.scripts["queue:create"]).toBe("wrangler queues create demo-app-jobs");
    expect(packageJson.scripts["resources:create"]).toBe(
      "npm run d1:create && npm run r2:create && npm run queue:create"
    );
    expect(packageJson.dependencies["cf-frappe"]).toBe("^0.1.0");
    expect(packageJson.devDependencies["@types/node"]).toBe("^26.0.0");
    expect(packageJson.devDependencies.tsx).toBe("^4.20.6");

    const wrangler = await readFile(join(target, "wrangler.jsonc"), "utf8");
    const wranglerConfig = JSON.parse(wrangler) as {
      readonly d1_databases?: readonly {
        readonly binding: string;
        readonly database_name: string;
        readonly database_id: string;
        readonly migrations_dir: string;
      }[];
      readonly r2_buckets?: readonly {
        readonly binding: string;
        readonly bucket_name: string;
      }[];
      readonly secrets?: { readonly required?: readonly string[] };
      readonly vars?: Record<string, string>;
      readonly queues?: {
        readonly producers?: readonly { readonly binding: string; readonly queue: string }[];
        readonly consumers?: readonly { readonly queue: string; readonly max_batch_size?: number }[];
      };
      readonly triggers?: { readonly crons?: readonly string[] };
      readonly durable_objects?: {
        readonly bindings?: readonly { readonly name: string; readonly class_name: string }[];
      };
    };
    expect(wranglerConfig.d1_databases).toEqual([
      {
        binding: "DB",
        database_name: "demo-app-db",
        database_id: "replace-with-d1-database-id",
        migrations_dir: "migrations"
      }
    ]);
    expect(wranglerConfig.r2_buckets).toEqual([{ binding: "FILES", bucket_name: "demo-app-files" }]);
    expect(wranglerConfig.secrets?.required).toEqual(["SESSION_SECRET"]);
    expect(wranglerConfig.vars).toBeUndefined();
    expect(wranglerConfig.queues?.producers).toEqual([{ binding: "JOBS", queue: "demo-app-jobs" }]);
    expect(wranglerConfig.queues?.consumers).toEqual([
      { queue: "demo-app-jobs", max_batch_size: 10, max_batch_timeout: 5, max_retries: 3 }
    ]);
    expect(wranglerConfig.triggers?.crons).toEqual(["*/5 * * * *"]);
    expect(wranglerConfig.durable_objects?.bindings).toEqual([
      { name: "AGGREGATES", class_name: "AggregateCoordinator" },
      { name: "REALTIME", class_name: "RealtimeHub" }
    ]);
    expect(wrangler).toContain('"new_sqlite_classes": ["AggregateCoordinator", "RealtimeHub"]');
    expect(wrangler).toContain('"directory": "./public"');
    const worker = await readFile(join(target, "src/worker.ts"), "utf8");
    expect(worker).toContain("signedSessionActorResolver");
    expect(worker).toContain('from "cf-frappe/cloudflare"');
    expect(worker).toContain("type Env = Cloudflare.Env & CloudFrappeEnv");
    expect(worker).toContain('import { registry } from "./apps"');
    expect(worker).toContain("createRealtimeHubClass");
    expect(worker).toContain("DurableObjectRealtimePublisher");
    expect(worker).toContain("DOCUMENT_DELIVERY_OUTBOX_DRAIN_JOB_NAME");
    expect(worker).toContain("createDataPatchApplyJob");
    expect(worker).toContain("createDataPatchRollbackJob");
    expect(worker).toContain("createDataPatchRollbackRetryJob");
    expect(worker).toContain("createDocumentDeliveryOutboxDrainJob");
    expect(worker).toContain("createJobRegistry<CloudFrappeRuntimeServices>");
    expect(worker).toContain("D1JobExecutionLog");
    expect(worker).toContain("R2FileStorage");
    expect(worker).toContain("new CloudflareJobQueue(env.JOBS)");
    expect(worker).toContain("executionLog: (env) => new D1JobExecutionLog(env.DB)");
    expect(worker).toContain("storage: (env) => new R2FileStorage(env.FILES)");
    expect(worker).toContain("files: {");
    expect(worker).toContain("export class RealtimeHub extends createRealtimeHubClass() {}");
    expect(worker).toContain("realtime: (env) => new DurableObjectRealtimePublisher(env.REALTIME)");
    expect(worker).toContain("realtime: {");
    expect(worker).toContain("namespace: (env) => env.REALTIME");
    expect(worker).toContain("jobs: {");
    expect(worker).toContain('cron: "*/5 * * * *"');
    expect(worker).toContain("jobName: DOCUMENT_DELIVERY_OUTBOX_DRAIN_JOB_NAME");
    expect(worker).toContain("payload: { limit: 50 }");
    expect(worker).toContain("documentDeliveryOutbox: true");
    const taskApp = await readFile(join(target, "src/apps/tasks.ts"), "utf8");
    expect(taskApp).toContain("defineClientScript");
    expect(taskApp).toContain("defineCalendar");
    expect(taskApp).toContain("defineDashboard");
    expect(taskApp).toContain("defineDataPatch");
    expect(taskApp).toContain("defineKanban");
    expect(taskApp).toContain("defineWebForm");
    expect(taskApp).toContain("defineWebPage");
    expect(taskApp).toContain("defineWebsiteSettings");
    expect(taskApp).toContain("defineWebsiteTheme");
    expect(taskApp).toContain("defineWebView");
    expect(taskApp).toContain("defineWorkspace");
    expect(taskApp).toContain('import type { CloudFrappeRuntimeServices } from "cf-frappe/cloudflare"');
    expect(taskApp).toContain("export const TaskDashboard");
    expect(taskApp).toContain("export const TaskCalendar");
    expect(taskApp).toContain("export const TaskIntakeWebForm");
    expect(taskApp).toContain("export const TaskUpdatesWebView");
    expect(taskApp).toContain("export const AboutWebPage");
    expect(taskApp).toContain("export const TaskWebsiteSettings");
    expect(taskApp).toContain("export const StarterWebsiteTheme");
    expect(taskApp).toContain("export const TaskKanban");
    expect(taskApp).toContain("export const TaskWorkspace");
    expect(taskApp).toContain("export const StarterTaskSeedData");
    expect(taskApp).toContain("dashboards: [TaskDashboard]");
    expect(taskApp).toContain("calendars: [TaskCalendar]");
    expect(taskApp).toContain("webForms: [TaskIntakeWebForm]");
    expect(taskApp).toContain('route: "task-intake"');
    expect(taskApp).toContain('successUrl: "/web/Task%20Updates"');
    expect(taskApp).toContain("webPages: [AboutWebPage]");
    expect(taskApp).toContain("webViews: [TaskUpdatesWebView]");
    expect(taskApp).toContain('filters: [{ field: "workflow_state", operator: "ne", value: "Done" }]');
    expect(taskApp).toContain('orderBy: "starts_on"');
    expect(taskApp).toContain('order: "desc"');
    expect(taskApp).toContain("websiteSettings: TaskWebsiteSettings");
    expect(taskApp).toContain("websiteThemes: [StarterWebsiteTheme]");
    expect(taskApp).toContain("kanbans: [TaskKanban]");
    expect(taskApp).toContain("workspaces: [TaskWorkspace]");
    expect(taskApp).toContain("dataPatches: [StarterTaskSeedData]");
    expect(taskApp).toContain('const STARTER_TASK_SEED_PATCH_ID = "tasks.seed_starter_tasks"');
    expect(taskApp).toContain("id: STARTER_TASK_SEED_PATCH_ID");
    expect(taskApp).toContain('checksum: "v4"');
    expect(taskApp).toContain('name: "Task owner updates"');
    expect(taskApp).toContain('events: ["DocumentUpdated", "DocumentCommentAdded"]');
    expect(taskApp).toContain('recipients: [{ kind: "field", field: "created_by" }]');
    expect(taskApp).toContain('channels: ["inbox"]');
    expect(taskApp).toContain("function starterTaskNotificationRuleMatches");
    expect(taskApp).toContain("function sameStarterRecipient");
    expect(taskApp).not.toContain("JSON.stringify(rule.rule)");
    expect(taskApp).toContain("resources.notificationRules.save");
    expect(taskApp).toContain("resources.notificationRules.clear");
    expect(taskApp).toContain("resources.queries.listDocuments");
    expect(taskApp).toContain("skipped += 1");
    expect(taskApp).toContain("rollback: {");
    expect(taskApp).toContain("resources.documents.delete");
    expect(taskApp).toContain("metadata: { patchId: STARTER_TASK_SEED_PATCH_ID, rollback: true }");
    expect(taskApp).toContain("Create D1, R2, and Queue resources");
    expect(taskApp).toContain('kind: "calendar", target: "Task Calendar"');
    expect(taskApp).toContain('kind: "kanban", target: "Task Board"');
    expect(taskApp).toContain('kind: "dashboard", target: "Task Dashboard"');
    expect(taskApp).toContain('kind: "url", href: "/web-forms/task-intake"');
    expect(taskApp).toContain('kind: "url", href: "/web/Task%20Updates"');
    expect(taskApp).toContain('kind: "url", href: "/page/about"');
    expect(taskApp).toContain('homePageRoute: "about"');
    expect(taskApp).toContain('theme: "Starter Theme"');
    expect(taskApp).toContain('primaryColor: "#2563eb"');
    expect(taskApp).toContain('name: "task-updates", label: "Task Updates", webView: "Task Updates"');
    expect(taskApp).toContain('name: "task-intake", label: "Task Intake", webForm: "Task Intake"');
    expect(taskApp).toContain('route: "review-generated-desk-workspace"');
    expect(taskApp).toContain("published: true");
    expect(taskApp).toContain('kind: "notifications"');
    expect(taskApp).toContain(
      '{ name: "notification-rules", label: "Notification Rules", kind: "admin", target: "notification-rules", roles: ["System Manager"] }'
    );
    expect(taskApp).toContain(
      '{ name: "assignment-rules", label: "Assignment Rules", kind: "admin", target: "assignment-rules", roles: ["System Manager"] }'
    );
    expect(taskApp).toContain(
      '{ name: "roles", label: "Roles", kind: "admin", target: "roles", roles: ["System Manager"] }'
    );
    const appsIndex = await readFile(join(target, "src/apps/index.ts"), "utf8");
    expect(appsIndex).toContain("defineApp");
    expect(appsIndex).toContain("fileDocType");
    expect(appsIndex).toContain('name: "cf-frappe-core"');
    expect(appsIndex).toContain("doctypes: [fileDocType]");
    expect(appsIndex).toContain("coreApp,");
    expect(appsIndex).toContain("/* cf-frappe app imports:start */");
    const readmeText = await readFile(join(target, "README.md"), "utf8");
    await expect(readFile(join(target, "README.md"), "utf8")).resolves.toContain(
      "npx cf-frappe install @acme/cf-frappe-crm"
    );
    await expect(readFile(join(target, "README.md"), "utf8")).resolves.toContain(
      "Open `/` for the generated website homepage, `/desk` for the generated Desk UI"
    );
    expect(readmeText).toContain("the `About` Web Page");
    expect(readmeText).toContain("/api/meta/web-pages/About");
    expect(readmeText).toContain("/api/meta/website-settings");
    expect(readmeText).toContain("/api/meta/website-themes/Starter Theme");
    await expect(readFile(join(target, "README.md"), "utf8")).resolves.toContain(
      "`tasks.seed_starter_tasks` data patch"
    );
    await expect(readFile(join(target, "README.md"), "utf8")).resolves.toContain(
      "starter Task owner notification rule"
    );
    await expect(readFile(join(target, "README.md"), "utf8")).resolves.toContain(
      "npx cf-frappe data-patches status --url https://your-worker.example"
    );
    await expect(readFile(join(target, "README.md"), "utf8")).resolves.toContain(
      "npx cf-frappe data-patches apply --url https://your-worker.example --id tasks.seed_starter_tasks"
    );
    await expect(readFile(join(target, "README.md"), "utf8")).resolves.toContain(
      "npx cf-frappe data-patches rollback --url https://your-worker.example --id tasks.seed_starter_tasks"
    );
    expect(readmeText).toContain("npm run resources:create");
    expect(readmeText).toContain(
      "npm run resources:create\n```" +
        "\n\nCopy the returned D1 `database_id` into the `replace-with-d1-database-id` placeholder"
    );
    await expect(readFile(join(target, "README.md"), "utf8")).resolves.toContain(
      "file manager at `/desk/files`"
    );
    await expect(readFile(join(target, "README.md"), "utf8")).resolves.toContain(
      "buffered Desk uploads immediately"
    );
    expect(readmeText).toContain("Cloudflare Cron trigger (`*/5 * * * *`)");
    expect(readmeText).toContain("document delivery outbox drain job");
    await expect(readFile(join(target, "README.md"), "utf8")).resolves.toContain(
      "replace-with-d1-database-id"
    );
    await expect(readFile(join(target, "README.md"), "utf8")).resolves.toContain(
      "npx cf-frappe data-patches enqueue --url https://your-worker.example --id tasks.seed_starter_tasks"
    );
    await expect(readFile(join(target, "README.md"), "utf8")).resolves.toContain(
      "npx cf-frappe data-patches rollback-enqueue --url https://your-worker.example --id tasks.seed_starter_tasks"
    );
    expect(readmeText).toContain("npx cf-frappe custom-fields list --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe custom-fields save --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe custom-fields disable --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe field-properties list --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe field-properties save --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe field-properties clear --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe workflows get --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe workflows save --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe workflows clear --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe dashboards list --url https://your-worker.example");
    expect(readmeText).toContain('npx cf-frappe dashboards get --url https://your-worker.example --dashboard "Task Dashboard"');
    expect(readmeText).toContain('npx cf-frappe dashboards run --url https://your-worker.example --dashboard "Task Dashboard"');
    expect(readmeText).toContain("npx cf-frappe calendars list --url https://your-worker.example");
    expect(readmeText).toContain('npx cf-frappe calendars get --url https://your-worker.example --calendar "Task Calendar"');
    expect(readmeText).toContain('npx cf-frappe calendars run --url https://your-worker.example --calendar "Task Calendar"');
    expect(readmeText).toContain("npx cf-frappe kanbans list --url https://your-worker.example");
    expect(readmeText).toContain('npx cf-frappe kanbans get --url https://your-worker.example --kanban "Task Board"');
    expect(readmeText).toContain('npx cf-frappe kanbans run --url https://your-worker.example --kanban "Task Board"');
    expect(readmeText).toContain("npx cf-frappe web-forms list --url https://your-worker.example");
    expect(readmeText).toContain('npx cf-frappe web-forms get --url https://your-worker.example --web-form "Task Intake"');
    expect(readmeText).toContain('npx cf-frappe web-forms submit --url https://your-worker.example --web-form "Task Intake"');
    expect(readmeText).toContain("npx cf-frappe web-views list --url https://your-worker.example");
    expect(readmeText).toContain('npx cf-frappe web-views get --url https://your-worker.example --web-view "Task Updates"');
    expect(readmeText).toContain('npx cf-frappe web-views items --url https://your-worker.example --web-view "Task Updates"');
    expect(readmeText).toContain('npx cf-frappe web-views item --url https://your-worker.example --web-view "Task Updates" --route review-generated-desk-workspace');
    expect(readmeText).toContain("npx cf-frappe web-pages list --url https://your-worker.example");
    expect(readmeText).toContain("npx cf-frappe web-pages get --url https://your-worker.example --web-page About");
    expect(readmeText).toContain("npx cf-frappe website-settings get --url https://your-worker.example");
    expect(readmeText).toContain("npx cf-frappe website-themes list --url https://your-worker.example");
    expect(readmeText).toContain('npx cf-frappe website-themes get --url https://your-worker.example --theme "Starter Theme"');
    expect(readmeText).toContain("npx cf-frappe print-formats list --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain('npx cf-frappe print-formats get --url https://your-worker.example --format "Task Standard"');
    expect(readmeText).toContain('npx cf-frappe print-formats html --url https://your-worker.example --format "Task Standard"');
    expect(readmeText).toContain('npx cf-frappe print-formats pdf --url https://your-worker.example --format "Task Standard"');
    expect(readmeText).toContain("npx cf-frappe print-formats letterheads --url https://your-worker.example");
    expect(readmeText).toContain("npx cf-frappe print-settings get --url https://your-worker.example");
    expect(readmeText).toContain("npx cf-frappe print-settings update --url https://your-worker.example");
    expect(readmeText).toContain("npx cf-frappe roles list --url https://your-worker.example");
    expect(readmeText).toContain('npx cf-frappe roles get --url https://your-worker.example --role "Task Manager"');
    expect(readmeText).toContain('npx cf-frappe roles create --url https://your-worker.example --role "Task Reviewer"');
    expect(readmeText).toContain('npx cf-frappe roles describe --url https://your-worker.example --role "Task Reviewer"');
    expect(readmeText).toContain('npx cf-frappe roles disable --url https://your-worker.example --role "Task Reviewer"');
    expect(readmeText).toContain('npx cf-frappe roles enable --url https://your-worker.example --role "Task Reviewer"');
    expect(readmeText).toContain('read -rsp "New user password: " CF_FRAPPE_NEW_USER_PASSWORD');
    expect(readmeText).toContain("export CF_FRAPPE_NEW_USER_PASSWORD");
    expect(readmeText).toContain("npx cf-frappe users get --url https://your-worker.example --user-id teammate@example.com");
    expect(readmeText).toContain("npx cf-frappe users create --url https://your-worker.example --user-id teammate@example.com");
    expect(readmeText).toContain("npx cf-frappe users roles --url https://your-worker.example --user-id teammate@example.com");
    expect(readmeText).toContain("npx cf-frappe users password --url https://your-worker.example --user-id teammate@example.com");
    expect(readmeText).toContain("npx cf-frappe users provider-sync --url https://your-worker.example --user-id teammate@example.com");
    expect(readmeText).toContain("npx cf-frappe users disable --url https://your-worker.example --user-id teammate@example.com");
    expect(readmeText).toContain("npx cf-frappe users enable --url https://your-worker.example --user-id teammate@example.com");
    expect(readmeText).toContain("npx cf-frappe profiles get --url https://your-worker.example --user-id teammate@example.com");
    expect(readmeText).toContain("npx cf-frappe profiles update --url https://your-worker.example --user-id teammate@example.com");
    expect(readmeText).toContain("npx cf-frappe audit events --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe audit deleted --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources list --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources get --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources create --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources update --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources transition --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources command --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources duplicate --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources bulk-transition --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources timeline --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources comment --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources activity --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources assignments --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources assign --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources unassign --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources tags --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources tag --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources untag --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources followers --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources follow --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources unfollow --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources shares --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources share --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources unshare --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources saved-filters --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources save-filter --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources delete-filter --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources export --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources import-template --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources import --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe resources delete --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe notification-rules list --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("The starter data patch creates a `Task owner updates` inbox rule");
    expect(readmeText).toContain("npx cf-frappe notification-rules get --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe notification-rules save --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe notification-rules disable --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe notification-rules enable --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe notification-rules clear --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe assignment-rules list --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe assignment-rules get --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe assignment-rules save --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain(
      "npx cf-frappe assignment-rules disable --url https://your-worker.example --doctype Task"
    );
    expect(readmeText).toContain("npx cf-frappe assignment-rules enable --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain("npx cf-frappe assignment-rules clear --url https://your-worker.example --doctype Task");
    expect(readmeText).toContain(
      "npx cf-frappe user-permissions list --url https://your-worker.example --user-id teammate@example.com"
    );
    expect(readmeText).toContain(
      "npx cf-frappe user-permissions allow --url https://your-worker.example --user-id teammate@example.com"
    );
    expect(readmeText).toContain(
      "npx cf-frappe user-permissions revoke --url https://your-worker.example --user-id teammate@example.com"
    );
    expect(readmeText).toContain("npx cf-frappe files get --url https://your-worker.example --name file_invoice");
    expect(readmeText).toContain("npx cf-frappe files upload --url https://your-worker.example --path ./invoice.pdf");
    expect(readmeText).toContain("npx cf-frappe files download --url https://your-worker.example --name file_invoice");
    expect(readmeText).toContain(
      "npx cf-frappe files preview-download --url https://your-worker.example --name file_invoice"
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
    await expect(readFile(join(target, "migrations/0004_cf_frappe_data_patches.sql"), "utf8")).resolves.toContain(
      "CREATE TABLE IF NOT EXISTS cf_frappe_data_patches"
    );
    await expect(readFile(join(target, "migrations/0005_cf_frappe_data_patch_rollbacks.sql"), "utf8")).resolves.toContain(
      "rollback_pending"
    );
    await expect(readFile(join(target, "migrations/0006_doctype_file_v1_indexes.sql"), "utf8")).resolves.toContain(
      "-- doctype_file_v1_indexes: File projection indexes"
    );
    await expect(readFile(join(target, "migrations/0006_doctype_file_v1_indexes.sql"), "utf8")).resolves.toContain(
      "attached_to_doctype"
    );
    await expect(readFile(join(target, "migrations/0006_doctype_file_v1_indexes.sql"), "utf8")).resolves.toContain(
      "uploaded_by"
    );
    await expect(readFile(join(target, "migrations/0006_doctype_file_v1_indexes.sql"), "utf8")).resolves.toContain(
      "is_private"
    );
    await expect(readFile(join(target, "migrations/0006_doctype_file_v1_indexes.sql"), "utf8")).resolves.toContain(
      "-- checksum: fnv1a32:"
    );
    await expect(readFile(join(target, "migrations/0007_doctype_task_v1_indexes.sql"), "utf8")).resolves.toContain(
      "idx_cf_frappe_documents_task_workflow_state_priority_ea45bef5"
    );
    await expect(readFile(join(target, "migrations/0007_doctype_task_v1_indexes.sql"), "utf8")).resolves.toContain(
      "-- checksum: fnv1a32:"
    );
  });

  it("generates starter setup scripts for local and first remote deploy flows", async () => {
    const target = join(tempRoot, "Setup Scripts App");

    await scaffoldProject({
      targetDirectory: target,
      compatibilityDate: "2026-06-22",
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      wranglerVersion: "^4.103.0"
    });

    const packageJson = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as {
      readonly scripts: Record<string, string>;
    };
    expect(packageJson.scripts["setup:local"]).toBe(
      "npm run cf:types && npm run d1:generate && npm run d1:migrate:local"
    );
    expect(packageJson.scripts["secret:session"]).toBe("wrangler secret put SESSION_SECRET");
    expect(packageJson.scripts["deploy:first"]).toBe(
      "npm run cf:types && npm run d1:generate && npm run d1:migrate:remote && npm run deploy"
    );

    const readmeText = await readFile(join(target, "README.md"), "utf8");
    expect(readmeText).toContain("npm run setup:local");
    expect(readmeText).toContain("npm run secret:session");
    expect(readmeText).toContain("npm run deploy:first");
  });

  it("keeps starter deployment guidance in one ordered section", async () => {
    const target = join(tempRoot, "Deployment Readme App");

    await scaffoldProject({
      targetDirectory: target,
      compatibilityDate: "2026-06-22",
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      wranglerVersion: "^4.103.0"
    });

    const readmeText = await readFile(join(target, "README.md"), "utf8");
    expect(readmeText.match(/^## Deployment$/gm)).toHaveLength(1);
    expect(readmeText.match(/^## Deploy$/gm)).toBeNull();
    expect(readmeText.indexOf("npm run resources:create")).toBeLessThan(
      readmeText.indexOf("replace-with-d1-database-id")
    );
    expect(readmeText.indexOf("replace-with-d1-database-id")).toBeLessThan(
      readmeText.indexOf("npm run secret:session")
    );
    expect(readmeText.indexOf("npm run secret:session")).toBeLessThan(readmeText.indexOf("npm run deploy:first"));
  });

  it("documents realtime collaboration in generated starters", async () => {
    const target = join(tempRoot, "Realtime Readme App");

    await scaffoldProject({
      targetDirectory: target,
      compatibilityDate: "2026-06-22",
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      wranglerVersion: "^4.103.0"
    });

    const readmeText = await readFile(join(target, "README.md"), "utf8");
    expect(readmeText).toContain("Realtime document updates and presence are enabled at `/api/realtime`");
    expect(readmeText).toContain("the generated `REALTIME` Durable Object binding");
  });

  it("wires starter Cron triggers to durable document delivery outbox drains", async () => {
    const target = join(tempRoot, "Cron Starter App");

    await scaffoldProject({
      targetDirectory: target,
      compatibilityDate: "2026-06-22",
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      wranglerVersion: "^4.103.0"
    });

    const wrangler = JSON.parse(await readFile(join(target, "wrangler.jsonc"), "utf8")) as {
      readonly triggers?: { readonly crons?: readonly string[] };
    };
    expect(wrangler.triggers?.crons).toEqual(["*/5 * * * *"]);

    const worker = await readFile(join(target, "src/worker.ts"), "utf8");
    expect(worker).toContain("DOCUMENT_DELIVERY_OUTBOX_DRAIN_JOB_NAME");
    expect(worker).toContain("schedules: [");
    expect(worker).toContain('cron: "*/5 * * * *"');
    expect(worker).toContain("jobName: DOCUMENT_DELIVERY_OUTBOX_DRAIN_JOB_NAME");
    expect(worker).toContain("payload: { limit: 50 }");

    const readmeText = await readFile(join(target, "README.md"), "utf8");
    expect(readmeText).toContain("Cloudflare Cron trigger (`*/5 * * * *`)");
    expect(readmeText).toContain("document delivery outbox drain job");
  });

  it("generates Wrangler binding types for starter outbox deployment resources", async () => {
    const target = join(tempRoot, "Typed Outbox Starter App");

    await scaffoldProject({
      targetDirectory: target,
      compatibilityDate: "2026-06-22",
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      wranglerVersion: "^4.103.0"
    });

    await runTool(binPath("wrangler"), ["types"], target);

    const generatedTypes = await readFile(join(target, "worker-configuration.d.ts"), "utf8");
    expect(generatedTypes).toContain("DB: D1Database;");
    expect(generatedTypes).toContain("FILES: R2Bucket;");
    expect(generatedTypes).toContain("JOBS: Queue;");
    expect(generatedTypes).toContain("SESSION_SECRET: string;");
    expect(generatedTypes).toContain('AGGREGATES: DurableObjectNamespace<import("./src/worker").AggregateCoordinator>;');
    expect(generatedTypes).toContain('REALTIME: DurableObjectNamespace<import("./src/worker").RealtimeHub>;');
  });

  it("creates a Cloudflare Access-backed starter app", async () => {
    const target = join(tempRoot, "Access App");

    const result = await scaffoldProject({
      targetDirectory: target,
      authMode: "cloudflare-access",
      compatibilityDate: "2026-06-22",
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      wranglerVersion: "^4.103.0"
    });

    expect(result.projectName).toBe("access-app");
    const wrangler = await readFile(join(target, "wrangler.jsonc"), "utf8");
    const wranglerConfig = JSON.parse(wrangler) as { readonly vars: Record<string, string> };
    expect(wranglerConfig.vars).toEqual({
      CF_ACCESS_TEAM_DOMAIN: "your-team.cloudflareaccess.com",
      CF_ACCESS_AUD: "replace-with-access-application-aud"
    });
    expect(wrangler).toContain('"CF_ACCESS_TEAM_DOMAIN": "your-team.cloudflareaccess.com"');
    expect(wrangler).toContain('"CF_ACCESS_AUD": "replace-with-access-application-aud"');
    await expect(readFile(join(target, ".dev.vars.example"), "utf8")).resolves.toContain(
      "CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com"
    );
    const worker = await readFile(join(target, "src/worker.ts"), "utf8");
    expect(worker).toContain("auth: {");
    expect(worker).toContain("cloudflareAccess");
    expect(worker).toContain("createDataPatchApplyJob");
    expect(worker).toContain("createDataPatchRollbackJob");
    expect(worker).toContain("createDocumentDeliveryOutboxDrainJob");
    expect(worker).toContain("D1JobExecutionLog");
    expect(worker).toContain("R2FileStorage");
    expect(worker).toContain("createRealtimeHubClass");
    expect(worker).toContain("DurableObjectRealtimePublisher");
    expect(worker).toContain("new CloudflareJobQueue(env.JOBS)");
    expect(worker).toContain("executionLog: (env) => new D1JobExecutionLog(env.DB)");
    expect(worker).toContain("storage: (env) => new R2FileStorage(env.FILES)");
    expect(worker).toContain("jobs: {");
    expect(worker).toContain("documentDeliveryOutbox: true");
    expect(worker).toContain("files: {");
    expect(worker).toContain("export class RealtimeHub extends createRealtimeHubClass() {}");
    expect(worker).toContain("realtime: (env) => new DurableObjectRealtimePublisher(env.REALTIME)");
    expect(worker).toContain("namespace: (env) => env.REALTIME");
    expect(worker).toContain("throw permissionDenied(\"Cloudflare Access JWT is required\")");
    expect(worker).toContain("teamDomain: (env) => env.CF_ACCESS_TEAM_DOMAIN");
    expect(worker).toContain("audience: (env) => env.CF_ACCESS_AUD");
    expect(worker).toContain("revalidateSignedSessions: true");
    expect(worker).toContain("[\"User\", ...(claims.groups ?? []).map((group) => `Access:${group}`)]");
    expect(worker).not.toContain("guestActor");
    expect(worker).not.toContain("signedSessionActorResolver");
    const readme = await readFile(join(target, "README.md"), "utf8");
    expect(readme).toContain("Cloudflare Access account auto-sync");
    expect(readme).toContain("Access application audience tag");
    expect(readme).toContain("npx cf-frappe access plan");
    expect(readme).toContain("npx cf-frappe access apply");
    expect(readme).toContain("--api-token-env CF_API_TOKEN");
    expect(readme).toContain("then run the same command as `access apply`");
    expect(readme).toContain("denies requests that do not carry a valid Access token");
  });

  it("creates an OIDC-backed starter app", async () => {
    const target = join(tempRoot, "OIDC App");

    const result = await scaffoldProject({
      targetDirectory: target,
      authMode: "oidc",
      compatibilityDate: "2026-06-22",
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      wranglerVersion: "^4.103.0"
    });

    expect(result.projectName).toBe("oidc-app");
    const wrangler = await readFile(join(target, "wrangler.jsonc"), "utf8");
    const wranglerConfig = JSON.parse(wrangler) as { readonly vars: Record<string, string> };
    expect(wranglerConfig.vars).toEqual({
      OIDC_ISSUER: "https://login.example.com",
      OIDC_AUD: "replace-with-oidc-audience",
      OIDC_JWKS_URL: "https://login.example.com/.well-known/jwks.json"
    });
    await expect(readFile(join(target, ".dev.vars.example"), "utf8")).resolves.toContain(
      "OIDC_ISSUER=https://login.example.com"
    );
    const worker = await readFile(join(target, "src/worker.ts"), "utf8");
    expect(worker).toContain("auth: {");
    expect(worker).toContain("oidc: {");
    expect(worker).toContain("createDataPatchApplyJob");
    expect(worker).toContain("createDataPatchRollbackJob");
    expect(worker).toContain("createDocumentDeliveryOutboxDrainJob");
    expect(worker).toContain("D1JobExecutionLog");
    expect(worker).toContain("R2FileStorage");
    expect(worker).toContain("createRealtimeHubClass");
    expect(worker).toContain("DurableObjectRealtimePublisher");
    expect(worker).toContain("new CloudflareJobQueue(env.JOBS)");
    expect(worker).toContain("executionLog: (env) => new D1JobExecutionLog(env.DB)");
    expect(worker).toContain("storage: (env) => new R2FileStorage(env.FILES)");
    expect(worker).toContain("jobs: {");
    expect(worker).toContain("documentDeliveryOutbox: true");
    expect(worker).toContain("files: {");
    expect(worker).toContain("export class RealtimeHub extends createRealtimeHubClass() {}");
    expect(worker).toContain("realtime: (env) => new DurableObjectRealtimePublisher(env.REALTIME)");
    expect(worker).toContain("namespace: (env) => env.REALTIME");
    expect(worker).toContain("throw permissionDenied(\"OIDC token is required\")");
    expect(worker).toContain("issuer: (env) => env.OIDC_ISSUER");
    expect(worker).toContain("audience: (env) => env.OIDC_AUD");
    expect(worker).toContain("jwksUrl: (env) => env.OIDC_JWKS_URL");
    expect(worker).toContain("provider: \"oidc\"");
    expect(worker).toContain("revalidateSignedSessions: true");
    expect(worker).toContain("oidcGroupsRoleMapper");
    expect(worker).toContain("permissionDenied");
    expect(worker).toContain("roles: oidcGroupsRoleMapper()");
    expect(worker).not.toContain("guestActor");
    expect(worker).not.toContain("signedSessionActorResolver");
    expect(worker).not.toContain("cloudflareAccess");
    const readme = await readFile(join(target, "README.md"), "utf8");
    expect(readme).toContain("OIDC account auto-sync");
    expect(readme).toContain("Authorization: Bearer <token>");
    expect(readme).toContain("The OIDC adapter requires the standard `sub` claim");
    expect(readme).toContain("OIDC_ISSUER` must match the JWT `iss` claim exactly");
    expect(readme).toContain("denies requests that do not carry a valid OIDC token or signed session");
  });

  it("generates an OIDC starter that typechecks after Wrangler types", async () => {
    const target = join(tempRoot, "oidc-compile");
    await scaffoldProject({
      targetDirectory: target,
      authMode: "oidc",
      compatibilityDate: "2026-06-22",
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      wranglerVersion: "^4.103.0"
    });
    await runTool(binPath("wrangler"), ["types"], target);
    await writeFile(
      join(target, "tsconfig.smoke.json"),
      `${JSON.stringify(
        {
          extends: "./tsconfig.json",
          compilerOptions: {
            baseUrl: ".",
            paths: {
              "cf-frappe": [join(repoRoot, "src/index.ts")],
              "cf-frappe/cloudflare": [join(repoRoot, "src/cloudflare/index.ts")]
            },
            lib: ["ES2022", "DOM", "DOM.Iterable"],
            typeRoots: [join(repoRoot, "node_modules")],
            types: ["@cloudflare/workers-types"]
          }
        },
        null,
        2
      )}\n`
    );

    await runTool(binPath("tsc"), ["--noEmit", "-p", "tsconfig.smoke.json"], target);
  }, 60_000);

  it("generates a seed patch that preserves pre-existing same-title records during rollback", async () => {
    const target = join(tempRoot, "seed-rollback");
    await scaffoldProject({
      targetDirectory: target,
      compatibilityDate: "2026-06-22",
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      wranglerVersion: "^4.103.0"
    });

    const frameworkUrl = join(repoRoot, "src/index.ts");
    const cloudflareUrl = join(repoRoot, "src/cloudflare/index.ts");
    const generatedTaskApp = (await readFile(join(target, "src/apps/tasks.ts"), "utf8"))
      .replace('from "cf-frappe"', `from "${frameworkUrl}"`)
      .replace('from "cf-frappe/cloudflare"', `from "${cloudflareUrl}"`);
    await writeFile(
      join(target, "src/apps/tasks.seed-smoke.ts"),
      `${generatedTaskApp}
import {
  createRegistryFromApps,
  DocumentService,
  DocumentShareService,
  InMemoryDocumentStore,
  NotificationRuleService,
  QueryService
} from "${frameworkUrl}";

const registry = createRegistryFromApps([taskApp]);
const store = new InMemoryDocumentStore();
const documentShares = new DocumentShareService({ events: store });
const notificationRules = new NotificationRuleService({ registry, events: store });
let id = 0;
const ids = { next: (prefix = "") => \`\${prefix}seed-smoke-\${++id}\` };
const clock = { now: () => "2026-06-26T00:00:00.000Z" };
const documents = new DocumentService({ registry, store, documentShares, ids, clock });
const queries = new QueryService({ registry, projections: store, documentShares });
const actor = { id: "owner@example.com", roles: ["Task Manager"], tenantId: "default" };
const preexisting = await documents.create({
  actor,
  doctype: "Task",
  data: {
    title: "Review generated Desk workspace",
    priority: "Low",
    workflow_state: "Open",
    description: "User-created record with the same title."
  }
});

const resources = { registry, documents, queries, notificationRules };
const applyResult = await StarterTaskSeedData.run({ resources });
if (JSON.stringify(applyResult) !== JSON.stringify({
  created: 1,
  skipped: 1,
  notificationRuleCreated: 1,
  notificationRuleSkipped: 0
})) {
  throw new Error(\`Unexpected apply result: \${JSON.stringify(applyResult)}\`);
}
const automationActor = { id: "starter-automation", roles: ["System Manager"], tenantId: "default" };
const rulesAfterApply = await notificationRules.list(automationActor, "Task");
const ownerRule = rulesAfterApply.rules.find((entry) => entry.rule.name === "Task owner updates");
if (ownerRule === undefined || ownerRule.rule.subject !== "{{ doctype }} {{ name }} changed") {
  throw new Error(\`Expected starter notification rule after apply, got \${JSON.stringify(rulesAfterApply.rules)}\`);
}
if (ownerRule.metadata.patchId !== "tasks.seed_starter_tasks") {
  throw new Error(\`Expected starter notification rule patch metadata, got \${JSON.stringify(ownerRule.metadata)}\`);
}
const seededBeforeRollback = await queries.listDocuments(actor, "Task", {
  filters: [{ field: "starter_seed_patch", value: "tasks.seed_starter_tasks" }],
  limit: 10
});
if (seededBeforeRollback.data.length !== 1) {
  throw new Error(\`Expected one seed-owned record before rollback, got \${seededBeforeRollback.data.length}\`);
}

const rollbackResult = await StarterTaskSeedData.rollback?.run({ resources });
if (JSON.stringify(rollbackResult) !== JSON.stringify({
  deleted: 1,
  skipped: 1,
  notificationRuleDeleted: 1,
  notificationRuleSkipped: 0
})) {
  throw new Error(\`Unexpected rollback result: \${JSON.stringify(rollbackResult)}\`);
}
const rulesAfterRollback = await notificationRules.list(automationActor, "Task");
if (rulesAfterRollback.rules.some((entry) => entry.rule.name === "Task owner updates")) {
  throw new Error(\`Expected starter notification rule rollback, got \${JSON.stringify(rulesAfterRollback.rules)}\`);
}
await notificationRules.save({
  actor: automationActor,
  doctype: "Task",
  rule: {
    name: "Task owner updates",
    events: ["DocumentUpdated", "DocumentCommentAdded"],
    recipients: [{ kind: "field", field: "created_by" }],
    channels: ["inbox"],
    subject: "{{ doctype }} {{ name }} changed"
  }
});
const secondRollback = await StarterTaskSeedData.rollback?.run({ resources });
if (JSON.stringify(secondRollback) !== JSON.stringify({
  deleted: 0,
  skipped: 2,
  notificationRuleDeleted: 0,
  notificationRuleSkipped: 1
})) {
  throw new Error(\`Unexpected second rollback result: \${JSON.stringify(secondRollback)}\`);
}
const rulesAfterUserRuleRollback = await notificationRules.list(automationActor, "Task");
if (!rulesAfterUserRuleRollback.rules.some((entry) => entry.rule.name === "Task owner updates")) {
  throw new Error("Rollback removed a user-owned matching notification rule");
}
await notificationRules.clear({
  actor: automationActor,
  doctype: "Task",
  ruleName: "Task owner updates"
});
await notificationRules.save({
  actor: automationActor,
  doctype: "Task",
  rule: {
    name: "Task owner updates",
    events: ["DocumentUpdated", "DocumentCommentAdded"],
    recipients: [{ kind: "field", field: "created_by" }],
    channels: ["inbox"],
    subject: "{{ doctype }} {{ name }} changed"
  },
  metadata: { patchId: "tasks.seed_starter_tasks" }
});
await notificationRules.save({
  actor: automationActor,
  doctype: "Task",
  rule: {
    name: "Task owner updates",
    events: ["DocumentUpdated", "DocumentCommentAdded"],
    recipients: [{ kind: "field", field: "created_by" }],
    channels: ["inbox"],
    subject: "User edited subject"
  }
});
const editedRollback = await StarterTaskSeedData.rollback?.run({ resources });
if (JSON.stringify(editedRollback) !== JSON.stringify({
  deleted: 0,
  skipped: 2,
  notificationRuleDeleted: 0,
  notificationRuleSkipped: 1
})) {
  throw new Error(\`Unexpected edited rollback result: \${JSON.stringify(editedRollback)}\`);
}
const rulesAfterEditedRollback = await notificationRules.list(automationActor, "Task");
const editedRule = rulesAfterEditedRollback.rules.find((entry) => entry.rule.name === "Task owner updates");
if (editedRule?.rule.subject !== "User edited subject") {
  throw new Error(\`Rollback removed or changed an edited starter rule: \${JSON.stringify(rulesAfterEditedRollback.rules)}\`);
}
const preserved = await queries.getDocument(actor, "Task", preexisting.name);
if (preserved.data.description !== "User-created record with the same title.") {
  throw new Error("Rollback changed the pre-existing same-title record");
}
const seededAfterRollback = await queries.listDocuments(actor, "Task", {
  filters: [{ field: "starter_seed_patch", value: "tasks.seed_starter_tasks" }],
  limit: 10
});
if (seededAfterRollback.data.length !== 0) {
  throw new Error(\`Expected rollback to remove seed-owned records, got \${seededAfterRollback.data.length}\`);
}
`
    );

    await mkdir(join(target, "dist"));
    await runTool(
      binPath("esbuild"),
      ["src/apps/tasks.seed-smoke.ts", "--bundle", "--platform=node", "--format=esm", "--outfile=dist/tasks.seed-smoke.mjs"],
      target
    );
    await runTool(process.execPath, ["dist/tasks.seed-smoke.mjs"], target);
  }, 60_000);

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
    const packageManager = packageManagerRecorder();
    await scaffoldProject({
      targetDirectory: target,
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      wranglerVersion: "^4.103.0"
    });

    const stdout = textBuffer();
    const stderr = textBuffer();
    const exitCode = await runCli(
      [
        "install",
        "@acme/cf-frappe-crm",
        "--version",
        "^1.2.3",
        "--export",
        "crmApp",
        "--as",
        "crm",
        "--package-manager",
        "pnpm"
      ],
      {
        cwd: () => target,
        packageManager,
        stdout,
        stderr
      }
    );

    expect(exitCode).toBe(0);
    expect(stderr.text()).toBe("");
    expect(stdout.text()).toContain("Wired @acme/cf-frappe-crm as crm into src/apps/index.ts");
    expect(stdout.text()).toContain("Saved dependency @acme/cf-frappe-crm@^1.2.3 in package.json");
    expect(stdout.text()).toContain("Ran pnpm install to update node_modules and lockfile.");
    expect(packageManager.calls).toEqual([{ cwd: target, packageManager: "pnpm" }]);
    await expect(readFile(join(target, "src/apps/index.ts"), "utf8")).resolves.toContain(
      'import { crmApp as crm } from "@acme/cf-frappe-crm";'
    );
    await expect(readFile(join(target, "src/apps/index.ts"), "utf8")).resolves.toContain("  crm,");
    const packageJsonAfterCrm = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as {
      readonly dependencies: Record<string, string>;
    };
    expect(packageJsonAfterCrm.dependencies["@acme/cf-frappe-crm"]).toBe("^1.2.3");

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
      packageManager,
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
    const packageJsonAfterHelpdesk = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as {
      readonly dependencies: Record<string, string>;
    };
    expect(packageJsonAfterHelpdesk.dependencies["@acme/cf-frappe-helpdesk"]).toBe("latest");
    expect(packageManager.calls).toEqual([
      { cwd: target, packageManager: "pnpm" },
      { cwd: target, packageManager: undefined }
    ]);

    const localStdout = textBuffer();
    const local = await runCli(["install", "./apps/local", "--as", "localApp", "--no-save"], {
      cwd: () => target,
      stdout: localStdout,
      stderr: textBuffer()
    });
    expect(local).toBe(0);
    expect(localStdout.text()).toContain("Wired ./apps/local as localApp into src/apps/index.ts");
    expect(localStdout.text()).not.toContain("dependency");
    const packageJsonAfterLocal = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as {
      readonly dependencies: Record<string, string>;
    };
    expect(packageJsonAfterLocal.dependencies["./apps/local"]).toBeUndefined();
    expect(packageManager.calls).toHaveLength(2);

    const noInstallStdout = textBuffer();
    const noInstall = await runCli(["install", "@acme/cf-frappe-reports", "--no-install"], {
      cwd: () => target,
      packageManager,
      stdout: noInstallStdout,
      stderr: textBuffer()
    });
    expect(noInstall).toBe(0);
    expect(noInstallStdout.text()).toContain("Skipped package manager install");
    expect(packageManager.calls).toHaveLength(2);
    const packageJsonAfterNoInstall = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as {
      readonly dependencies: Record<string, string>;
    };
    expect(packageJsonAfterNoInstall.dependencies["@acme/cf-frappe-reports"]).toBe("latest");

    const registryBeforeMalformedPackage = await readFile(join(target, "src/apps/index.ts"), "utf8");
    await writeFile(
      join(target, "package.json"),
      `${JSON.stringify({ ...packageJsonAfterNoInstall, dependencies: [] }, null, 2)}\n`
    );
    const malformedPackageErr = textBuffer();
    const malformedPackage = await runCli(["install", "@acme/cf-frappe-billing"], {
      cwd: () => target,
      stdout: textBuffer(),
      stderr: malformedPackageErr
    });
    expect(malformedPackage).toBe(1);
    expect(malformedPackageErr.text()).toContain("has non-object dependencies");
    await expect(readFile(join(target, "src/apps/index.ts"), "utf8")).resolves.toBe(registryBeforeMalformedPackage);
    await writeFile(join(target, "package.json"), `${JSON.stringify(packageJsonAfterNoInstall, null, 2)}\n`);

    await writeFile(
      join(target, "src/dollar-apps.ts"),
      [
        'import { createRegistryFromApps } from "cf-frappe";',
        "/* cf-frappe app imports:start */",
        "/* cf-frappe app imports:end */",
        "",
        "export const installedApps = [",
        "  /* cf-frappe apps:start */",
        "  $crm,",
        "  /* cf-frappe apps:end */",
        "] as const;",
        "",
        "export const registry = createRegistryFromApps(installedApps);",
        ""
      ].join("\n")
    );
    const dollarDuplicateErr = textBuffer();
    const dollarDuplicate = await runCli(
      ["install", "@acme/cf-frappe-dollar", "--as", "$crm", "--registry", "src/dollar-apps.ts", "--no-save"],
      {
        cwd: () => target,
        stdout: textBuffer(),
        stderr: dollarDuplicateErr
      }
    );
    expect(dollarDuplicate).toBe(1);
    expect(dollarDuplicateErr.text()).toContain("App local name '$crm' is already installed");

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

  it("keeps registry wiring atomic when package-manager installation fails", async () => {
    const target = join(tempRoot, "install-failure");
    await scaffoldProject({
      targetDirectory: target,
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      wranglerVersion: "^4.103.0"
    });
    const registryBefore = await readFile(join(target, "src/apps/index.ts"), "utf8");
    const failingStderr = textBuffer();
    const failing = await runCli(["install", "@acme/cf-frappe-crm"], {
      cwd: () => target,
      packageManager: packageManagerFailure("network offline"),
      stdout: textBuffer(),
      stderr: failingStderr
    });

    expect(failing).toBe(1);
    expect(failingStderr.text()).toContain("network offline");
    await expect(readFile(join(target, "src/apps/index.ts"), "utf8")).resolves.toBe(registryBefore);
    const packageJsonAfterFailure = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as {
      readonly dependencies: Record<string, string>;
    };
    expect(packageJsonAfterFailure.dependencies["@acme/cf-frappe-crm"]).toBe("latest");

    const packageManager = packageManagerRecorder();
    const retryStdout = textBuffer();
    const retry = await runCli(["install", "@acme/cf-frappe-crm"], {
      cwd: () => target,
      packageManager,
      stdout: retryStdout,
      stderr: textBuffer()
    });

    expect(retry).toBe(0);
    expect(retryStdout.text()).toContain("Kept dependency @acme/cf-frappe-crm@latest in package.json");
    expect(retryStdout.text()).toContain("Wired @acme/cf-frappe-crm as cfFrappeCrmApp into src/apps/index.ts");
    expect(packageManager.calls).toEqual([{ cwd: target, packageManager: undefined }]);
    await expect(readFile(join(target, "src/apps/index.ts"), "utf8")).resolves.toContain(
      'import cfFrappeCrmApp from "@acme/cf-frappe-crm";'
    );
  });

  it("re-plans registry wiring after package-manager lifecycle changes", async () => {
    const target = join(tempRoot, "install-lifecycle");
    await scaffoldProject({
      targetDirectory: target,
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      wranglerVersion: "^4.103.0"
    });
    const registryFile = join(target, "src/apps/index.ts");
    const registryBefore = await readFile(registryFile, "utf8");
    const registryDuringInstall = registryBefore
      .replace("/* cf-frappe app imports:end */", 'import lifecycleApp from "./lifecycle";\n/* cf-frappe app imports:end */')
      .replace("  /* cf-frappe apps:end */", "  lifecycleApp,\n  /* cf-frappe apps:end */");

    const install = await runCli(["install", "@acme/cf-frappe-crm"], {
      cwd: () => target,
      packageManager: packageManagerRegistryEdit(registryFile, registryDuringInstall),
      stdout: textBuffer(),
      stderr: textBuffer()
    });

    expect(install).toBe(0);
    const registryAfter = await readFile(registryFile, "utf8");
    expect(registryAfter).toContain('import lifecycleApp from "./lifecycle";');
    expect(registryAfter).toContain("  lifecycleApp,");
    expect(registryAfter).toContain('import cfFrappeCrmApp from "@acme/cf-frappe-crm";');
    expect(registryAfter).toContain("  cfFrappeCrmApp,");
  });

  it("parses init commands and reports next steps", async () => {
    expect(parseCliArgs(["init", "demo", "--force"])).toEqual({
      kind: "init",
      targetDirectory: "demo",
      force: true
    });
    expect(parseCliArgs(["init", "access-demo", "--auth", "cloudflare-access"])).toEqual({
      kind: "init",
      targetDirectory: "access-demo",
      force: false,
      authMode: "cloudflare-access"
    });
    expect(parseCliArgs(["init", "oidc-demo", "--auth", "oidc"])).toEqual({
      kind: "init",
      targetDirectory: "oidc-demo",
      force: false,
      authMode: "oidc"
    });
    expect(parseCliArgs(["init", "bad-auth", "--auth", "oauth"])).toEqual({
      kind: "invalid",
      message: "Unsupported starter auth mode 'oauth'"
    });
    expect(parseCliArgs([
      "install",
      "@acme/cf-frappe-crm",
      "--version",
      "^1.2.3",
      "--export",
      "crmApp",
      "--as",
      "crm",
      "--package-manager",
      "pnpm"
    ])).toEqual({
      kind: "install",
      moduleSpecifier: "@acme/cf-frappe-crm",
      runPackageManager: true,
      saveDependency: true,
      dependencyVersion: "^1.2.3",
      exportName: "crmApp",
      localName: "crm",
      packageManager: "pnpm"
    });
    expect(parseCliArgs(["install", "./apps/local", "--no-save"])).toEqual({
      kind: "install",
      moduleSpecifier: "./apps/local",
      runPackageManager: true,
      saveDependency: false
    });
    expect(parseCliArgs(["install", "@acme/cf-frappe-crm", "--package-manager", "pip"])).toEqual({
      kind: "invalid",
      message: "Unsupported package manager 'pip'"
    });
    expect(parseCliArgs(["install", "@acme/cf-frappe-crm", "--package-manager", "npm", "--no-install"])).toEqual({
      kind: "invalid",
      message: "Cannot combine --package-manager with --no-install"
    });
    expect(parseCliArgs(["migrate", "generate", "--registry", "src/apps/index.ts", "--migrations", "migrations", "--no-core"])).toEqual({
      kind: "migrate-generate",
      includeCore: false,
      registryFile: "src/apps/index.ts",
      migrationsDir: "migrations"
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

  it("generates missing D1 migration files from app metadata", async () => {
    const target = join(tempRoot, "migration-generation");
    await scaffoldProject({
      targetDirectory: target,
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      tsxVersion: "^4.20.6",
      wranglerVersion: "^4.103.0"
    });
    const registry = createRegistry({
      doctypes: [
        defineDocType({
          name: "Task",
          version: 1,
          fields: [
            { name: "priority", type: "text" },
            { name: "workflow_state", type: "text" }
          ],
          indexes: [["priority"], ["workflow_state", "priority"]]
        }),
        defineDocType({
          name: "Customer",
          version: 2,
          fields: [{ name: "email", type: "text" }],
          indexes: [["email"]]
        })
      ]
    });
    const stdout = textBuffer();
    const first = await runCli(["migrate", "generate"], {
      cwd: () => target,
      migrationRegistryLoader: registryLoader(registry),
      stdout,
      stderr: textBuffer()
    });

    expect(first).toBe(0);
    expect(stdout.text()).toContain("Planned D1 migrations from src/apps/index.ts into migrations");
    expect(stdout.text()).toContain("Wrote migrations/0008_doctype_customer_v2_indexes.sql (1 statements)");
    const generated = await readFile(join(target, "migrations/0008_doctype_customer_v2_indexes.sql"), "utf8");
    expect(generated).toContain("-- doctype_customer_v2_indexes: Customer projection indexes");
    expect(generated).toContain("-- checksum: fnv1a32:");
    expect(generated).toContain("WHERE doctype = 'Customer';");

    const secondStdout = textBuffer();
    const second = await runCli(["migrate", "generate"], {
      cwd: () => target,
      migrationRegistryLoader: registryLoader(registry),
      stdout: secondStdout,
      stderr: textBuffer()
    });

    expect(second).toBe(0);
    expect(secondStdout.text()).toContain("No new migration files were needed.");
  });

  it("uses migration metadata to avoid regenerating files after a filename changes", async () => {
    const registry = createRegistry({
      doctypes: [
        defineDocType({
          name: "Customer",
          version: 2,
          fields: [{ name: "email", type: "text" }],
          indexes: [["email"]]
        })
      ]
    });
    const first = await runCli(["migrate", "generate", "--no-core"], {
      cwd: () => tempRoot,
      migrationRegistryLoader: registryLoader(registry),
      stdout: textBuffer(),
      stderr: textBuffer()
    });
    expect(first).toBe(0);
    const originalPath = join(tempRoot, "migrations/0001_doctype_customer_v2_indexes.sql");
    const generated = await readFile(originalPath, "utf8");
    await rm(originalPath);
    await writeFile(join(tempRoot, "migrations/0042_legacy_customer_indexes.sql"), generated, "utf8");

    const secondStdout = textBuffer();
    const second = await runCli(["migrate", "generate", "--no-core"], {
      cwd: () => tempRoot,
      migrationRegistryLoader: registryLoader(registry),
      stdout: secondStdout,
      stderr: textBuffer()
    });

    expect(second).toBe(0);
    expect(secondStdout.text()).toContain("No new migration files were needed.");
    await expect(readFile(originalPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports checksum drift for scaffolded starter migration files", async () => {
    const target = join(tempRoot, "starter-checksum-drift");
    await scaffoldProject({
      targetDirectory: target,
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      tsxVersion: "^4.20.6",
      wranglerVersion: "^4.103.0"
    });
    const registry = createRegistry({
      doctypes: [
        defineDocType({
          name: "Task",
          version: 1,
          fields: [{ name: "priority", type: "text" }],
          indexes: [["priority"]]
        })
      ]
    });
    const stderr = textBuffer();
    const exitCode = await runCli(["migrate", "generate"], {
      cwd: () => target,
      migrationRegistryLoader: registryLoader(registry),
      stdout: textBuffer(),
      stderr
    });

    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain("Existing migration file '0007_doctype_task_v1_indexes.sql' has checksum");
    expect(stderr.text()).toContain("Bump the DocType version for a new migration");
  });

  it("uses stable core migration filenames when generating into an empty directory", async () => {
    const registry = createRegistry({
      doctypes: [
        defineDocType({
          name: "Task",
          version: 1,
          fields: [{ name: "priority", type: "text" }],
          indexes: [["priority"]]
        })
      ]
    });
    const stdout = textBuffer();
    const exitCode = await runCli(["migrate", "generate", "--migrations", "fresh-migrations"], {
      cwd: () => tempRoot,
      migrationRegistryLoader: registryLoader(registry),
      stdout,
      stderr: textBuffer()
    });

    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain("Wrote fresh-migrations/0001_cf_frappe_core.sql");
    expect(stdout.text()).toContain("Wrote fresh-migrations/0005_cf_frappe_data_patch_rollbacks.sql");
    expect(stdout.text()).toContain("Wrote fresh-migrations/0006_doctype_task_v1_indexes.sql");
    await expect(readFile(join(tempRoot, "fresh-migrations/0001_cf_frappe_core.sql"), "utf8")).resolves.toContain(
      "-- 0001_cf_frappe_core: cf-frappe event/projection tables"
    );
    await expect(readFile(join(tempRoot, "fresh-migrations/0001_0001_cf_frappe_core.sql"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("adds new prefixed core migrations to old starters without double-prefix filenames", async () => {
    const target = join(tempRoot, "old-starter-migrations");
    await scaffoldProject({
      targetDirectory: target,
      cfFrappeVersion: "0.1.0",
      nodeTypesVersion: "^26.0.0",
      typescriptVersion: "^5.7.2",
      tsxVersion: "^4.20.6",
      wranglerVersion: "^4.103.0"
    });
    const taskMigration = await readFile(join(target, "migrations/0007_doctype_task_v1_indexes.sql"), "utf8");
    await rm(join(target, "migrations/0004_cf_frappe_data_patches.sql"));
    await rm(join(target, "migrations/0005_cf_frappe_data_patch_rollbacks.sql"));
    await rm(join(target, "migrations/0006_doctype_file_v1_indexes.sql"));
    await rm(join(target, "migrations/0007_doctype_task_v1_indexes.sql"));
    await writeFile(join(target, "migrations/0004_doctype_task_v1_indexes.sql"), taskMigration);
    const registry = createRegistry({
      doctypes: [
        defineDocType({
          name: "Task",
          version: 1,
          fields: [
            { name: "priority", type: "select", options: ["Low", "Medium", "High"] },
            { name: "workflow_state", type: "select", options: ["Open", "Doing", "Done"] }
          ],
          indexes: [["priority"], ["workflow_state", "priority"]]
        })
      ]
    });

    const stdout = textBuffer();
    const first = await runCli(["migrate", "generate"], {
      cwd: () => target,
      migrationRegistryLoader: registryLoader(registry),
      stdout,
      stderr: textBuffer()
    });

    expect(first).toBe(0);
    expect(stdout.text()).toContain("Wrote migrations/0005_cf_frappe_data_patches.sql");
    expect(stdout.text()).toContain("Wrote migrations/0006_cf_frappe_data_patch_rollbacks.sql");
    await expect(readFile(join(target, "migrations/0005_cf_frappe_data_patches.sql"), "utf8")).resolves.toContain(
      "-- 0004_cf_frappe_data_patches: cf-frappe data patch journal"
    );
    await expect(readFile(join(target, "migrations/0006_cf_frappe_data_patch_rollbacks.sql"), "utf8")).resolves.toContain(
      "-- 0005_cf_frappe_data_patch_rollbacks: cf-frappe data patch rollback journal"
    );
    await expect(readFile(join(target, "migrations/0005_0004_cf_frappe_data_patches.sql"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(join(target, "migrations/0006_0005_cf_frappe_data_patch_rollbacks.sql"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    const secondStdout = textBuffer();
    const second = await runCli(["migrate", "generate"], {
      cwd: () => target,
      migrationRegistryLoader: registryLoader(registry),
      stdout: secondStdout,
      stderr: textBuffer()
    });
    expect(second).toBe(0);
    expect(secondStdout.text()).toContain("No new migration files were needed.");
  });

  it("reports checksum drift for generated migration files", async () => {
    const registry = createRegistry({
      doctypes: [
        defineDocType({
          name: "Customer",
          version: 2,
          fields: [{ name: "email", type: "text" }],
          indexes: [["email"]]
        })
      ]
    });
    const first = await runCli(["migrate", "generate", "--no-core"], {
      cwd: () => tempRoot,
      migrationRegistryLoader: registryLoader(registry),
      stdout: textBuffer(),
      stderr: textBuffer()
    });
    expect(first).toBe(0);

    const migrationPath = join(tempRoot, "migrations/0001_doctype_customer_v2_indexes.sql");
    const generated = await readFile(migrationPath, "utf8");
    await writeFile(migrationPath, generated.replace(/^-- checksum: .+$/mu, "-- checksum: fnv1a32:00000000"));
    const stderr = textBuffer();
    const second = await runCli(["migrate", "generate", "--no-core"], {
      cwd: () => tempRoot,
      migrationRegistryLoader: registryLoader(registry),
      stdout: textBuffer(),
      stderr
    });

    expect(second).toBe(1);
    expect(stderr.text()).toContain("Existing migration file '0001_doctype_customer_v2_indexes.sql' has checksum");
    expect(stderr.text()).toContain("Bump the DocType version for a new migration");
  });

  it("detects package managers from lockfiles", async () => {
    await expect(detectPackageManager(tempRoot)).resolves.toBe("npm");
    await writeFile(join(tempRoot, "package.json"), `${JSON.stringify({ packageManager: "pnpm@10.1.0" })}\n`);
    await expect(detectPackageManager(tempRoot)).resolves.toBe("pnpm");
    await writeFile(join(tempRoot, "package-lock.json"), "{}");
    await expect(detectPackageManager(tempRoot)).resolves.toBe("npm");
    await writeFile(join(tempRoot, "pnpm-lock.yaml"), "");
    await expect(detectPackageManager(tempRoot)).resolves.toBe("pnpm");
    await rm(join(tempRoot, "pnpm-lock.yaml"));
    await writeFile(join(tempRoot, "yarn.lock"), "");
    await expect(detectPackageManager(tempRoot)).resolves.toBe("yarn");
    await rm(join(tempRoot, "yarn.lock"));
    await writeFile(join(tempRoot, "bun.lockb"), "");
    await expect(detectPackageManager(tempRoot)).resolves.toBe("bun");
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

function packageManagerFailure(message: string): PackageManagerRunner {
  return {
    async install() {
      throw new PackageManagerError(message, "install-failed");
    }
  };
}

function packageManagerRegistryEdit(path: string, contents: string): PackageManagerRunner {
  return {
    async install() {
      await writeFile(path, contents, "utf8");
      return {
        packageManager: "npm",
        command: "npm",
        args: ["install"]
      };
    }
  };
}

function packageManagerRecorder(): PackageManagerRunner & {
  readonly calls: Array<{ readonly cwd: string; readonly packageManager: string | undefined }>;
} {
  const calls: Array<{ readonly cwd: string; readonly packageManager: string | undefined }> = [];
  return {
    calls,
    async install(options) {
      calls.push({ cwd: options.cwd, packageManager: options.packageManager });
      const packageManager = options.packageManager ?? "npm";
      return {
        packageManager,
        command: packageManager,
        args: ["install"]
      };
    }
  };
}

function registryLoader(registry: ModelRegistry) {
  return {
    async load() {
      return registry;
    }
  };
}

function binPath(command: "tsc" | "wrangler" | "esbuild"): string {
  return join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? `${command}.cmd` : command);
}

async function runTool(command: string, args: readonly string[], cwd: string): Promise<void> {
  try {
    await execFileAsync(command, args, {
      cwd,
      env: {
        ...process.env,
        CI: "1",
        NO_COLOR: "1",
        WRANGLER_SEND_METRICS: "false"
      },
      maxBuffer: 10_000_000
    });
  } catch (error) {
    throw new Error([
      `Command failed: ${command} ${args.join(" ")}`,
      commandOutput(error, "stdout"),
      commandOutput(error, "stderr")
    ].filter(Boolean).join("\n"));
  }
}

function commandOutput(error: unknown, key: "stdout" | "stderr"): string {
  if (error && typeof error === "object" && key in error) {
    const value = (error as Record<typeof key, unknown>)[key];
    return typeof value === "string" && value.trim().length > 0 ? `${key}:\n${value}` : "";
  }
  return "";
}
