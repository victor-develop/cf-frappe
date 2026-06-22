export interface StarterProjectTemplateInput {
  readonly projectName: string;
  readonly packageName: string;
  readonly databaseName: string;
  readonly compatibilityDate: string;
  readonly cfFrappeVersion: string;
  readonly nodeTypesVersion: string;
  readonly typescriptVersion: string;
  readonly wranglerVersion: string;
}

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
    { path: ".dev.vars.example", contents: devVarsExample() },
    { path: "README.md", contents: readme(input) },
    { path: "src/models.ts", contents: modelsTs() },
    { path: "src/worker.ts", contents: workerTs() },
    { path: "migrations/0001_cf_frappe_core.sql", contents: coreMigrationSql() },
    { path: "migrations/0002_task_indexes.sql", contents: taskIndexesMigrationSql() }
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
        "d1:create": `wrangler d1 create ${input.databaseName}`,
        "d1:migrate:local": `wrangler d1 migrations apply ${input.databaseName} --local`,
        "d1:migrate:remote": `wrangler d1 migrations apply ${input.databaseName} --remote`
      },
      dependencies: {
        "cf-frappe": `^${input.cfFrappeVersion}`
      },
      devDependencies: {
        "@types/node": input.nodeTypesVersion,
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
  "secrets": {
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

function devVarsExample(): string {
  return ["SESSION_SECRET=replace-with-a-long-random-local-dev-secret", ""].join("\n");
}

function readme(input: StarterProjectTemplateInput): string {
  return `# ${input.projectName}

Cloudflare-native cf-frappe starter app with D1 projections, a Durable Object command coordinator, metadata-defined DocTypes, and signed-session actor resolution.

## Local Development

\`\`\`bash
npm install
cp .dev.vars.example .dev.vars
npm run cf:types
npm run d1:migrate:local
npm run dev
\`\`\`

Open \`/desk\` for the generated Desk UI or \`/api/meta/doctypes/Task\` for the metadata API. The starter falls back to a read-only guest actor when no signed session cookie is present.

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

Run \`npm run cf:types\` after changing bindings so \`worker-configuration.d.ts\` stays aligned with \`wrangler.jsonc\`.
`;
}

function modelsTs(): string {
  return `import { createRegistryFromApps, defineApp, defineDocType, definePrintFormat, defineReport } from "cf-frappe";

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

export const taskApp = defineApp({
  name: "tasks",
  label: "Tasks",
  version: "1.0.0",
  modules: ["Desk"],
  doctypes: [Task],
  printFormats: [TaskPrint],
  reports: [OpenTasks],
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

export const registry = createRegistryFromApps([taskApp]);
`;
}

function workerTs(): string {
  return `import {
  createAggregateCoordinatorClass,
  createCloudFrappeWorker,
  signedSessionActorResolver,
  type Actor,
  type CloudFrappeEnv
} from "cf-frappe";
import { registry } from "./models";

interface Env extends CloudFrappeEnv {
  readonly SESSION_SECRET: string;
}

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

function coreMigrationSql(): string {
  return `CREATE TABLE IF NOT EXISTS cf_frappe_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  stream TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  doctype TEXT NOT NULL,
  document_name TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(stream, sequence)
);

CREATE INDEX IF NOT EXISTS idx_cf_frappe_events_stream_sequence
  ON cf_frappe_events(stream, sequence);

CREATE INDEX IF NOT EXISTS idx_cf_frappe_events_doctype_time
  ON cf_frappe_events(tenant_id, doctype, occurred_at);

CREATE INDEX IF NOT EXISTS idx_cf_frappe_events_tenant_time
  ON cf_frappe_events(tenant_id, occurred_at, stream, sequence);

CREATE TABLE IF NOT EXISTS cf_frappe_documents (
  tenant_id TEXT NOT NULL,
  doctype TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  docstatus TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, doctype, name)
);

CREATE INDEX IF NOT EXISTS idx_cf_frappe_documents_list
  ON cf_frappe_documents(tenant_id, doctype, updated_at);

CREATE TABLE IF NOT EXISTS cf_frappe_migrations (
  id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  statement_count INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);
`;
}

function taskIndexesMigrationSql(): string {
  return `CREATE INDEX IF NOT EXISTS idx_cf_frappe_documents_task_priority_f991a892
  ON cf_frappe_documents (tenant_id, doctype, json_extract(data_json, '$.priority'))
  WHERE doctype = 'Task';

CREATE INDEX IF NOT EXISTS idx_cf_frappe_documents_task_workflow_state_priority_ea45bef5
  ON cf_frappe_documents (tenant_id, doctype, json_extract(data_json, '$.workflow_state'), json_extract(data_json, '$.priority'))
  WHERE doctype = 'Task';
`;
}

function json(value: string): string {
  return JSON.stringify(value);
}
