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

export type StarterAuthMode = "signed-session" | "cloudflare-access" | "oidc";

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
  "queues": {
    "producers": [
      {
        "binding": "JOBS",
        "queue": "${input.projectName}-jobs"
      }
    ],
    "consumers": [
      {
        "queue": "${input.projectName}-jobs",
        "max_batch_size": 10,
        "max_batch_timeout": 5,
        "max_retries": 3
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["AggregateCoordinator"]
    }
  ],
${authVarsJsonc(input)}  "secrets": {
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

function authVarsJsonc(input: StarterProjectTemplateInput): string {
  if (input.auth === "cloudflare-access") {
    return `  "vars": {
    "CF_ACCESS_TEAM_DOMAIN": "your-team.cloudflareaccess.com",
    "CF_ACCESS_AUD": "replace-with-access-application-aud"
  },
`;
  }
  if (input.auth === "oidc") {
    return `  "vars": {
    "OIDC_ISSUER": "https://login.example.com",
    "OIDC_AUD": "replace-with-oidc-audience",
    "OIDC_JWKS_URL": "https://login.example.com/.well-known/jwks.json"
  },
`;
  }
  return "";
}

function devVarsExample(input: StarterProjectTemplateInput): string {
  return [
    "SESSION_SECRET=replace-with-a-long-random-local-dev-secret",
    ...(input.auth === "cloudflare-access"
      ? [
          "CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com",
          "CF_ACCESS_AUD=replace-with-access-application-aud"
        ]
      : input.auth === "oidc"
        ? [
            "OIDC_ISSUER=https://login.example.com",
            "OIDC_AUD=replace-with-oidc-audience",
            "OIDC_JWKS_URL=https://login.example.com/.well-known/jwks.json"
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

Open \`/desk\` for the generated Desk UI, the \`Tasks\` workspace, and the \`Task Dashboard\`; run the \`tasks.seed_starter_tasks\` data patch when you want sample Task records in a fresh environment. Use \`/api/meta/doctypes/Task\` for the metadata API. ${authLocalReadme(input.auth)}
Client scripts live under \`public/assets\`; add them with \`defineClientScript(...)\` in files under \`src/apps\`.
${authProviderReadme(input.auth)}

## Apps

The starter keeps installed app manifests in \`src/apps/index.ts\`. Save an app dependency and wire it into the registry with:

\`\`\`bash
npx cf-frappe install @acme/cf-frappe-crm
\`\`\`

The install command saves package metadata, runs the detected package manager (\`pnpm\`, \`yarn\`, \`bun\`, or \`npm\`) to update \`node_modules\` and the lockfile, then wires the app into the registry. Use \`--version <range>\` to pin the package, \`--export <name>\` for named exports, \`--as <localName>\` when you want a specific local identifier, \`--package-manager <npm|pnpm|yarn|bun>\` to override lockfile detection, \`--no-install\` to skip package-manager execution, and \`--no-save\` for local or workspace modules that are already managed outside \`package.json\`.

After adding app DocType indexes, or changing them with a DocType version bump, generate reviewable D1 migration files with \`npm run d1:generate\`, then apply them locally or remotely with the existing migration scripts.

## Deployment

Create the D1 database and Queue before the first remote deploy:

\`\`\`bash
npx wrangler d1 create ${input.databaseName}
npx wrangler queues create ${input.projectName}-jobs
\`\`\`

Registered data patches can be inspected and run against a deployed Worker through the admin API. Keep secret auth material in environment variables and pass it with \`--header-env\`. Assuming \`CF_FRAPPE_AUTH\` is already exported by your shell secret manager or CI secret store:

\`\`\`bash
npx cf-frappe data-patches status --url https://your-worker.example --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches plan --url https://your-worker.example --id tasks.seed_starter_tasks --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches rollback-plan --url https://your-worker.example --limit 2 --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches apply --url https://your-worker.example --id tasks.seed_starter_tasks --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches rollback --url https://your-worker.example --id tasks.seed_starter_tasks --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches retry --url https://your-worker.example --id tasks.seed_starter_tasks --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches rollback-retry --url https://your-worker.example --id tasks.seed_starter_tasks --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches enqueue --url https://your-worker.example --id tasks.seed_starter_tasks --idempotency-key patches:starter-seed --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches rollback-enqueue --url https://your-worker.example --id tasks.seed_starter_tasks --idempotency-key patches:starter-seed-rollback --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches rollback-retry-enqueue --url https://your-worker.example --id tasks.seed_starter_tasks --idempotency-key patches:rollback-retry-1 --header-env Authorization=CF_FRAPPE_AUTH
\`\`\`

Background jobs and runtime schedules use the same remote admin style:

\`\`\`bash
npx cf-frappe jobs list --url https://your-worker.example --status failed --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe jobs get --url https://your-worker.example --idempotency-key reports.daily:job_001 --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe jobs retry --url https://your-worker.example --idempotency-key reports.daily:job_001 --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe jobs schedules --url https://your-worker.example --job reports.daily --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe jobs schedule-run --url https://your-worker.example --id daily-reports --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe jobs schedule-save --url https://your-worker.example --id runtime-daily --cron "15 4 * * *" --job reports.daily --enabled --payload-json '{"scope":"runtime"}' --header-env Authorization=CF_FRAPPE_AUTH
\`\`\`

File operators can inspect filtered file metadata, update attachment/privacy metadata, and delete stale File records through the same admin API boundary:

\`\`\`bash
npx cf-frappe files list --url https://your-worker.example --filename invoice --limit 20 --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe files update --url https://your-worker.example --name file_invoice --public --clear-attachment --expected-version 3 --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe files bulk-update --url https://your-worker.example --file file_invoice --file-version file_quote:2 --private --attached-to-doctype Sales\\ Invoice --attached-to-name SINV-1 --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe files bulk-delete --url https://your-worker.example --file-version file_invoice:3 --file file_stale --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe files rendition --url https://your-worker.example --name file_image --width 320 --height 240 --fit cover --format webp --watermark Draft --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe files delete --url https://your-worker.example --name file_invoice --expected-version 3 --header-env Authorization=CF_FRAPPE_AUTH
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
${authProviderDeployReadme(input.auth)}

Run \`npm run cf:types\` after changing bindings so \`worker-configuration.d.ts\` stays aligned with \`wrangler.jsonc\`.
`;
}

function authReadmeSummary(auth: StarterAuthMode): string {
  if (auth === "cloudflare-access") {
    return "Cloudflare Access account auto-sync";
  }
  if (auth === "oidc") {
    return "OIDC account auto-sync";
  }
  return "signed-session actor resolution";
}

function authLocalReadme(auth: StarterAuthMode): string {
  if (auth === "cloudflare-access") {
    return "The starter syncs verified Cloudflare Access JWTs into event-sourced provider accounts, and denies requests that do not carry a valid Access token.";
  }
  if (auth === "oidc") {
    return "The starter syncs verified OIDC Bearer tokens into event-sourced provider accounts, and denies requests that do not carry a valid OIDC token or signed session.";
  }
  return "The starter falls back to a read-only guest actor when no signed session cookie is present.";
}

function authProviderReadme(auth: StarterAuthMode): string {
  if (auth === "cloudflare-access") {
    return `
## Cloudflare Access Auth

This starter expects Cloudflare Access to protect the deployed Worker hostname. Set \`CF_ACCESS_TEAM_DOMAIN\` to your Access team domain, such as \`your-team.cloudflareaccess.com\`, and \`CF_ACCESS_AUD\` to the Access application audience tag. Requests with a valid Access JWT are verified, synced into cf-frappe user-account provider events, and then authorized as the folded account actor. You can review or create the matching Access application and policy with:

\`\`\`bash
npx cf-frappe access plan --account-id <account-id> --team-domain your-team.cloudflareaccess.com --name "My App" --domain app.example.com --email-domain example.com
npx cf-frappe access apply --account-id <account-id> --team-domain your-team.cloudflareaccess.com --name "My App" --domain app.example.com --email-domain example.com --api-token-env CF_API_TOKEN
\`\`\`

Use \`access plan\` first so rollout, allowed groups, and posture assumptions stay reviewable before mutating Cloudflare Zero Trust resources. The API token used for \`access apply\` should have Access application and policy write permissions.
`;
  }
  if (auth === "oidc") {
    return `
## OIDC Auth

This starter expects an OpenID Connect provider to issue RS256 JWTs for the deployed Worker hostname. Set \`OIDC_ISSUER\` to the exact token issuer, \`OIDC_AUD\` to the accepted audience/client id, and \`OIDC_JWKS_URL\` to the provider's HTTPS JWKS endpoint. Requests with a valid \`Authorization: Bearer <token>\` JWT are verified, synced into cf-frappe user-account provider events, and then authorized as the folded account actor. The default mapping grants \`User\` plus \`OIDC:<group>\` roles from the optional \`groups\` claim; adjust \`src/worker.ts\` when your provider stores roles in a different claim.

The OIDC adapter requires the standard \`sub\` claim for account sync. If your provider needs a different stable subject, configure the generated \`subject\` mapper explicitly rather than falling back to mutable email claims.
`;
  }
  return "";
}

function authProviderDeployReadme(auth: StarterAuthMode): string {
  if (auth === "cloudflare-access") {
    return `
For Cloudflare Access deployments, run \`npx cf-frappe access plan --account-id <account-id> --team-domain your-team.cloudflareaccess.com --name "My App" --domain app.example.com --email-domain example.com\` to review the Access application/policy payloads, then run the same command as \`access apply\` with \`--api-token-env CF_API_TOKEN\` when you are ready to create them. Copy the returned \`CF_ACCESS_TEAM_DOMAIN\` and \`CF_ACCESS_AUD\` into the \`vars\` block in \`wrangler.jsonc\` before deploy. The checked-in placeholders are safe for local scaffolding only.
`;
  }
  if (auth === "oidc") {
    return `
For OIDC deployments, replace the placeholder \`OIDC_ISSUER\`, \`OIDC_AUD\`, and \`OIDC_JWKS_URL\` values in the \`vars\` block in \`wrangler.jsonc\` before deploy. The issuer and JWKS URL must be HTTPS URLs, and \`OIDC_ISSUER\` must match the JWT \`iss\` claim exactly.
`;
  }
  return "";
}

function taskAppTs(): string {
  return `import { defineApp, defineClientScript, defineDashboard, defineDataPatch, defineDocType, definePrintFormat, defineReport, defineWorkspace } from "cf-frappe";
import type { CloudFrappeRuntimeServices } from "cf-frappe/cloudflare";

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
    },
    {
      name: "starter_seed_patch",
      label: "Starter Seed Patch",
      type: "text",
      readOnly: true,
      hidden: true
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

export const TaskDashboard = defineDashboard({
  name: "Task Dashboard",
  label: "Task Dashboard",
  module: "Desk",
  description: "Operational snapshot for the starter Task queue.",
  roles: ["Guest", "User", "Task Manager"],
  cards: [
    {
      name: "open_tasks",
      label: "Open Tasks",
      indicatorRules: [
        { operator: "eq", value: 0, indicator: "green" },
        { operator: "gt", value: 0, indicator: "orange" }
      ],
      source: {
        kind: "documentCount",
        doctype: "Task",
        filters: [{ field: "workflow_state", value: "Open" }]
      }
    },
    {
      name: "doing_tasks",
      label: "Doing",
      indicator: "blue",
      source: {
        kind: "documentCount",
        doctype: "Task",
        filters: [{ field: "workflow_state", value: "Doing" }]
      }
    }
  ]
});

export const TaskWorkspace = defineWorkspace({
  name: "Tasks",
  label: "Tasks",
  module: "Desk",
  description: "Starter task desk with list, create, report, dashboard, file, and admin shortcuts.",
  roles: ["Guest", "User", "Task Manager"],
  sections: [
    {
      name: "tasks",
      label: "Tasks",
      shortcuts: [
        { name: "all-tasks", label: "All Tasks", kind: "doctype", target: "Task" },
        { name: "new-task", label: "New Task", kind: "newDoc", target: "Task", roles: ["User", "Task Manager"] },
        { name: "open-tasks", label: "Open Tasks Report", kind: "report", target: "Open Tasks" },
        { name: "task-dashboard", label: "Task Dashboard", kind: "dashboard", target: "Task Dashboard" }
      ]
    },
    {
      name: "operations",
      label: "Operations",
      shortcuts: [
        { name: "files", label: "Files", kind: "file", roles: ["User", "Task Manager"] },
        { name: "roles", label: "Roles", kind: "admin", target: "roles", roles: ["Task Manager"] }
      ]
    }
  ]
});

const STARTER_TASK_SEED_PATCH_ID = "tasks.seed_starter_tasks";
const STARTER_TASK_SEED_ACTOR = {
  id: "starter-seed",
  roles: ["Task Manager"],
  tenantId: "default"
};
const STARTER_TASK_SEED_RECORDS = [
  {
    title: "Review generated Desk workspace",
    priority: "High",
    workflow_state: "Open",
    starter_seed_patch: STARTER_TASK_SEED_PATCH_ID,
    description: "Open /desk and explore the Tasks workspace, report, and dashboard."
  },
  {
    title: "Deploy to Cloudflare Workers",
    priority: "Medium",
    workflow_state: "Doing",
    starter_seed_patch: STARTER_TASK_SEED_PATCH_ID,
    description: "Create D1, apply migrations, and run wrangler deploy."
  }
] as const;

export const StarterTaskSeedData = defineDataPatch<CloudFrappeRuntimeServices>({
  id: STARTER_TASK_SEED_PATCH_ID,
  label: "Seed starter Task records",
  checksum: "v2",
  async run({ resources }) {
    let created = 0;
    let skipped = 0;

    for (const task of STARTER_TASK_SEED_RECORDS) {
      const existing = await resources.queries.listDocuments(STARTER_TASK_SEED_ACTOR, "Task", {
        filters: [{ field: "title", value: task.title }],
        limit: 1
      });
      if (existing.data.length > 0) {
        skipped += 1;
        continue;
      }
      await resources.documents.create({
        actor: STARTER_TASK_SEED_ACTOR,
        doctype: "Task",
        data: task,
        metadata: { patchId: STARTER_TASK_SEED_PATCH_ID }
      });
      created += 1;
    }

    return { created, skipped };
  },
  rollback: {
    label: "Remove starter Task records",
    async run({ resources }) {
      let deleted = 0;
      let skipped = 0;

      for (const task of STARTER_TASK_SEED_RECORDS) {
        const existing = await resources.queries.listDocuments(STARTER_TASK_SEED_ACTOR, "Task", {
          filters: [
            { field: "title", value: task.title },
            { field: "starter_seed_patch", value: STARTER_TASK_SEED_PATCH_ID }
          ],
          limit: 1
        });
        const [document] = existing.data;
        if (document === undefined) {
          skipped += 1;
          continue;
        }
        await resources.documents.delete({
          actor: STARTER_TASK_SEED_ACTOR,
          doctype: "Task",
          name: document.name,
          metadata: { patchId: STARTER_TASK_SEED_PATCH_ID, rollback: true }
        });
        deleted += 1;
      }

      return { deleted, skipped };
    }
  }
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
  dashboards: [TaskDashboard],
  workspaces: [TaskWorkspace],
  dataPatches: [StarterTaskSeedData],
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
  if (input.auth === "cloudflare-access") {
    return cloudflareAccessWorkerTs();
  }
  if (input.auth === "oidc") {
    return oidcWorkerTs();
  }
  return signedSessionWorkerTs();
}

function signedSessionWorkerTs(): string {
  return `import {
  createDataPatchApplyJob,
  createDataPatchRollbackJob,
  createDataPatchRollbackRetryJob,
  createJobRegistry,
  signedSessionActorResolver,
  type Actor
} from "cf-frappe";
import {
  CloudflareJobQueue,
  createAggregateCoordinatorClass,
  createCloudFrappeWorker,
  type CloudFrappeEnv,
  type CloudFrappeRuntimeServices
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

const starterJobs = createJobRegistry<CloudFrappeRuntimeServices>({
  jobs: [
    createDataPatchApplyJob<CloudFrappeRuntimeServices>(),
    createDataPatchRollbackJob<CloudFrappeRuntimeServices>(),
    createDataPatchRollbackRetryJob<CloudFrappeRuntimeServices>()
  ]
});

export default createCloudFrappeWorker<Env>({
  registry,
  actor: (request, env) =>
    signedSessionActorResolver({
      secret: env.SESSION_SECRET,
      fallback: () => guestActor
    })(request),
  jobs: {
    registry: starterJobs,
    queue: (env) => new CloudflareJobQueue(env.JOBS)
  }
});
`;
}

function cloudflareAccessWorkerTs(): string {
  return `import {
  createDataPatchApplyJob,
  createDataPatchRollbackJob,
  createDataPatchRollbackRetryJob,
  createJobRegistry,
  permissionDenied
} from "cf-frappe";
import {
  CloudflareJobQueue,
  createAggregateCoordinatorClass,
  createCloudFrappeWorker,
  type CloudFrappeEnv,
  type CloudFrappeRuntimeServices
} from "cf-frappe/cloudflare";
import { registry } from "./apps";

type Env = Cloudflare.Env & CloudFrappeEnv;

export class AggregateCoordinator extends createAggregateCoordinatorClass<Env>({
  registry
}) {}

const starterJobs = createJobRegistry<CloudFrappeRuntimeServices>({
  jobs: [
    createDataPatchApplyJob<CloudFrappeRuntimeServices>(),
    createDataPatchRollbackJob<CloudFrappeRuntimeServices>(),
    createDataPatchRollbackRetryJob<CloudFrappeRuntimeServices>()
  ]
});

export default createCloudFrappeWorker<Env>({
  registry,
  actor: () => {
    throw permissionDenied("Cloudflare Access JWT is required");
  },
  jobs: {
    registry: starterJobs,
    queue: (env) => new CloudflareJobQueue(env.JOBS)
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

function oidcWorkerTs(): string {
  return `import {
  createDataPatchApplyJob,
  createDataPatchRollbackJob,
  createDataPatchRollbackRetryJob,
  createJobRegistry,
  oidcGroupsRoleMapper,
  permissionDenied
} from "cf-frappe";
import {
  CloudflareJobQueue,
  createAggregateCoordinatorClass,
  createCloudFrappeWorker,
  type CloudFrappeEnv,
  type CloudFrappeRuntimeServices
} from "cf-frappe/cloudflare";
import { registry } from "./apps";

type Env = Cloudflare.Env & CloudFrappeEnv;

export class AggregateCoordinator extends createAggregateCoordinatorClass<Env>({
  registry
}) {}

const starterJobs = createJobRegistry<CloudFrappeRuntimeServices>({
  jobs: [
    createDataPatchApplyJob<CloudFrappeRuntimeServices>(),
    createDataPatchRollbackJob<CloudFrappeRuntimeServices>(),
    createDataPatchRollbackRetryJob<CloudFrappeRuntimeServices>()
  ]
});

export default createCloudFrappeWorker<Env>({
  registry,
  actor: () => {
    throw permissionDenied("OIDC token is required");
  },
  jobs: {
    registry: starterJobs,
    queue: (env) => new CloudflareJobQueue(env.JOBS)
  },
  auth: {
    sessionSecret: (env) => env.SESSION_SECRET,
    revalidateSignedSessions: true,
    oidc: {
      issuer: (env) => env.OIDC_ISSUER,
      audience: (env) => env.OIDC_AUD,
      jwksUrl: (env) => env.OIDC_JWKS_URL,
      provider: "oidc",
      tenantId: () => "default",
      roles: oidcGroupsRoleMapper()
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
