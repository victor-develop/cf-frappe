import {
  D1_CORE_MIGRATION_ID,
  D1_DATA_PATCH_MIGRATION_ID,
  D1_DATA_PATCH_ROLLBACK_MIGRATION_ID,
  D1_JOB_EXECUTION_MESSAGE_MIGRATION_ID,
  D1_JOB_EXECUTION_MIGRATION_ID,
  planD1Migrations,
  renderD1MigrationFile
} from "../adapters/d1/schema-planner.js";
import type { DocTypeDefinition } from "../core/types.js";

const STARTER_TASK_INDEX_MIGRATION_ID = "doctype_task_v1_indexes";
const STARTER_TASK_DOCTYPE: DocTypeDefinition = {
  name: "Task",
  version: 1,
  fields: [
    { name: "priority", type: "select", options: ["Low", "Medium", "High"] },
    { name: "workflow_state", type: "select", options: ["Open", "Doing", "Done"] }
  ],
  indexes: [["priority"], ["workflow_state", "priority"]]
};
const STARTER_MIGRATIONS = planD1Migrations([STARTER_TASK_DOCTYPE]);

export interface StarterProjectTemplateInput {
  readonly projectName: string;
  readonly packageName: string;
  readonly databaseName: string;
  readonly compatibilityDate: string;
  readonly cfFrappeVersion: string;
  readonly nodeTypesVersion: string;
  readonly typescriptVersion: string;
  readonly tsxVersion: string;
  readonly wranglerVersion: string;
  readonly auth: StarterAuthMode;
}

export type StarterAuthMode = "signed-session" | "cloudflare-access";

export interface StarterProjectFile {
  readonly path: string;
  readonly contents: string;
}

export function starterProjectFiles(input: StarterProjectTemplateInput): readonly StarterProjectFile[] {
  return [
    { path: "package.json", contents: packageJson(input) },
    { path: "wrangler.jsonc", contents: wranglerJsonc(input) },
    { path: "tsconfig.json", contents: tsconfigJson() },
    { path: ".gitignore", contents: gitignore() },
    { path: ".dev.vars.example", contents: devVarsExample(input) },
    { path: "README.md", contents: readme(input) },
    { path: "public/assets/task-form.js", contents: taskFormJs() },
    { path: "src/apps/tasks.ts", contents: taskAppTs() },
    { path: "src/apps/index.ts", contents: appsIndexTs() },
    { path: "src/worker.ts", contents: workerTs(input) },
    { path: "migrations/0001_cf_frappe_core.sql", contents: starterMigrationSql(D1_CORE_MIGRATION_ID) },
    { path: "migrations/0002_cf_frappe_job_executions.sql", contents: starterMigrationSql(D1_JOB_EXECUTION_MIGRATION_ID) },
    {
      path: "migrations/0003_cf_frappe_job_execution_messages.sql",
      contents: starterMigrationSql(D1_JOB_EXECUTION_MESSAGE_MIGRATION_ID)
    },
    { path: "migrations/0004_cf_frappe_data_patches.sql", contents: starterMigrationSql(D1_DATA_PATCH_MIGRATION_ID) },
    {
      path: "migrations/0005_cf_frappe_data_patch_rollbacks.sql",
      contents: starterMigrationSql(D1_DATA_PATCH_ROLLBACK_MIGRATION_ID)
    },
    { path: "migrations/0006_doctype_task_v1_indexes.sql", contents: starterMigrationSql(STARTER_TASK_INDEX_MIGRATION_ID) }
  ];
}

function packageJson(input: StarterProjectTemplateInput): string {
  return `${JSON.stringify(
    {
      name: input.packageName,
      private: true,
      type: "module",
      scripts: {
        dev: "wrangler dev --persist-to=.wrangler/state",
        deploy: "wrangler deploy",
        "cf:types": "wrangler types",
        typecheck: "wrangler types && tsc --noEmit",
        check: "npm run typecheck",
        "d1:generate": "node --import tsx ./node_modules/cf-frappe/dist/cli.js migrate generate",
        "d1:create": `wrangler d1 create ${input.databaseName}`,
        "d1:migrate:local": `wrangler d1 migrations apply ${input.databaseName} --local`,
        "d1:migrate:remote": `wrangler d1 migrations apply ${input.databaseName} --remote`
      },
      dependencies: {
        "cf-frappe": `^${input.cfFrappeVersion}`
      },
      devDependencies: {
        "@types/node": input.nodeTypesVersion,
        tsx: input.tsxVersion,
        typescript: input.typescriptVersion,
        wrangler: input.wranglerVersion
      }
    },
    null,
    2
  )}\n`;
}

function wranglerJsonc(input: StarterProjectTemplateInput): string {
  return `{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": ${json(input.projectName)},
  "main": "src/worker.ts",
  "compatibility_date": ${json(input.compatibilityDate)},
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./public"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": ${json(input.databaseName)},
      "migrations_dir": "migrations"
    }
  ],
  "durable_objects": {
    "bindings": [
      {
        "name": "AGGREGATES",
        "class_name": "AggregateCoordinator"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["AggregateCoordinator"]
    }
  ],
${cloudflareAccessVarsJsonc(input)}  "secrets": {
    "required": ["SESSION_SECRET"]
  },
  "observability": {
    "enabled": true,
    "head_sampling_rate": 0.1
  }
}
`;
}

function tsconfigJson(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2022", "DOM"],
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,
        useDefineForClassFields: true,
        skipLibCheck: true,
        allowSyntheticDefaultImports: true,
        resolveJsonModule: true,
        isolatedModules: true,
        types: []
      },
      include: ["worker-configuration.d.ts", "src/**/*.ts"],
      exclude: ["dist", "node_modules"]
    },
    null,
    2
  )}\n`;
}

function gitignore(): string {
  return ["node_modules", ".wrangler", "dist", ".dev.vars", ""].join("\n");
}

function cloudflareAccessVarsJsonc(input: StarterProjectTemplateInput): string {
  if (input.auth !== "cloudflare-access") {
    return "";
  }
  return `  "vars": {
    "CF_ACCESS_TEAM_DOMAIN": "your-team.cloudflareaccess.com",
    "CF_ACCESS_AUD": "replace-with-access-application-aud"
  },
`;
}

function devVarsExample(input: StarterProjectTemplateInput): string {
  return [
    "SESSION_SECRET=replace-with-a-long-random-local-dev-secret",
    ...(input.auth === "cloudflare-access"
      ? [
          "CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com",
          "CF_ACCESS_AUD=replace-with-access-application-aud"
        ]
      : []),
    ""
  ].join("\n");
}

function readme(input: StarterProjectTemplateInput): string {
  return `# ${input.projectName}

Cloudflare-native cf-frappe starter app with D1 projections, a Durable Object command coordinator, metadata-defined DocTypes, and ${authReadmeSummary(input.auth)}.

## Local Development

\`\`\`bash
npm install
cp .dev.vars.example .dev.vars
npm run cf:types
npm run d1:generate
npm run d1:migrate:local
npm run dev
\`\`\`

Open \`/desk\` for the generated Desk UI or \`/api/meta/doctypes/Task\` for the metadata API. ${authLocalReadme(input.auth)}
Client scripts live under \`public/assets\`; add them with \`defineClientScript(...)\` in files under \`src/apps\`.
${cloudflareAccessReadme(input.auth)}

## Apps

The starter keeps installed app manifests in \`src/apps/index.ts\`. Save an app dependency and wire it into the registry with:

\`\`\`bash
npx cf-frappe install @acme/cf-frappe-crm
\`\`\`

The install command saves package metadata, runs the detected package manager (\`pnpm\`, \`yarn\`, \`bun\`, or \`npm\`) to update \`node_modules\` and the lockfile, then wires the app into the registry. Use \`--version <range>\` to pin the package, \`--export <name>\` for named exports, \`--as <localName>\` when you want a specific local identifier, \`--package-manager <npm|pnpm|yarn|bun>\` to override lockfile detection, \`--no-install\` to skip package-manager execution, and \`--no-save\` for local or workspace modules that are already managed outside \`package.json\`.

After adding app DocType indexes, or changing them with a DocType version bump, generate reviewable D1 migration files with \`npm run d1:generate\`, then apply them locally or remotely with the existing migration scripts.

Registered data patches can be inspected and run against a deployed Worker through the admin API. Keep secret auth material in environment variables and pass it with \`--header-env\`. Assuming \`CF_FRAPPE_AUTH\` is already exported by your shell secret manager or CI secret store:

\`\`\`bash
npx cf-frappe data-patches status --url https://your-worker.example --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches plan --url https://your-worker.example --id crm.customer_status_v1 --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches rollback-plan --url https://your-worker.example --limit 2 --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches apply --url https://your-worker.example --id crm.customer_status_v1 --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches rollback --url https://your-worker.example --id crm.customer_status_v1 --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches retry --url https://your-worker.example --id crm.customer_status_v1 --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches rollback-retry --url https://your-worker.example --id crm.customer_status_v1 --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches rollback-retry-enqueue --url https://your-worker.example --id crm.customer_status_v1 --idempotency-key patches:rollback-retry-1 --header-env Authorization=CF_FRAPPE_AUTH
\`\`\`

## Deploy

\`\`\`bash
npm run d1:create
\`\`\`

Copy the returned \`database_id\` into \`wrangler.jsonc\`, then set the production session secret with Wrangler's interactive prompt:

\`\`\`bash
wrangler secret put SESSION_SECRET
npm run d1:migrate:remote
npm run deploy
\`\`\`
${cloudflareAccessDeployReadme(input.auth)}

Run \`npm run cf:types\` after changing bindings so \`worker-configuration.d.ts\` stays aligned with \`wrangler.jsonc\`.
`;
}

function authReadmeSummary(auth: StarterAuthMode): string {
  return auth === "cloudflare-access"
    ? "Cloudflare Access account auto-sync"
    : "signed-session actor resolution";
}

function authLocalReadme(auth: StarterAuthMode): string {
  return auth === "cloudflare-access"
    ? "The starter syncs verified Cloudflare Access JWTs into event-sourced provider accounts, and denies requests that do not carry a valid Access token."
    : "The starter falls back to a read-only guest actor when no signed session cookie is present.";
}

function cloudflareAccessReadme(auth: StarterAuthMode): string {
  if (auth !== "cloudflare-access") {
    return "";
  }
  return `
## Cloudflare Access Auth

This starter expects Cloudflare Access to protect the deployed Worker hostname. Set \`CF_ACCESS_TEAM_DOMAIN\` to your Access team domain, such as \`your-team.cloudflareaccess.com\`, and \`CF_ACCESS_AUD\` to the Access application audience tag. Requests with a valid Access JWT are verified, synced into cf-frappe user-account provider events, and then authorized as the folded account actor. Keep Access application and policy creation in Cloudflare Zero Trust so rollout, allowed groups, and posture rules stay reviewable outside the app code.
`;
}

function cloudflareAccessDeployReadme(auth: StarterAuthMode): string {
  if (auth !== "cloudflare-access") {
    return "";
  }
  return `
For Cloudflare Access deployments, update the \`vars\` block in \`wrangler.jsonc\` with your Access team domain and application audience tag before deploy. The checked-in placeholders are safe for local scaffolding only.
`;
}

function taskAppTs(): string {
  return `import { defineApp, defineClientScript, defineDocType, definePrintFormat, defineReport } from "cf-frappe";

export const Task = defineDocType({
  name: "Task",
  module: "Desk",
  label: "Task",
  version: 1,
  naming: { kind: "field", field: "title" },
  fields: [
    {
      name: "title",
      label: "Title",
      type: "text",
      required: true,
      min: 3,
      max: 120
    },
    {
      name: "description",
      label: "Description",
      type: "longText"
    },
    {
      name: "priority",
      label: "Priority",
      type: "select",
      options: ["Low", "Medium", "High"],
      defaultValue: "Medium"
    },
    {
      name: "workflow_state",
      label: "Workflow State",
      type: "select",
      options: ["Open", "Doing", "Done"],
      defaultValue: "Open"
    },
    {
      name: "created_by",
      label: "Created By",
      type: "text",
      readOnly: true,
      defaultValue: ({ actor }) => actor.id
    }
  ],
  formView: {
    sections: [
      { heading: "Task", columns: 1, fields: ["title", "priority", "workflow_state"] },
      { heading: "Details", columns: 1, fields: ["description"] }
    ]
  },
  listView: {
    columns: ["title", "priority", "workflow_state"],
    filterFields: ["title", "priority", "workflow_state"],
    filters: [{ field: "workflow_state", value: "Open" }],
    pageSize: 25
  },
  workflow: {
    initialState: "Open",
    states: ["Open", "Doing", "Done"],
    transitions: [
      { action: "start", from: "Open", to: "Doing", roles: ["User", "Task Manager"] },
      { action: "finish", from: "Doing", to: "Done", roles: ["User", "Task Manager"] },
      { action: "reopen", from: "Done", to: "Open", roles: ["Task Manager"] }
    ]
  },
  permissions: [
    { roles: ["Guest"], actions: ["read"] },
    { roles: ["User"], actions: ["read", "create", "update", "transition", "comment", "assign", "tag", "follow"] },
    { roles: ["Task Manager"], actions: ["read", "create", "update", "delete", "transition", "comment", "assign", "tag", "follow"] }
  ],
  indexes: [["priority"], ["workflow_state", "priority"]]
});

export const OpenTasks = defineReport({
  name: "Open Tasks",
  label: "Open Tasks",
  module: "Desk",
  description: "Open task queue by priority.",
  doctype: "Task",
  columns: [
    { name: "title", label: "Title", type: "text" },
    { name: "priority", label: "Priority", type: "select" },
    { name: "workflow_state", label: "State", type: "select" }
  ],
  filters: [
    { name: "priority", label: "Priority", field: "priority", type: "select" },
    { name: "workflow_state", label: "State", field: "workflow_state", type: "select", defaultValue: "Open" }
  ],
  roles: ["Guest", "User", "Task Manager"]
});

export const TaskPrint = definePrintFormat({
  name: "Task Standard",
  label: "Task Standard",
  module: "Desk",
  description: "Printable task summary.",
  doctype: "Task",
  sections: [
    {
      heading: "Task",
      fields: [
        { field: "title", label: "Title" },
        { field: "priority", label: "Priority" },
        { field: "workflow_state", label: "State" },
        { field: "description", label: "Description" }
      ]
    }
  ],
  roles: ["Guest", "User", "Task Manager"]
});

export const TaskFormScript = defineClientScript({
  name: "task-form",
  doctype: "Task",
  src: "/assets/task-form.js",
  scope: "form"
});

export const taskApp = defineApp({
  name: "tasks",
  label: "Tasks",
  version: "1.0.0",
  modules: ["Desk"],
  doctypes: [Task],
  printFormats: [TaskPrint],
  reports: [OpenTasks],
  clientScripts: [TaskFormScript],
  hooks: {
    Task: [
      {
        beforeValidate: ({ data }) => ({
          title: typeof data.title === "string" ? data.title.trim() : data.title
        })
      }
    ]
  }
});
`;
}

function appsIndexTs(): string {
  return `import { createRegistryFromApps } from "cf-frappe";
/* cf-frappe app imports:start */
import { taskApp } from "./tasks";
/* cf-frappe app imports:end */

export const installedApps = [
  /* cf-frappe apps:start */
  taskApp,
  /* cf-frappe apps:end */
] as const;

export const registry = createRegistryFromApps(installedApps);
`;
}

function workerTs(input: StarterProjectTemplateInput): string {
  return input.auth === "cloudflare-access" ? cloudflareAccessWorkerTs() : signedSessionWorkerTs();
}

function signedSessionWorkerTs(): string {
  return `import {
  signedSessionActorResolver,
  type Actor
} from "cf-frappe";
import {
  createAggregateCoordinatorClass,
  createCloudFrappeWorker,
  type CloudFrappeEnv
} from "cf-frappe/cloudflare";
import { registry } from "./apps";

type Env = Cloudflare.Env & CloudFrappeEnv;

const guestActor: Actor = {
  id: "guest",
  roles: ["Guest"],
  tenantId: "default"
};

export class AggregateCoordinator extends createAggregateCoordinatorClass<Env>({
  registry
}) {}

export default createCloudFrappeWorker<Env>({
  registry,
  actor: (request, env) =>
    signedSessionActorResolver({
      secret: env.SESSION_SECRET,
      fallback: () => guestActor
    })(request)
});
`;
}

function cloudflareAccessWorkerTs(): string {
  return `import { permissionDenied } from "cf-frappe";
import {
  createAggregateCoordinatorClass,
  createCloudFrappeWorker,
  type CloudFrappeEnv
} from "cf-frappe/cloudflare";
import { registry } from "./apps";

type Env = Cloudflare.Env & CloudFrappeEnv;

export class AggregateCoordinator extends createAggregateCoordinatorClass<Env>({
  registry
}) {}

export default createCloudFrappeWorker<Env>({
  registry,
  actor: () => {
    throw permissionDenied("Cloudflare Access JWT is required");
  },
  auth: {
    sessionSecret: (env) => env.SESSION_SECRET,
    revalidateSignedSessions: true,
    cloudflareAccess: {
      teamDomain: (env) => env.CF_ACCESS_TEAM_DOMAIN,
      audience: (env) => env.CF_ACCESS_AUD,
      tenantId: () => "default",
      roles: (claims) =>
        ["User", ...(claims.groups ?? []).map((group) => \`Access:\${group}\`)]
    }
  }
});
`;
}

function taskFormJs(): string {
  return `window.cfFrappe.form.on("Task", {
  refresh(frm) {
    if (!frm.docname) {
      return;
    }
    window.cfFrappe.resource.get(frm.doctype, frm.docname).then((doc) => {
      console.debug("cf-frappe form context", {
        name: doc.name,
        version: doc.version,
        state: doc.data.workflow_state
      });
    });
  },
  title(frm) {
    console.debug("cf-frappe form context", {
      title: frm.get_value("title"),
      dirty: frm.is_dirty()
    });
  }
});
`;
}

function starterMigrationSql(id: string): string {
  const migration = STARTER_MIGRATIONS.find((candidate) => candidate.id === id);
  if (migration === undefined) {
    throw new Error(`Starter migration '${id}' is not planned`);
  }
  return renderD1MigrationFile(migration);
}

function json(value: string): string {
  return JSON.stringify(value);
}
