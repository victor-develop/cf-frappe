# ReturnsOS Test Personas

ReturnsOS uses localhost-only test personas. They are not password-backed accounts and do not bypass the framework's authorization checks: each persona resolves to a normal cf-frappe `Actor` with a fixed role set.

No passwords, tokens, or credentials are required or documented.

## Access

1. Start the local application.
2. Open [http://localhost:8787/demo](http://localhost:8787/demo).
3. Select a persona.
4. Follow **Open ReturnsOS app**, or open [http://localhost:8787/returns](http://localhost:8787/returns).

The `/returns` profile menu can switch personas without returning to `/demo`. **Admin Desk** opens the generated cf-frappe backend surfaces for the same actor.

The switcher works only when both conditions hold:

- `RETURNS_DEMO_MODE=true`;
- the request hostname is localhost or a loopback address.

Outside that boundary, the Worker resolves the fallback `Guest` actor and `/demo` returns `404`.

## Personas

| Persona | Actor ID | Roles | Primary journey |
| --- | --- | --- | --- |
| Returns Agent | `returns.agent@demo.local` | `Returns Agent`, `User` | Accept intake, coordinate shipment, request refund approval |
| Warehouse Inspector | `warehouse.inspector@demo.local` | `Warehouse Inspector`, `User` | Receive returned goods and record inspection |
| Finance Approver | `finance.approver@demo.local` | `Finance Approver`, `User` | Enter approved amount, approve, schedule, and complete refund |
| Returns Manager | `returns.manager@demo.local` | All four business roles plus `User` | Review all operational surfaces and close resolved cases |
| Demo Administrator | `admin@demo.local` | `System Manager`, all four business roles, `User` | Seed fixtures, inspect administration and Automation Runs |

## Expected Boundaries

- Returns Agent cannot perform warehouse inspection or finance approval transitions.
- Warehouse Inspector cannot inspect before logistics reaches `Received`.
- Finance Approver cannot approve a refund with zero approved amount and cannot mark it refunded without a reference.
- Direct form/API updates to workflow-owned state fields are rejected for every persona, including a business manager.
- Demo Administrator is intentionally privileged for fixture setup and framework administration.
- Automation Runs are hidden from every non-administrator demo home and custom-app sidebar; `/demo/automation-runs` returns `403` unless the selected persona is Demo Administrator.
- Guest cannot list or read `Customer` or `Order`. Public Web Form submission uses a request-scoped internal `Public Return Intake` role only after bounded relationship and amount verification; it is not a selectable account or persona. The framework Naming Engine generates the Return ID atomically from `RMA-{YYYY}-{sequence:6}`. Client injection of the generated `return_id` field is rejected through the JSON endpoint and both HTML aliases.

## Public Intake Fixture

For one clean acceptance submission, use:

| Field | Value |
| --- | --- |
| Customer | `CUST-1001` |
| Order | `ORD-1007` |
| Reason | Any listed reason |
| Requested Amount | Positive amount no greater than `429` |

`ORD-1007` is seeded without an existing return. The server generates `RMA-2026-000007` after verification. For a repeat run, use `CUST-1002` / `ORD-1008` and an amount no greater than `279`; the server will generate `RMA-1008`. Once both reserved orders have been used, start from a fresh local database or add another reviewed unused-order fixture. A client cannot choose a different RMA ID to reuse an Order that already owns a Return Request.

## 中文说明

这些“测试账号”是 localhost-only persona，不是真实密码账号。进入 `/returns` 后可以从右上角菜单切换 persona。persona 只会把当前请求解析成一组固定的 actor ID 和 roles，后续读写仍然经过 cf-frappe 的 DocType 权限、字段权限、workflow role、domain command 和 condition guard。

文档不会提供密码、token 或任何凭证。生产部署必须关闭 `RETURNS_DEMO_MODE`，并接入正式认证。

Automation Runs 只允许 Demo Administrator 查看。Guest 无法 list/get Customer 或 Order；公开表单只有在限长输入、客户订单归属和金额校验通过后，才会临时使用内部 `Public Return Intake` 最小权限角色。Return ID 由框架 Naming Engine 按 `RMA-{YYYY}-{sequence:6}` 在创建事务中自动生成，JSON API 和两个 HTML alias 都会拒绝客户端注入生成字段。这个内部角色不是测试账号，也不能由 header、cookie 或表单字段选择。
