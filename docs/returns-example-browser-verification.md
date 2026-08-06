# ReturnsOS Browser Verification

This document records browser-level verification of the local ReturnsOS example. It is completed only with observed results from the running Worker; unit-test expectations are not substituted for browser evidence.

## Environment

- Application: `examples/returns/worker.ts`
- URL: `http://localhost:8787`
- Persistence: local Wrangler D1/Durable Object state
- Test harness: `http://localhost:8787/demo`
- Verified: 2026-08-05

## Verification Record

The original deterministic seed completed with:

- 14 documents created;
- 20 workflow transitions applied;
- 18 initial Automation Runs delivered;
- 0 failed and 0 dead-lettered runs.

The security-boundary follow-up first added `ORD-1007` as one additive fixture. Re-running the seed in the existing browser state observed 1 document created, 14 already present, 0 transitions, and 0 pending Automation Runs. The final fixture set also includes unused `ORD-1008` for one repeat intake; the follow-up browser seed observed 1 created and 15 already present. A clean database now receives 16 seed documents.

The following journeys were then executed through the rendered browser UI.

### Standalone ReturnsOS Product UI

The custom application at `/returns` was verified independently from the generated Desk shell.

Observed on the command center:

- a dedicated ReturnsOS navigation and visual language rendered at a 1600 x 1000 desktop viewport;
- the pipeline, role-aware priority queue, lifecycle pulse, persona menu, and responsive metric layout used the full viewport without horizontal overflow;
- the narrow responsive layout collapsed the sidebar, stacked metrics and commands, and kept `scrollWidth` equal to the viewport width;
- server-side search for `4K monitor` returned only `RMA-2026-000006` in both the pipeline and priority table;
- the non-administrator sidebar omitted Automation Runs, while Demo Administrator saw the operator link.

The following actions were submitted from the custom case action panel:

1. **Returns Agent**, `RMA-2026-000001`: saved `UI-TRACK-1001` and dispatched the return. The success page showed Logistics `In Transit`; a second action moved Case to `Processing`.
2. **Warehouse Inspector**, `RMA-2026-000003`: submitted a Passed inspection with a browser-verification note. The success page showed Logistics `Received` and Inspection `Passed`.
3. **Finance Approver**, `RMA-2026-000004`: the fixture had already reached Approved in an earlier Desk journey. The custom command added the schedule and moved Refund to `Processing`, proving the action supports both Pending Approval and Approved starting states.
4. **Finance Approver**, `RMA-2026-000004`: submitted refund reference `UI-REFUND-1004`. One command moved Refund to `Refunded` and Case to `Resolved`.
5. **Returns Manager**, `RMA-2026-000004`: closed the resolved case. The resulting lifecycle rail showed Closed, Received, Partial, and Refunded.
6. **Returns Manager**, `RMA-2026-000005`: closed the previously resolved fixture and observed the same manager-only action boundary.

Every POST included the rendered document version. Success redirects displayed a bounded notice, and the resulting case page reloaded its document, timeline, and assignments through the normal cf-frappe APIs.

The earlier checks below remain as evidence for the generated Desk primitives and raw record views. The standalone UI is now the primary product journey; Desk is the administration and power-user surface.

### Returns Agent

1. Selected `Returns Agent` at `/demo`.
2. Opened `RMA-2026-000001` in Desk.
3. Ran `acceptReturn`.

Observed:

- `case_state`: `Draft` to `Submitted`;
- `logistics_state`: `Not Started` to `Awaiting Shipment`;
- one atomic timeline entry named both `case.submit` and `logistics.prepareShipment`.

### Warehouse Inspector

1. Selected `Warehouse Inspector`.
2. Opened `RMA-2026-000001` before receipt and confirmed that no inspection actions were rendered.
3. Opened `RMA-2026-000002`, where `receive` was available.
4. Ran `receive`, then ran `pass` after the receipt committed.

Observed:

- inspection could not be attempted before `logistics_state = Received`;
- `RMA-2026-000002.logistics_state` became `Received`;
- inspection actions appeared only after receipt;
- `RMA-2026-000002.inspection_state` became `Passed`.

### Finance Approver

1. Selected `Finance Approver`.
2. Opened `RMA-2026-000004` at version 9.
3. Confirmed `refund_state = Pending Approval`, `approved_amount = 0`, `approve` hidden, and `reject` visible.
4. Entered only `Approved Amount = 139` and selected **Save**.
5. Confirmed the save succeeded at version 10 without resubmitting agent, warehouse, workflow-state, or other read-only fields.
6. Confirmed `approve` appeared, then ran it.

Observed:

- all readable but non-updatable text fields were rendered read-only;
- readable but non-updatable select, link, and checkbox fields were disabled and had no submitted field name;
- the amount-only update succeeded and the timeline recorded `approved_amount: 0 -> 139`;
- `refund_state` became `Approved` at version 11.

### Composite Command And Linked Documents

1. As `Finance Approver`, opened `RMA-2026-000005` at version 11.
2. Confirmed `case_state = Processing`, `refund_state = Processing`, and `completeRefundAndResolve` was available.
3. Ran `completeRefundAndResolve`.

Observed on `RMA-2026-000005` version 12:

- `refund_state`: `Processing` to `Refunded`;
- `case_state`: `Processing` to `Resolved`;
- one timeline entry recorded both `refund.markRefunded` and `case.resolve`.

After the Queue consumer drained the resulting Automation Runs:

- `ORD-1005` reached version 8 with `has_open_return = false`, `latest_return_state = Resolved`, `latest_refund_state = Refunded`, and `returned_amount = 699`;
- `CUST-1001` reached version 2 with `latest_return = RMA-2026-000005`, `latest_return_state = Resolved`, and `last_refunded_amount = 699`.

### Durable Idempotency

1. Selected `Demo Administrator`.
2. Opened `/demo/automation-runs`.
3. Confirmed 24 total runs, all `delivered`, all with one attempt, including the Order and Customer actions from `RMA-2026-000005`.
4. Selected **Drain pending automation** again.

Observed:

- claimed: 0;
- delivered: 0;
- failed: 0;
- dead: 0;
- Automation Run total remained 24;
- no additional Order or Customer timeline write was created.

### Ordinary Field Automation

Opened `RMA-2026-000006` as `Demo Administrator`.

Observed:

- `risk_score = 9`;
- `high_risk = true`;
- version 3 timeline contains one `__automation__` update from `false` to `true`.

### Public Intake And Master-Data Boundary

1. Opened `/web-forms/returns/intake` through the rendered public page.
2. Submitted `CUST-1001` / `ORD-1007`, reason `Not as Described`, and requested amount `399` without entering a Return ID.
3. Observed the success page naming the server-generated return `RMA-2026-000007`.
4. Selected `Demo Administrator`, drained again, and observed all four counters at zero because the immediate Queue signal had already delivered the run.
5. Opened `/demo/automation-runs` and observed 25 total runs. The newest row was `delivered`, source `Return Request/RMA-2026-000007`, target `Order/ORD-1007`, attempts `1`.
6. Opened `ORD-1007` in Desk and observed version 2, `has_open_return = true`, `latest_return = RMA-2026-000007`, `latest_return_state = Draft`, plus one `__automation__` timeline update.

Boundary checks observed against the running Worker:

- a Finance Approver home did not render the Automation Runs link;
- `/demo/automation-runs` returned `403` for the Finance Approver persona;
- non-demo-host Guest requests to `/api/resource/Customer` and `/api/resource/Order` both returned `403`;
- the public form remained usable without granting Guest general Customer/Order read access.

The concurrency regression test starts two verified Return creations for the same Order before any Automation consumer runs. Both observe `has_open_return = false`, but the metadata-defined unique reservation on `Return Request.order` commits atomically with document creation: one request succeeds and one receives the generic public failure.

### Naming Engine Follow-Up

On 2026-08-06, the Naming Engine integration was re-verified against the running Worker on `http://localhost:8788` because `8787` was occupied. The persisted local database pre-dated the generated-ID seed migration, so a fresh `ORD-9009` was created through the normal administrator resource command before exercising public intake.

Observed:

- `/web-forms/returns/intake` rendered Customer, Order, Return Reason, Customer Notes, and Requested Amount only; no Return ID input or `return_id` form field existed;
- submitting `CUST-1001` / `ORD-9009` in the browser created `RMA-2026-000001` and displayed that generated document name on the success page;
- `/returns` immediately displayed `RMA-2026-000001` in the Intake pipeline and role-aware queue;
- `/desk/admin/naming?doctype=Return%20Request` displayed the static `RMA-{YYYY}-{sequence:6}` pattern, `returns` counter, `return_id` generated field, yearly reset, and counter `current 1`, version `1`;
- preview returned `RMA-2026-000002` through `RMA-2026-000006`; running preview again left the counter at `current 1`, version `1`;
- the forward-only administration command moved the counter to `current 10`, version `2`, after which preview started at `RMA-2026-000011`.

## Generated Surface Smoke Tests

| Surface | URL | Observed result |
| --- | --- | --- |
| Workspace | `/desk/workspaces/Returns%20Operations` | Operations, Finance, Master Data, and Inbox shortcuts rendered |
| Dashboard | `/desk/dashboards/Returns%20Operations` | 6 open returns, 1 high risk, 1 pending inspection, 1 refund queue, requested total 2184, refunded total 699 |
| Kanban | `/desk/kanbans/Return%20Case%20Board` | Read-only board rendered all five case columns; `RMA-2026-000005` appeared under Resolved |
| Report | `/desk/reports/Returns%20Finance%20Queue` | Clearing the default state filter returned 6 cases, requested total 2184, approved total 838, grouped chart/table, and row data |
| Calendar | `/desk/calendars/Refund%20Schedule` | `RMA-2026-000005` rendered at `2026-08-06T03:00:00.000Z` with Refunded state |
| Web form | `/web-forms/returns/intake` | Public return intake rendered five customer-facing fields and created server-generated `RMA-2026-000007` through the scoped verifier |
| Print format | `/desk/print/Return%20Authorization/RMA-2026-000005` | Return, lifecycle, and resolution sections rendered the final Refunded/Resolved values |

## Reproduction

Use the startup instructions in `examples/returns/README.md` and the personas in `docs/returns-example-test-accounts.md`. Seed once as `Demo Administrator`, then execute the fixture journeys in the order shown above. The seed is additive, so already-advanced fixtures are not reset.
