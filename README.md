# cf-frappe

Metadata-driven, event-sourced application framework for Cloudflare Workers.

cf-frappe takes the productive idea behind Frappe's DocType-centered development model and rebuilds it for the Cloudflare stack: Workers, Durable Objects, D1, R2, Queues, Cron Triggers, and edge-native authentication. Define your data model once, then get command APIs, generated Desk UI, permissions, workflows, reports, files, notifications, realtime collaboration, migrations, and operator tooling around it.

[GitHub](https://github.com/victor-develop/cf-frappe) - [Release v0.1.0](https://github.com/victor-develop/cf-frappe/releases/tag/v0.1.0) - [Frappe Assessment](docs/frappe-assessment.md) - [Architecture Review](docs/architecture-review.md) - [Test Parity](docs/test-parity.md)

> cf-frappe is inspired by the Frappe Framework, but it is not affiliated with Frappe Technologies. It is an experimental Cloudflare-native framework for event-sourced business applications.

## Contents

- [English](#english)
- [中文](#中文)

---

## English

### Framework

cf-frappe is a full-stack application framework for building operational and business software on Cloudflare.

In classic Frappe, DocTypes describe schema, permissions, forms, lists, reports, and API behavior. In cf-frappe, DocTypes do the same kind of work, but the write model is event-sourced by default and the runtime is designed for Cloudflare primitives:

| Frappe idea | cf-frappe direction |
| --- | --- |
| DocType | `defineDocType(...)` metadata |
| MariaDB tables | D1 append-only event streams plus current projections |
| Desk | Generated Workers-compatible Desk pages |
| Controllers/hooks | Pure hook contracts and model registries |
| Background jobs | Queues, Cron Triggers, and event-sourced schedules |
| File attachments | R2-backed `File` metadata and object storage |
| Realtime | Durable Object topics, replay, presence, and collaboration |
| Permissions | Role rules, document shares, and event-sourced user permissions |
| Apps | Composable `defineApp(...)` manifests |

### Philosophy

The best application code is the code you do not have to repeat.

cf-frappe is built around four constraints:

- Model first: metadata should describe data, forms, permissions, workflows, reports, files, and website surfaces in one place.
- Event sourced by default: writes append immutable domain events, projections are derived, and auditability is a first-class property.
- Cloudflare native: the framework should fit Workers, D1, Durable Objects, R2, Queues, Cron Triggers, and Cloudflare Access instead of hiding them behind a serverful abstraction.
- Small boundaries: business decisions live in focused policies and event helpers; adapters do I/O and orchestration.

### Key Features

- Typed DocType metadata with fields, defaults, validation, naming, permissions, workflows, links, and child tables.
- Event-sourced document lifecycle: create, update, submit, cancel, delete, duplicate, amend, comments, assignments, tags, followers, shares, and timelines.
- Atomic multi-stream document commits for naming series, unique values, and document events through `DocumentStore.commitBatch`.
- Generated HTTP resource APIs, CSV import/export, global search, link options, and remote CLI operations.
- Generated Desk list/form UI with saved filters, compound filters, layouts, client scripts, bulk actions, and navigation.
- Metadata-defined reports, report builder, dashboards, Calendar views, Kanban boards, print formats, letterheads, website pages, web views, and public web forms.
- Event-sourced tenant customization: custom fields, field property overrides, workflow definitions, print settings, notification rules, role catalog, users, profiles, and user permissions.
- Cloudflare adapters for D1, Durable Objects, R2, Queues, Cron Triggers, Browser Rendering PDF, Images-style transforms, Access, and generic OIDC.
- R2-backed file manager with buffered upload, direct upload, multipart upload, previews, transforms, renditions, scan hooks, and bulk metadata/delete workflows.
- Durable notification, email, and realtime delivery outbox with queue drain, retry, and replay coverage.
- Starter scaffold with Task app, D1 migrations, R2 file storage, Queue jobs, Durable Object coordination, signed-session auth, Cloudflare Access auth, or OIDC auth.

### Quick Start

Requirements:

- Node.js `>=22`
- npm
- Wrangler authenticated with your Cloudflare account

Install the CLI from this repository:

```bash
git clone https://github.com/victor-develop/cf-frappe.git
cd cf-frappe
npm install
npm run build
npm link
```

Create an app:

```bash
cf-frappe init my-app
cd my-app
npm install
cp .dev.vars.example .dev.vars
npm run cf:types
npm run d1:generate
npm run d1:migrate:local
npm run dev
```

Start with Cloudflare Access:

```bash
cf-frappe init my-app --auth cloudflare-access
cf-frappe access plan \
  --account-id <account-id> \
  --team-domain your-team.cloudflareaccess.com \
  --name "My App" \
  --domain app.example.com \
  --email-domain example.com
```

Start with any RS256 OpenID Connect provider:

```bash
cf-frappe init my-app --auth oidc
```

Then replace the generated placeholder issuer, audience, and JWKS URL in `wrangler.jsonc`.

### Define A Model

```ts
import {
  createRegistryFromApps,
  defineApp,
  defineDocType,
  defineReport,
  defineWebForm
} from "cf-frappe";

export const Project = defineDocType({
  name: "Project",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true }
  ],
  permissions: [
    { roles: ["User"], actions: ["read", "create", "update"] }
  ]
});

export const Task = defineDocType({
  name: "Task",
  naming: { kind: "series", pattern: "TASK-.####" },
  fields: [
    { name: "title", type: "text", required: true, min: 3 },
    { name: "project", type: "link", linkTo: "Project", required: true },
    { name: "priority", type: "select", options: ["Low", "Medium", "High"], defaultValue: "Medium" },
    { name: "status", type: "select", options: ["Open", "Done"], defaultValue: "Open" }
  ],
  workflow: {
    initialState: "Open",
    states: ["Open", "Done"],
    transitions: [
      { action: "complete", from: "Open", to: "Done", roles: ["User"] }
    ]
  },
  permissions: [
    { roles: ["User"], actions: ["read", "create", "update", "transition"] }
  ]
});

export const OpenTasks = defineReport({
  name: "Open Tasks",
  doctype: "Task",
  columns: ["name", "title", "project", "priority", "status"],
  filters: [{ field: "status", value: "Open" }]
});

export const TaskIntake = defineWebForm({
  name: "Task Intake",
  doctype: "Task",
  route: "/task-intake",
  fields: ["title", "project", "priority"]
});

export const app = defineApp({
  name: "tasks",
  doctypes: [Project, Task],
  reports: [OpenTasks],
  webForms: [TaskIntake]
});

export const registry = createRegistryFromApps([app]);
```

### Production Setup

cf-frappe apps are Cloudflare Workers projects. The generated starter includes the Worker entrypoint, D1 migration files, Durable Object binding, Queue bindings, R2 binding, and local development scripts.

Typical deployment flow:

```bash
npm run cf:types
npm run d1:generate
npm run d1:migrate:remote
npm run deploy
```

For authentication, choose one of:

- signed-session auth for simple applications,
- Cloudflare Access for Zero Trust protected internal applications,
- generic OIDC for Okta, Auth0, Google Workspace, and other RS256 providers.

### Development Setup

Work on the framework:

```bash
git clone https://github.com/victor-develop/cf-frappe.git
cd cf-frappe
npm install
npm run check
```

Run the example:

```bash
npm run build
npx wrangler d1 create cf-frappe-dev
npm run d1:migrate:local
npm run dev
```

The repository currently passes:

- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run check`

Current verification: `235` Vitest files and `2787` tests passing.

### TODO

- Optimize Durable Object routing for UUID-named document creation so creates do not concentrate on the `_new` aggregate key while preserving naming, unique-value, and event-commit correctness.

### Documentation

- [Frappe Assessment](docs/frappe-assessment.md): comparison against the official Frappe Framework concepts.
- [Architecture Review](docs/architecture-review.md): architecture-quality review history and standalone reviewer evidence.
- [Test Parity](docs/test-parity.md): test-count target and current parity against the upstream Frappe reference.
- [Todo Example](examples/todos): small runnable model and Worker example.

### Contributing

Contributions should preserve the architecture style:

- add tests before or with behavior changes,
- keep domain decisions in focused policies or event helpers,
- keep adapters thin and I/O oriented,
- keep event-sourced writes append-only and projection-safe,
- run `npm run check` before submitting changes.

### License

MIT

---

## 中文

### 框架简介

cf-frappe 是一个运行在 Cloudflare 上的全栈应用框架，用来构建内部系统、运营工具、业务后台和数据驱动的应用。

Frappe 的高效来自 DocType：用一份元数据描述 schema、权限、表单、列表、报表和 API。cf-frappe 保留这个开发体验，但把默认写模型改成 event sourcing，并把运行时换成 Cloudflare 原生组件：

| Frappe 概念 | cf-frappe 方向 |
| --- | --- |
| DocType | `defineDocType(...)` 元数据 |
| MariaDB 表 | D1 append-only 事件流 + 当前态投影 |
| Desk | Workers 兼容的生成式 Desk 页面 |
| Controller / hook | 纯 hook contract 和 model registry |
| 后台任务 | Queues、Cron Triggers、事件化 schedule |
| 文件附件 | R2 对象存储 + `File` 元数据 |
| 实时协作 | Durable Object topic、replay、presence、协作事件 |
| 权限 | 角色规则、文档分享、事件化用户权限 |
| App | 可组合的 `defineApp(...)` manifest |

### 设计哲学

最好的应用代码，是你不需要反复写的代码。

cf-frappe 的设计约束：

- 模型优先：数据、表单、权限、workflow、报表、文件和网站页面都应该由元数据驱动。
- Event sourcing first：写入追加不可变领域事件，当前态由投影得出，审计能力是默认能力。
- Cloudflare native：直接拥抱 Workers、D1、Durable Objects、R2、Queues、Cron Triggers 和 Cloudflare Access。
- 边界清晰：业务判断放在 policy 和 event helper；adapter 只做 I/O 和编排。

### 核心能力

- 类型化 DocType 元数据：字段、默认值、校验、命名规则、权限、workflow、link field、child table。
- 事件化文档生命周期：创建、更新、提交、取消、删除、复制、修订、评论、分配、标签、关注、分享和时间线。
- 文档命名序列、唯一值占用和文档事件通过 `DocumentStore.commitBatch` 做多 stream 原子提交。
- 自动生成 HTTP resource API、CSV 导入导出、全局搜索、link options 和远程 CLI。
- 自动生成 Desk 列表/表单 UI，支持 saved filters、compound filters、布局、client script、批量操作和导航。
- 元数据定义 report、report builder、dashboard、Calendar、Kanban、print format、letterhead、website page、web view 和 public web form。
- 事件化租户定制：custom fields、field property overrides、workflow definitions、print settings、notification rules、role catalog、users、profiles、user permissions。
- Cloudflare adapter：D1、Durable Objects、R2、Queues、Cron Triggers、Browser Rendering PDF、图片转换、Cloudflare Access 和通用 OIDC。
- R2 文件管理：普通上传、direct upload、multipart upload、预览、转换、rendition、扫描 hook、批量元数据更新和删除。
- 持久化 notification/email/realtime delivery outbox，支持 queue drain、retry 和 replay。
- Starter scaffold 内置 Task app、D1 migration、R2 文件、Queue job、Durable Object 协调、signed-session、Cloudflare Access 或 OIDC 登录。

### 快速开始

要求：

- Node.js `>=22`
- npm
- 已登录 Wrangler / Cloudflare 账号

从当前仓库安装 CLI：

```bash
git clone https://github.com/victor-develop/cf-frappe.git
cd cf-frappe
npm install
npm run build
npm link
```

创建应用：

```bash
cf-frappe init my-app
cd my-app
npm install
cp .dev.vars.example .dev.vars
npm run cf:types
npm run d1:generate
npm run d1:migrate:local
npm run dev
```

使用 Cloudflare Access：

```bash
cf-frappe init my-app --auth cloudflare-access
cf-frappe access plan \
  --account-id <account-id> \
  --team-domain your-team.cloudflareaccess.com \
  --name "My App" \
  --domain app.example.com \
  --email-domain example.com
```

使用通用 OIDC：

```bash
cf-frappe init my-app --auth oidc
```

然后在生成的 `wrangler.jsonc` 里替换 issuer、audience 和 JWKS URL。

### 定义模型

```ts
import {
  createRegistryFromApps,
  defineApp,
  defineDocType,
  defineReport,
  defineWebForm
} from "cf-frappe";

export const Project = defineDocType({
  name: "Project",
  naming: { kind: "field", field: "title" },
  fields: [{ name: "title", type: "text", required: true }],
  permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
});

export const Task = defineDocType({
  name: "Task",
  naming: { kind: "series", pattern: "TASK-.####" },
  fields: [
    { name: "title", type: "text", required: true, min: 3 },
    { name: "project", type: "link", linkTo: "Project", required: true },
    { name: "priority", type: "select", options: ["Low", "Medium", "High"], defaultValue: "Medium" },
    { name: "status", type: "select", options: ["Open", "Done"], defaultValue: "Open" }
  ],
  workflow: {
    initialState: "Open",
    states: ["Open", "Done"],
    transitions: [{ action: "complete", from: "Open", to: "Done", roles: ["User"] }]
  },
  permissions: [{ roles: ["User"], actions: ["read", "create", "update", "transition"] }]
});

export const OpenTasks = defineReport({
  name: "Open Tasks",
  doctype: "Task",
  columns: ["name", "title", "project", "priority", "status"],
  filters: [{ field: "status", value: "Open" }]
});

export const TaskIntake = defineWebForm({
  name: "Task Intake",
  doctype: "Task",
  route: "/task-intake",
  fields: ["title", "project", "priority"]
});

export const app = defineApp({
  name: "tasks",
  doctypes: [Project, Task],
  reports: [OpenTasks],
  webForms: [TaskIntake]
});

export const registry = createRegistryFromApps([app]);
```

### 生产部署

cf-frappe 应用就是 Cloudflare Workers 项目。生成的 starter 包含 Worker 入口、D1 migration、Durable Object binding、Queue binding、R2 binding 和本地开发脚本。

常见部署流程：

```bash
npm run cf:types
npm run d1:generate
npm run d1:migrate:remote
npm run deploy
```

认证方式可以选择：

- signed-session：适合简单应用，
- Cloudflare Access：适合 Zero Trust 保护的内部系统，
- 通用 OIDC：适合 Okta、Auth0、Google Workspace 等 RS256 provider。

### 开发环境

开发框架本身：

```bash
git clone https://github.com/victor-develop/cf-frappe.git
cd cf-frappe
npm install
npm run check
```

运行示例：

```bash
npm run build
npx wrangler d1 create cf-frappe-dev
npm run d1:migrate:local
npm run dev
```

当前仓库通过：

- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run check`

当前验证结果：`235` 个 Vitest 文件，`2787` 个测试全部通过。

### TODO

See [English TODO](#todo).

### 文档

- [Frappe Assessment](docs/frappe-assessment.md)：和官方 Frappe Framework 概念的对照评估。
- [Architecture Review](docs/architecture-review.md)：架构质量评审历史和独立评审证据。
- [Test Parity](docs/test-parity.md)：和上游 Frappe 测试数量目标的对齐情况。
- [Todo Example](examples/todos)：一个小型可运行模型和 Worker 示例。

### 贡献

贡献时请保持当前架构风格：

- 行为变更要同时提供测试，
- 领域判断放进聚焦的 policy 或 event helper，
- adapter 保持薄，只做 I/O 和编排，
- event-sourced 写入保持 append-only，并保护 projection 一致性，
- 提交前运行 `npm run check`。

### 许可证

MIT
