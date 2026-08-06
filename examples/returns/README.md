# ReturnsOS Example

ReturnsOS is the full reference application for cf-frappe's named multi-workflow and durable Automation architecture. It models a return as four independent lifecycles instead of compressing every concern into one status field.

[中文说明](#中文说明)

## What It Demonstrates

- Three linked DocTypes: `Customer`, `Order`, and `Return Request`.
- Four named workflows on one `Return Request`: `case`, `logistics`, `inspection`, and `refund`.
- Cross-workflow guards, with role checks kept separate from business conditions.
- Five product-level composite commands for acceptance, dispatch, inspection, refund scheduling, and completion.
- Durable, idempotent Automation Runs that update the return, linked order, and linked customer.
- Queue-driven delivery plus a periodic recovery drain for missed or delayed delivery signals.
- Field-level permissions for agent, warehouse, finance, and manager responsibilities.
- A scoped public-intake verifier that checks Customer/Order ownership and amount limits without exposing either master-data API to Guest.
- A standalone responsive ReturnsOS operations frontend at `/returns`, built on the same permission-filtered resource API and command boundary as Desk.
- Generated Desk forms and lists, workspace, Kanban, dashboard, report, Calendar, public web form, print format, assignments, timelines, and audit events as the administration and power-user surface.

## Run Locally

Requirements: Node.js 22 or newer, npm, and Wrangler. The latest stable Node.js is recommended for local development. With `mise`:

```bash
mise exec node@latest -- npm install
mise exec node@latest -- npm run up
```

After the first `npm install`, `mise exec node@latest -- npm run up` is the only command needed after a reboot or laptop sleep. It requires no project-level mise trust, applies pending local D1 migrations, preserves `.wrangler/state`, and uses the first available port from `8787` through `8797`. The terminal prints the exact ReturnsOS and demo URLs.

Open [http://localhost:8787/demo](http://localhost:8787/demo).

1. Select **Demo Administrator**.
2. Select **Seed deterministic demo data**.
3. Open **ReturnsOS app** for the custom product frontend.
4. Use **Admin Desk** only when inspecting generated metadata surfaces or raw records.
5. Switch personas from either `/demo` or the profile menu in `/returns` when testing role-specific journeys.

The primary showcase is [http://localhost:8787/returns](http://localhost:8787/returns). It is an independent server-rendered application, not a restyled Desk page. All reads still use the permission-filtered cf-frappe resource API, and all writes still use versioned workflow or domain-command endpoints.

The seed is additive and idempotent. It creates missing fixture documents and advances only fixtures that are still at the expected earlier state. It does not reset, delete, or overwrite existing documents.

## Seeded Cases

| Return | Starting point | Intended journey |
| --- | --- | --- |
| `RMA-2026-000001` | Draft | Agent runs `acceptReturn` |
| `RMA-2026-000002` | In Transit | Warehouse receives and inspects |
| `RMA-2026-000003` | Received, inspection pending | Warehouse inspection guard and outcome |
| `RMA-2026-000004` | Refund pending approval | Finance guard, amount entry, approval |
| `RMA-2026-000005` | Refund processing | `completeRefundAndResolve` composite command |
| `RMA-2026-000006` | High risk | Ordinary field change triggers durable Automation |

`ORD-1007` and `ORD-1008` are intentionally seeded without Return Requests. Use `CUST-1001` / `ORD-1007` with a maximum amount of `429` for the first public-intake journey, then `CUST-1002` / `ORD-1008` with a maximum amount of `279` for one repeat run.

## Guided Acceptance Journey

Use the profile menu in `/returns` to switch persona between steps.

1. **Returns Agent**: open `RMA-2026-000001`, accept it, add a tracking number, dispatch it, and start case review.
2. **Warehouse Inspector**: open `RMA-2026-000002` or `RMA-2026-000003` and use **Receive and inspect**. One versioned command may receive an in-transit parcel and record the inspection outcome atomically.
3. **Returns Agent**: request refund approval after logistics and inspection satisfy the cross-workflow guard.
4. **Finance Approver**: open `RMA-2026-000004`, enter `139`, and approve/schedule it. The same command also handles a refund that was approved in an earlier session but not yet scheduled.
5. **Finance Approver**: open a Processing refund, enter its settlement reference, and complete it. Confirm Refund is Refunded and Case is Resolved.
6. **Returns Manager**: close the resolved case from the custom action panel.
7. **Demo Administrator**: inspect linked Order/Customer data and `/demo/automation-runs`; a second drain should report zero work.
8. Open **Admin Desk** to inspect the generated dashboard, Kanban, report, Calendar, web form, and print format.
9. Submit the public intake fixture and confirm the linked Order is updated by one delivered Automation Run.

The exact observed acceptance record is maintained in [ReturnsOS Browser Verification](../../docs/returns-example-browser-verification.md).

## Automation Delivery

Every matching source event atomically registers a deterministic `Automation Run` with the source document commit. Successful mutating HTTP requests also send a drain signal to `RETURNS_JOBS`. A once-per-minute scheduled drain recovers pending or retryable runs if an immediate signal is missed.

The consumer claims runs with a lease, records attempts, retries failures, dead-letters exhausted runs, and checks the target event stream for the Automation action id before applying an update. Re-delivery therefore does not duplicate a completed target write.

The local demo exposes two operator-only controls under the **Demo Administrator** persona:

- `/demo/automation-runs` shows the durable run log.
- `Drain pending automation` invokes the same consumer used by the Queue job.

These controls are available only when `RETURNS_DEMO_MODE=true` and the request hostname is `localhost`, `127.0.0.1`, or loopback IPv6.

The public form is deliberately narrower than the resource API. Guest cannot list or read `Customer` or `Order`, and customers never enter a Return ID. An exact POST to `/web-forms/returns/intake` is parsed with a bounded URL-encoded body, validates canonical Customer/Order IDs, allowed reasons, ownership, open-return state, and amount limits, then delegates through a request-scoped internal actor. The framework Naming Engine generates `RMA-{YYYY}-{sequence:6}` and writes both the document name and `return_id` while advancing the named yearly counter in the same atomic commit. Generic JSON and HTML Web Form routes reject caller attempts to supply `return_id`. Attempts to select or spoof the internal actor are also rejected. `Return Request.order` is metadata-unique, so its event-sourced reservation commits atomically with Return creation and only one concurrent intake can claim an Order even before Automation updates `has_open_return`. Invalid submissions receive one generic response so the verifier does not reveal whether a Customer or Order exists.

## Production Boundary

The persona switcher and seed routes are a local test harness, not an authentication mechanism. Disable `RETURNS_DEMO_MODE` outside local development and configure signed-session, Cloudflare Access, or OIDC authentication for a deployed application.

ReturnsOS only demonstrates the Automation action currently supported by cf-frappe: durable `updateDocument`. It does not claim arbitrary outbound messaging, payment-provider calls, or document creation actions.

See:

- [Test personas](../../docs/returns-example-test-accounts.md)
- [Architecture and acceptance](../../docs/returns-example-architecture.md)
- [Independent architecture review](../../docs/returns-example-architecture-review.md)
- [Browser verification](../../docs/returns-example-browser-verification.md)

## 中文说明

ReturnsOS 是 cf-frappe 的完整参考应用，用来展示命名多工作流、复合领域命令和持久化 Automation。一个退货单同时拥有四个互相独立的状态维度：

- `case`：案件主流程；
- `logistics`：逆向物流；
- `inspection`：仓库质检；
- `refund`：退款流程。

### 本地运行

```bash
mise exec node@latest -- npm install
mise exec node@latest -- npm run up
```

第一次执行完 `npm install` 后，以后重启或合盖恢复都只需要运行 `mise exec node@latest -- npm run up`，不需要额外执行 `mise trust`。它会使用最新稳定版 Node.js，应用尚未执行的本地 D1 migration，保留 `.wrangler/state`，并从 `8787` 到 `8797` 自动选择第一个空闲端口；终端会打印准确的 ReturnsOS 和 demo 地址。

打开 [http://localhost:8787/demo](http://localhost:8787/demo)，切换到 **Demo Administrator**，点击 **Seed deterministic demo data**，然后进入 [http://localhost:8787/returns](http://localhost:8787/returns)。

`/returns` 是独立的 ReturnsOS 业务前台，不是 Desk 换皮。它有自己的响应式导航、case pipeline、角色化待办、四条 lifecycle 状态轨和业务操作面板；读写仍然经过 cf-frappe 的权限过滤 API、乐观版本检查、workflow、domain command 和 Automation。`/desk` 保留为元数据后台和高级用户入口。

seed 是幂等、增量且非破坏性的：只创建不存在的固定测试数据，并在文档仍处于预期前置状态时推进流程；不会 reset、delete 或覆盖已有业务数据。

### 建议验收流程

1. 用 **Returns Agent** 在 `/returns` 打开 `RMA-2026-000001`，依次 accept、填写 tracking、dispatch，并开始 case review。
2. 用 **Warehouse Inspector** 对 `RMA-2026-000002` 或 `RMA-2026-000003` 执行 **Receive and inspect**；收货与质检可以在一个复合 command 中原子完成。
3. 用 **Returns Agent** 在物流和质检满足 guard 后请求退款审批。
4. 用 **Finance Approver** 打开 `RMA-2026-000004`，填写 `139` 和排款时间；无论它是 Pending Approval 还是已经 Approved，都能通过同一个 command 进入 Processing。
5. 用 **Finance Approver** 填入 refund reference 并完成退款，再用 **Returns Manager** 关闭已解决 case。
6. 用 **Demo Administrator** 检查关联 Order、Customer 和 Automation Runs，再次 drain 应全部为 0。
7. 进入 Admin Desk 检查 Dashboard、Kanban、Report、Calendar、Web Form 和 Print Format。
8. 在公开 Web Form 提交 `RMA-2026-000007`，再检查 `ORD-1007` 已关联退货单，并且 Automation Run 只执行一次。

### 可靠性边界

Automation Run 和源文档事件在同一次提交里登记。HTTP 写入成功后会发出 Queue drain 信号，每分钟 cron 还会补偿扫描 pending/retryable run。消费者通过 claim lease、attempt、retry、dead letter 和 target event stream 里的 action id 保证可重试且不重复应用成功写入。

本地 persona switcher 不是生产认证。部署时必须关闭 `RETURNS_DEMO_MODE`，并改用 signed session、Cloudflare Access 或 OIDC。

公开入口不会给 Guest 开放 Customer/Order 的 list/get API，也不会让客户填写 Return ID。提交只在精确的 intake 路由中经过限长解析、客户与订单 ID 格式、归属、金额和 open-return 校验，再以不可由外部请求伪造的内部最小权限 actor 调用框架创建流程。框架 Naming Engine 使用 `RMA-{YYYY}-{sequence:6}`，在同一个原子提交里生成文档名、写入 `return_id` 并推进按年重置的 named counter；通用 JSON 与 HTML Web Form 路由都会拒绝客户端注入 `return_id`。`Return Request.order` 使用框架的 event-sourced unique reservation，并与退货单创建原子提交；即使 Automation 还没更新 `has_open_return`，同一订单的并发请求也只能成功一个。校验失败统一返回通用错误，避免泄露主数据是否存在。
