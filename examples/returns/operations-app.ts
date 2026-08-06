import type { Actor, DocumentData, DocumentSnapshot } from "../../src";
import type { ReturnsDemoTransport } from "./seed";

export interface ReturnsOperationsPersona {
  readonly slug: string;
  readonly label: string;
  readonly actor: Actor;
  readonly journey: string;
}

export interface ReturnsOperationsAppOptions {
  readonly persona: ReturnsOperationsPersona;
  readonly personas: readonly ReturnsOperationsPersona[];
  readonly transport: ReturnsDemoTransport;
}

interface ReturnCaseView {
  readonly document: DocumentSnapshot;
  readonly returnId: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly customerSegment: string;
  readonly orderId: string;
  readonly itemSummary: string;
  readonly reason: string;
  readonly details: string;
  readonly requestedAmount: number;
  readonly approvedAmount: number;
  readonly deductionAmount: number;
  readonly riskScore: number;
  readonly highRisk: boolean;
  readonly caseState: string;
  readonly logisticsState: string;
  readonly inspectionState: string;
  readonly refundState: string;
  readonly trackingNumber: string;
  readonly receivedAt: string;
  readonly inspectionNotes: string;
  readonly scheduledRefundAt: string;
  readonly refundReference: string;
}

interface TimelineEntryView {
  readonly sequence: number;
  readonly summary: string;
  readonly occurredAt: string;
  readonly actorId: string;
}

interface CaseContext {
  readonly item: ReturnCaseView;
  readonly timeline: readonly TimelineEntryView[];
  readonly assignees: readonly string[];
}

interface AppErrorBody {
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
  };
}

const MAX_FORM_BYTES = 8_192;
const RETURN_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const WORKFLOW_ACTIONS = Object.freeze(new Set([
  "case:startProcessing",
  "case:close",
  "refund:requestApproval",
  "refund:reject"
]));
const COMMAND_NAMES = Object.freeze(new Set([
  "acceptReturn",
  "dispatchReturn",
  "inspectReturn",
  "approveAndScheduleRefund",
  "completeRefundAndResolve"
]));

const returnsAgentRoles = Object.freeze(["Returns Agent", "Returns Manager"]);
const warehouseRoles = Object.freeze(["Warehouse Inspector", "Returns Manager"]);
const financeRoles = Object.freeze(["Finance Approver", "Returns Manager"]);
const managerRoles = Object.freeze(["Returns Manager"]);

export async function handleReturnsOperationsRequest(
  request: Request,
  options: ReturnsOperationsAppOptions
): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments[0] !== "returns") {
    return new Response("Not Found", { status: 404 });
  }

  try {
    if (segments.length === 1 && request.method === "GET") {
      return await renderOperationsHome(options, safeSearchQuery(url.searchParams.get("q")));
    }
    if (segments.length === 3 && segments[1] === "cases" && request.method === "GET") {
      const name = safeReturnName(segments[2] ?? "");
      return await renderCasePage(options, name, url.searchParams.get("notice"));
    }
    if (
      segments.length === 5 &&
      segments[1] === "cases" &&
      segments[3] === "command" &&
      request.method === "POST"
    ) {
      const name = safeReturnName(segments[2] ?? "");
      const command = safeIdentifier(segments[4] ?? "", "command");
      return await executeCommandAction(request, options, name, command);
    }
    if (
      segments.length === 7 &&
      segments[1] === "cases" &&
      segments[3] === "workflows" &&
      segments[5] === "transition" &&
      request.method === "POST"
    ) {
      const name = safeReturnName(segments[2] ?? "");
      const workflow = safeIdentifier(segments[4] ?? "", "workflow");
      const action = safeIdentifier(segments[6] ?? "", "workflow action");
      return await executeWorkflowAction(request, options, name, workflow, action);
    }
    return new Response("Not Found", { status: 404 });
  } catch (error) {
    if (error instanceof ReturnsAppError) {
      return appHtmlResponse(renderFailurePage(options, error.message), error.status);
    }
    throw error;
  }
}

async function renderOperationsHome(options: ReturnsOperationsAppOptions, searchQuery: string): Promise<Response> {
  const [returnDocuments, orderDocuments, customerDocuments] = await Promise.all([
    listSnapshots(options.transport, "/api/resource/Return%20Request?limit=50&order_by=return_id&order=asc"),
    listSnapshots(options.transport, "/api/resource/Order?limit=50&order_by=order_id&order=asc"),
    listSnapshots(options.transport, "/api/resource/Customer?limit=50&order_by=customer_id&order=asc")
  ]);
  const cases = buildCaseViews(returnDocuments, orderDocuments, customerDocuments);
  return appHtmlResponse(renderHome(options, cases, searchQuery));
}

async function renderCasePage(
  options: ReturnsOperationsAppOptions,
  name: string,
  notice: string | null,
  errorMessage?: string,
  status = 200
): Promise<Response> {
  const context = await loadCaseContext(options.transport, name);
  return appHtmlResponse(renderCase(options, context, safeNotice(notice), errorMessage), status);
}

async function executeCommandAction(
  request: Request,
  options: ReturnsOperationsAppOptions,
  name: string,
  command: string
): Promise<Response> {
  if (!COMMAND_NAMES.has(command)) {
    throw new ReturnsAppError(404, `Unknown ReturnsOS command '${command}'`);
  }
  const form = await readBoundedForm(request);
  const expectedVersion = expectedVersionFromForm(form);
  const input = commandInput(command, form);
  const response = await options.transport.request(
    `/api/resource/Return%20Request/${encodeURIComponent(name)}/command/${encodeURIComponent(command)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, expectedVersion })
    }
  );
  if (!response.ok) {
    return await renderCasePage(options, name, null, await responseErrorMessage(response), response.status);
  }
  return redirectToCase(name, commandNotice(command));
}

async function executeWorkflowAction(
  request: Request,
  options: ReturnsOperationsAppOptions,
  name: string,
  workflow: string,
  action: string
): Promise<Response> {
  if (!WORKFLOW_ACTIONS.has(`${workflow}:${action}`)) {
    throw new ReturnsAppError(404, `Unknown ReturnsOS workflow action '${workflow}.${action}'`);
  }
  const form = await readBoundedForm(request);
  const expectedVersion = expectedVersionFromForm(form);
  const response = await options.transport.request(
    `/api/resource/Return%20Request/${encodeURIComponent(name)}/workflows/${encodeURIComponent(workflow)}/transition/${encodeURIComponent(action)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion })
    }
  );
  if (!response.ok) {
    return await renderCasePage(options, name, null, await responseErrorMessage(response), response.status);
  }
  return redirectToCase(name, workflowNotice(workflow, action));
}

async function loadCaseContext(transport: ReturnsDemoTransport, name: string): Promise<CaseContext> {
  const encoded = encodeURIComponent(name);
  const [document, orders, customers, timeline, assignments] = await Promise.all([
    getSnapshot(transport, `/api/resource/Return%20Request/${encoded}`),
    listSnapshots(transport, "/api/resource/Order?limit=50&order_by=order_id&order=asc"),
    listSnapshots(transport, "/api/resource/Customer?limit=50&order_by=customer_id&order=asc"),
    getTimeline(transport, `/api/resource/Return%20Request/${encoded}/timeline?limit=12`),
    getAssignments(transport, `/api/resource/Return%20Request/${encoded}/assignments`)
  ]);
  return Object.freeze({
    item: buildCaseViews([document], orders, customers)[0]!,
    timeline,
    assignees: assignments
  });
}

function renderHome(
  options: ReturnsOperationsAppOptions,
  allCases: readonly ReturnCaseView[],
  searchQuery: string
): string {
  const cases = searchQuery.length === 0
    ? allCases
    : allCases.filter((item) => matchesSearch(item, searchQuery));
  const openCases = cases.filter((item) => item.caseState !== "Closed");
  const highRiskCases = cases.filter((item) => item.highRisk);
  const warehouseQueue = cases.filter((item) =>
    item.logisticsState === "In Transit" ||
    (item.logisticsState === "Received" && item.inspectionState === "Pending")
  );
  const refundQueue = cases.filter((item) =>
    ["Pending Approval", "Approved", "Processing"].includes(item.refundState)
  );
  const refundExposure = refundQueue.reduce((total, item) => total + item.requestedAmount, 0);
  const priority = [...cases].sort(comparePriority).slice(0, 6);
  const lanes = [
    { state: "Draft", label: "Intake", tone: "violet" },
    { state: "Submitted", label: "Accepted", tone: "cyan" },
    { state: "Processing", label: "In progress", tone: "amber" },
    { state: "Resolved", label: "Resolved", tone: "green" }
  ] as const;

  const body = `
    <section class="page-heading" aria-labelledby="page-title">
      <div>
        <p class="eyebrow">${searchQuery.length === 0 ? "Wednesday, August 5" : "Search results"}</p>
        <h1 id="page-title">${searchQuery.length === 0 ? "Return command center" : `Cases matching &quot;${escapeHtml(searchQuery)}&quot;`}</h1>
        <p>${searchQuery.length === 0 ? "One queue across intake, reverse logistics, inspection, and refunds." : `${String(cases.length)} matching return cases across customer, order, item, reason, and state.`}</p>
      </div>
      <div class="heading-actions">
        <a class="button secondary" href="/desk/workspaces/Returns%20Operations">${icon("settings")}<span>Admin Desk</span></a>
        <a class="button primary" href="/web-forms/returns/intake">${icon("plus")}<span>New return</span></a>
      </div>
    </section>

    <section class="metric-grid" aria-label="Operations summary">
      ${metricCard("Open returns", openCases.length, "Across all active lifecycles", "inbox", "lime")}
      ${metricCard("Needs attention", highRiskCases.length + warehouseQueue.length, `${String(highRiskCases.length)} high risk, ${String(warehouseQueue.length)} warehouse`, "alert", "coral")}
      ${metricCard("Refund queue", refundQueue.length, currency(refundExposure) + " exposure", "wallet", "cyan")}
      ${metricCard("Resolved", cases.filter((item) => item.caseState === "Resolved" || item.caseState === "Closed").length, "Ready for closure or complete", "check", "violet")}
    </section>

    <section class="section-heading" id="pipeline">
      <div><p class="eyebrow">Live operations</p><h2>Case pipeline</h2></div>
      <p>${String(openCases.length)} open cases</p>
    </section>
    <section class="pipeline" aria-label="Return case pipeline">
      ${lanes.map((lane) => renderLane(lane.label, lane.tone, cases.filter((item) => item.caseState === lane.state))).join("")}
    </section>

    <section class="content-split">
      <div>
        <section class="section-heading" id="priority">
          <div><p class="eyebrow">Role-aware queue</p><h2>What needs your attention</h2></div>
          <p>${escapeHtml(options.persona.label)}</p>
        </section>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Return</th><th>Customer</th><th>Current signal</th><th>Amount</th><th><span class="sr-only">Open</span></th></tr></thead>
            <tbody>${priority.map((item) => priorityRow(item, options.persona)).join("")}</tbody>
          </table>
        </div>
      </div>
      <aside class="pulse-panel" id="health">
        <div class="pulse-heading">${icon("pulse")}<span>Lifecycle pulse</span></div>
        <p>Each case keeps four independent state machines. This view composes them into one operational signal.</p>
        ${pulseRow("Intake", cases.filter((item) => item.caseState === "Draft").length, cases.length, "violet")}
        ${pulseRow("In logistics", cases.filter((item) => ["Awaiting Shipment", "In Transit"].includes(item.logisticsState)).length, cases.length, "cyan")}
        ${pulseRow("Inspection", warehouseQueue.length, cases.length, "amber")}
        ${pulseRow("Refunds", refundQueue.length, cases.length, "lime")}
        <div class="reliability-note">
          ${icon("shield")}
          <div><strong>Framework-governed</strong><span>Actions below still pass permission, workflow guard, optimistic version, event, and automation policies.</span></div>
        </div>
      </aside>
    </section>`;

  return appLayout("ReturnsOS Command Center", options, "overview", body, searchQuery);
}

function renderCase(
  options: ReturnsOperationsAppOptions,
  context: CaseContext,
  notice: string | undefined,
  errorMessage?: string
): string {
  const item = context.item;
  const body = `
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/returns">Command center</a><span>/</span><span>${escapeHtml(item.returnId)}</span></nav>
    ${notice ? `<div class="flash success" role="status">${icon("check")}<span>${escapeHtml(notice)}</span></div>` : ""}
    ${errorMessage ? `<div class="flash error" role="alert">${icon("alert")}<span>${escapeHtml(errorMessage)}</span></div>` : ""}
    <section class="case-heading">
      <div>
        <div class="case-kicker"><span class="status-dot ${item.highRisk ? "coral" : "lime"}"></span>${item.highRisk ? "High-risk review" : "Active return"}</div>
        <h1>${escapeHtml(item.returnId)}</h1>
        <p>${escapeHtml(item.itemSummary)} <span class="muted-separator">/</span> ${escapeHtml(item.reason)}</p>
      </div>
      <div class="case-heading-side">
        <span class="amount-label">Requested amount</span>
        <strong>${currency(item.requestedAmount)}</strong>
        <a href="/desk/Return%20Request/${encodeURIComponent(item.returnId)}">Open record in Desk ${icon("arrow")}</a>
      </div>
    </section>

    <section class="lifecycle-grid" aria-label="Independent lifecycles">
      ${lifecycleCard("Case", item.caseState, ["Draft", "Submitted", "Processing", "Resolved", "Closed"], "violet", "case")}
      ${lifecycleCard("Logistics", item.logisticsState, ["Not Started", "Awaiting Shipment", "In Transit", "Received"], "cyan", "truck")}
      ${lifecycleCard("Inspection", item.inspectionState, ["Pending", "Passed"], "amber", "inspect")}
      ${lifecycleCard("Refund", item.refundState, ["Not Eligible", "Pending Approval", "Approved", "Processing", "Refunded"], "lime", "wallet")}
    </section>

    <section class="case-layout">
      <div class="case-main">
        <section class="detail-section">
          <div class="section-heading"><div><p class="eyebrow">Case context</p><h2>Customer and order</h2></div><span class="segment-badge">${escapeHtml(item.customerSegment)}</span></div>
          <dl class="detail-grid">
            ${detail("Customer", `${item.customerName} (${item.customerId})`)}
            ${detail("Order", item.orderId)}
            ${detail("Item", item.itemSummary)}
            ${detail("Submitted by", stringField(item.document.data, "submitted_by", "Unknown"))}
          </dl>
          <div class="customer-note"><span>Customer note</span><p>${escapeHtml(item.details || "No additional customer note.")}</p></div>
        </section>

        <section class="detail-section">
          <div class="section-heading"><div><p class="eyebrow">Operational detail</p><h2>Physical and financial trail</h2></div></div>
          <dl class="detail-grid">
            ${detail("Tracking", item.trackingNumber || "Not assigned")}
            ${detail("Received", formatDateTime(item.receivedAt))}
            ${detail("Approved", currency(item.approvedAmount))}
            ${detail("Deduction", currency(item.deductionAmount))}
            ${detail("Refund scheduled", formatDateTime(item.scheduledRefundAt))}
            ${detail("Refund reference", item.refundReference || "Not issued")}
          </dl>
          <div class="customer-note"><span>Inspection note</span><p>${escapeHtml(item.inspectionNotes || "No warehouse inspection note yet.")}</p></div>
        </section>

        <section class="detail-section">
          <div class="section-heading"><div><p class="eyebrow">Immutable activity</p><h2>Event timeline</h2></div><p>Version ${String(item.document.version)}</p></div>
          <ol class="timeline">${renderTimeline(context.timeline)}</ol>
        </section>
      </div>

      <aside class="action-panel">
        <div class="action-panel-heading"><p class="eyebrow">Next best action</p><h2>${escapeHtml(options.persona.label)} workspace</h2></div>
        ${renderActions(item, options.persona)}
        <div class="assignment-block">
          <span>Assigned team</span>
          ${context.assignees.length > 0
            ? context.assignees.map((assignee) => `<div class="assignee"><span class="avatar small">${escapeHtml(initials(assignee))}</span><strong>${escapeHtml(assignee)}</strong></div>`).join("")
            : `<p>No active assignment.</p>`}
        </div>
        <div class="policy-block">${icon("shield")}<p>Every action uses the same cf-frappe command boundary as Desk. Hidden buttons are convenience, not authorization.</p></div>
      </aside>
    </section>`;

  return appLayout(`${item.returnId} - ReturnsOS`, options, "queue", body);
}

function renderActions(item: ReturnCaseView, persona: ReturnsOperationsPersona): string {
  const actions: string[] = [];
  const version = item.document.version;
  if (item.caseState === "Draft" && hasAnyRole(persona, returnsAgentRoles)) {
    actions.push(actionForm(item.returnId, "command/acceptReturn", version, "Accept return", "Creates one atomic command across case and logistics state.", "primary"));
  }
  if (item.caseState === "Submitted" && hasAnyRole(persona, returnsAgentRoles)) {
    actions.push(actionForm(item.returnId, "workflows/case/transition/startProcessing", version, "Start case review", "Moves only the case lifecycle into processing.", "secondary"));
  }
  if (item.logisticsState === "Awaiting Shipment" && hasAnyRole(persona, returnsAgentRoles)) {
    actions.push(`<form class="action-card" method="post" action="/returns/cases/${encodeURIComponent(item.returnId)}/command/dispatchReturn">
      ${versionInput(version)}
      <div><strong>Dispatch return</strong><p>Record a carrier reference and move logistics into transit atomically.</p></div>
      <label>Tracking number<input name="tracking_number" required maxlength="80" pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,79}" value="${escapeHtml(item.trackingNumber)}"></label>
      <button class="button primary" type="submit">${icon("truck")}<span>Save and dispatch</span></button>
    </form>`);
  }
  if (
    item.inspectionState === "Pending" &&
    ["In Transit", "Received"].includes(item.logisticsState) &&
    hasAnyRole(persona, warehouseRoles)
  ) {
    actions.push(`<form class="action-card" method="post" action="/returns/cases/${encodeURIComponent(item.returnId)}/command/inspectReturn">
      ${versionInput(version)}
      <div><strong>Receive and inspect</strong><p>One command can receive the parcel and record the inspection outcome.</p></div>
      <label>Outcome<select name="outcome" required><option value="Passed">Pass</option><option value="Partial">Partial</option><option value="Failed">Fail</option></select></label>
      <label>Inspection note<textarea name="inspection_notes" maxlength="500" rows="3">${escapeHtml(item.inspectionNotes)}</textarea></label>
      <label>Deduction amount<input name="deduction_amount" type="number" min="0" max="1000000" step="0.01" value="${String(item.deductionAmount)}"></label>
      <button class="button primary" type="submit">${icon("inspect")}<span>Complete inspection</span></button>
    </form>`);
  }
  if (
    item.refundState === "Not Eligible" &&
    item.logisticsState === "Received" &&
    ["Passed", "Partial"].includes(item.inspectionState) &&
    hasAnyRole(persona, returnsAgentRoles)
  ) {
    actions.push(actionForm(item.returnId, "workflows/refund/transition/requestApproval", version, "Request refund approval", "Hands the case to finance and triggers assignment automation.", "primary"));
  }
  if (["Pending Approval", "Approved"].includes(item.refundState) && hasAnyRole(persona, financeRoles)) {
    const needsApproval = item.refundState === "Pending Approval";
    actions.push(`<form class="action-card" method="post" action="/returns/cases/${encodeURIComponent(item.returnId)}/command/approveAndScheduleRefund">
      ${versionInput(version)}
      <div><strong>${needsApproval ? "Approve and schedule" : "Schedule approved refund"}</strong><p>${needsApproval ? "Validates the amount, approves the refund, and starts processing in one event." : "Adds the processing time and advances the already-approved refund."}</p></div>
      <label>Approved amount<input name="approved_amount" type="number" min="0.01" max="${String(item.requestedAmount)}" step="0.01" required value="${String(item.approvedAmount > 0 ? item.approvedAmount : item.requestedAmount - item.deductionAmount)}"></label>
      <label>Process at<input name="scheduled_refund_at" type="datetime-local" required value="2026-08-06T11:00"></label>
      <button class="button primary" type="submit">${icon("wallet")}<span>${needsApproval ? "Approve refund" : "Start processing"}</span></button>
    </form>`);
    if (needsApproval) {
      actions.push(actionForm(item.returnId, "workflows/refund/transition/reject", version, "Reject refund", "Closes the refund lifecycle without issuing payment.", "danger"));
    }
  }
  if (item.refundState === "Processing" && hasAnyRole(persona, financeRoles)) {
    actions.push(`<form class="action-card" method="post" action="/returns/cases/${encodeURIComponent(item.returnId)}/command/completeRefundAndResolve">
      ${versionInput(version)}
      <div><strong>Complete refund</strong><p>Records settlement, resolves the case, and reliably syncs customer and order projections.</p></div>
      <label>Refund reference<input name="refund_reference" required maxlength="80" pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,79}" value="${escapeHtml(item.refundReference)}"></label>
      <button class="button primary" type="submit">${icon("check")}<span>Mark refunded</span></button>
    </form>`);
  }
  if (item.caseState === "Resolved" && hasAnyRole(persona, managerRoles)) {
    actions.push(actionForm(item.returnId, "workflows/case/transition/close", version, "Close case", "Final manager-only lifecycle transition.", "primary"));
  }
  if (actions.length === 0) {
    return `<div class="empty-action">${icon("clock")}<strong>No action for this role</strong><p>The case is waiting on another lifecycle or team. Switch persona to continue the demo journey.</p></div>`;
  }
  return actions.join("");
}

function actionForm(
  returnId: string,
  actionPath: string,
  version: number,
  label: string,
  description: string,
  tone: "primary" | "secondary" | "danger"
): string {
  return `<form class="action-card compact" method="post" action="/returns/cases/${encodeURIComponent(returnId)}/${actionPath}">
    ${versionInput(version)}
    <div><strong>${escapeHtml(label)}</strong><p>${escapeHtml(description)}</p></div>
    <button class="button ${tone}" type="submit"><span>${escapeHtml(label)}</span>${icon("arrow")}</button>
  </form>`;
}

function renderLane(label: string, tone: string, items: readonly ReturnCaseView[]): string {
  return `<section class="lane">
    <header><span class="lane-marker ${tone}"></span><h3>${escapeHtml(label)}</h3><span>${String(items.length)}</span></header>
    <div class="lane-items">${items.length > 0
      ? items.map(renderCaseCard).join("")
      : `<div class="lane-empty">No cases</div>`}</div>
  </section>`;
}

function renderCaseCard(item: ReturnCaseView): string {
  return `<a class="case-card" href="/returns/cases/${encodeURIComponent(item.returnId)}">
    <div class="case-card-top"><strong>${escapeHtml(item.returnId)}</strong>${item.highRisk ? `<span class="risk-badge">High risk</span>` : ""}</div>
    <p>${escapeHtml(item.itemSummary)}</p>
    <div class="case-card-meta"><span>${escapeHtml(item.customerName)}</span><strong>${currency(item.requestedAmount)}</strong></div>
    <div class="state-strip" aria-label="${escapeHtml(lifecycleSummary(item))}">
      <span class="violet"></span><span class="cyan"></span><span class="amber"></span><span class="lime"></span>
    </div>
  </a>`;
}

function priorityRow(item: ReturnCaseView, persona: ReturnsOperationsPersona): string {
  const signal = nextSignal(item, persona);
  return `<tr>
    <td><a href="/returns/cases/${encodeURIComponent(item.returnId)}"><strong>${escapeHtml(item.returnId)}</strong><span>${escapeHtml(item.itemSummary)}</span></a></td>
    <td><strong>${escapeHtml(item.customerName)}</strong><span>${escapeHtml(item.customerSegment)}</span></td>
    <td><span class="signal ${signal.tone}">${escapeHtml(signal.label)}</span></td>
    <td class="number">${currency(item.requestedAmount)}</td>
    <td><a class="icon-link" aria-label="Open ${escapeHtml(item.returnId)}" href="/returns/cases/${encodeURIComponent(item.returnId)}">${icon("arrow")}</a></td>
  </tr>`;
}

function nextSignal(item: ReturnCaseView, persona: ReturnsOperationsPersona): { readonly label: string; readonly tone: string } {
  if (item.highRisk) return { label: "Risk review", tone: "coral" };
  if (item.caseState === "Draft" && hasAnyRole(persona, returnsAgentRoles)) return { label: "Accept intake", tone: "violet" };
  if (item.logisticsState === "Awaiting Shipment" && hasAnyRole(persona, returnsAgentRoles)) return { label: "Dispatch", tone: "cyan" };
  if (["In Transit", "Received"].includes(item.logisticsState) && item.inspectionState === "Pending" && hasAnyRole(persona, warehouseRoles)) return { label: "Inspect item", tone: "amber" };
  if (item.refundState === "Pending Approval" && hasAnyRole(persona, financeRoles)) return { label: "Approve refund", tone: "lime" };
  if (item.refundState === "Processing" && hasAnyRole(persona, financeRoles)) return { label: "Confirm payment", tone: "lime" };
  return { label: item.refundState, tone: "neutral" };
}

function lifecycleCard(
  label: string,
  state: string,
  states: readonly string[],
  tone: string,
  iconName: IconName
): string {
  const index = Math.max(0, states.indexOf(state));
  const progress = states.length <= 1 ? 100 : Math.round((index / (states.length - 1)) * 100);
  return `<article class="lifecycle-card">
    <div class="lifecycle-icon ${tone}">${icon(iconName)}</div>
    <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(state)}</strong></div>
    <div class="progress"><span class="${tone}" style="width:${String(progress)}%"></span></div>
  </article>`;
}

function renderTimeline(entries: readonly TimelineEntryView[]): string {
  if (entries.length === 0) {
    return `<li class="timeline-empty">No activity has been recorded.</li>`;
  }
  return [...entries].reverse().slice(0, 8).map((entry) => `<li>
    <span class="timeline-dot"></span>
    <div><strong>${escapeHtml(entry.summary)}</strong><span>${escapeHtml(entry.actorId || "System")} / ${escapeHtml(formatDateTime(entry.occurredAt))}</span></div>
    <code>#${String(entry.sequence)}</code>
  </li>`).join("");
}

function metricCard(label: string, value: number, detailText: string, iconName: IconName, tone: string): string {
  return `<article class="metric-card ${tone}">
    <div class="metric-icon">${icon(iconName)}</div>
    <div><span>${escapeHtml(label)}</span><strong>${String(value)}</strong><p>${escapeHtml(detailText)}</p></div>
  </article>`;
}

function pulseRow(label: string, value: number, total: number, tone: string): string {
  const width = total === 0 ? 0 : Math.max(5, Math.round((value / total) * 100));
  return `<div class="pulse-row"><div><span>${escapeHtml(label)}</span><strong>${String(value)}</strong></div><div class="pulse-track"><span class="${tone}" style="width:${String(width)}%"></span></div></div>`;
}

function detail(label: string, value: string): string {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function appLayout(
  title: string,
  options: ReturnsOperationsAppOptions,
  active: "overview" | "queue",
  body: string,
  searchQuery = ""
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title><style>${appStyles()}</style></head><body>
  <a class="skip-link" href="#main-content">Skip to content</a>
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="/returns"><span class="brand-mark"><i></i><i></i><i></i></span><span>Returns<strong>OS</strong></span></a>
      <nav class="primary-nav" aria-label="Primary navigation">
        ${navItem("overview", "Overview", "/returns", active === "overview")}
        ${navItem("queue", "Priority queue", "/returns#priority", active === "queue")}
        ${navItem("alert", "Risk review", "/returns#priority", false)}
        ${navItem("pulse", "Lifecycle health", "/returns#health", false)}
      </nav>
      <div class="sidebar-section"><span>Framework</span>
        ${navItem("settings", "Admin Desk", "/desk/workspaces/Returns%20Operations", false)}
        ${options.persona.slug === "admin" ? navItem("automation", "Automation runs", "/demo/automation-runs", false) : ""}
      </div>
      <div class="sidebar-foot"><span class="live-dot"></span><div><strong>Local showcase</strong><span>cf-frappe powered</span></div></div>
    </aside>
    <div class="app-column">
      <header class="topbar">
        <a class="mobile-brand" href="/returns"><span class="brand-mark"><i></i><i></i><i></i></span><span>ReturnsOS</span></a>
        <form class="global-search" action="/returns" method="get">
          <label class="sr-only" for="global-search-input">Search returns, customers, and orders</label>
          <input id="global-search-input" name="q" maxlength="64" value="${escapeHtml(searchQuery)}" placeholder="Search returns, customers, orders">
          <button type="submit" aria-label="Search">${icon("search")}</button>
        </form>
        <details class="persona-menu">
          <summary><span class="avatar">${escapeHtml(initials(options.persona.label))}</span><span><strong>${escapeHtml(options.persona.label)}</strong><small>${escapeHtml(options.persona.actor.id)}</small></span>${icon("chevron")}</summary>
          <div class="persona-popover">
            <span>Switch demo persona</span>
            ${options.personas.map((persona) => `<form method="post" action="/returns/persona/${encodeURIComponent(persona.slug)}"><button type="submit"${persona.slug === options.persona.slug ? " disabled" : ""}><strong>${escapeHtml(persona.label)}</strong><small>${escapeHtml(persona.journey)}</small></button></form>`).join("")}
          </div>
        </details>
      </header>
      <main id="main-content">${body}</main>
    </div>
  </div></body></html>`;
}

function navItem(iconName: IconName, label: string, href: string, active: boolean): string {
  return `<a href="${href}"${active ? ' aria-current="page" class="active"' : ""}>${icon(iconName)}<span>${escapeHtml(label)}</span></a>`;
}

function renderFailurePage(options: ReturnsOperationsAppOptions, message: string): string {
  return appLayout("ReturnsOS Error", options, "overview", `<section class="failure"><div>${icon("alert")}</div><h1>Could not open this view</h1><p>${escapeHtml(message)}</p><a class="button primary" href="/returns">Back to command center</a></section>`);
}

function buildCaseViews(
  returnDocuments: readonly DocumentSnapshot[],
  orderDocuments: readonly DocumentSnapshot[],
  customerDocuments: readonly DocumentSnapshot[]
): readonly ReturnCaseView[] {
  const orders = new Map(orderDocuments.map((document) => [document.name, document]));
  const customers = new Map(customerDocuments.map((document) => [document.name, document]));
  return returnDocuments.map((document) => {
    const customerId = stringField(document.data, "customer", "Unknown customer");
    const orderId = stringField(document.data, "order", "Unknown order");
    const customer = customers.get(customerId);
    const order = orders.get(orderId);
    return Object.freeze({
      document,
      returnId: stringField(document.data, "return_id", document.name),
      customerId,
      customerName: customer ? stringField(customer.data, "display_name", customerId) : customerId,
      customerSegment: customer ? stringField(customer.data, "segment", "Standard") : "Standard",
      orderId,
      itemSummary: order ? stringField(order.data, "item_summary", orderId) : orderId,
      reason: stringField(document.data, "reason", "Other"),
      details: stringField(document.data, "details", ""),
      requestedAmount: numberField(document.data, "requested_amount"),
      approvedAmount: numberField(document.data, "approved_amount"),
      deductionAmount: numberField(document.data, "deduction_amount"),
      riskScore: numberField(document.data, "risk_score"),
      highRisk: booleanField(document.data, "high_risk"),
      caseState: stringField(document.data, "case_state", "Draft"),
      logisticsState: stringField(document.data, "logistics_state", "Not Started"),
      inspectionState: stringField(document.data, "inspection_state", "Pending"),
      refundState: stringField(document.data, "refund_state", "Not Eligible"),
      trackingNumber: stringField(document.data, "tracking_number", ""),
      receivedAt: stringField(document.data, "received_at", ""),
      inspectionNotes: stringField(document.data, "inspection_notes", ""),
      scheduledRefundAt: stringField(document.data, "scheduled_refund_at", ""),
      refundReference: stringField(document.data, "refund_reference", "")
    });
  });
}

async function listSnapshots(transport: ReturnsDemoTransport, path: string): Promise<readonly DocumentSnapshot[]> {
  const response = await transport.request(path);
  const body = await readJsonBody(response);
  if (!response.ok) throw requestFailure(response.status, body);
  if (!Array.isArray(body.data) || !body.data.every(isDocumentSnapshot)) {
    throw new ReturnsAppError(502, "Framework list API returned an invalid document collection");
  }
  return body.data;
}

async function getSnapshot(transport: ReturnsDemoTransport, path: string): Promise<DocumentSnapshot> {
  const response = await transport.request(path);
  const body = await readJsonBody(response);
  if (!response.ok) throw requestFailure(response.status, body);
  if (!isDocumentSnapshot(body.data)) {
    throw new ReturnsAppError(502, "Framework resource API returned an invalid document");
  }
  return body.data;
}

async function getTimeline(transport: ReturnsDemoTransport, path: string): Promise<readonly TimelineEntryView[]> {
  const response = await transport.request(path);
  const body = await readJsonBody(response);
  if (!response.ok) throw requestFailure(response.status, body);
  if (!isRecord(body.data) || !Array.isArray(body.data.entries)) return [];
  return body.data.entries.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.sequence !== "number" || typeof entry.summary !== "string") return [];
    return [Object.freeze({
      sequence: entry.sequence,
      summary: entry.summary,
      occurredAt: typeof entry.occurredAt === "string" ? entry.occurredAt : "",
      actorId: typeof entry.actorId === "string" ? entry.actorId : ""
    })];
  });
}

async function getAssignments(transport: ReturnsDemoTransport, path: string): Promise<readonly string[]> {
  const response = await transport.request(path);
  const body = await readJsonBody(response);
  if (!response.ok) throw requestFailure(response.status, body);
  if (!isRecord(body.data) || !Array.isArray(body.data.assignees)) return [];
  return body.data.assignees.filter((value): value is string => typeof value === "string");
}

async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json() as unknown;
  if (!isRecord(value)) throw new ReturnsAppError(502, "Framework API returned an invalid JSON object");
  return value;
}

function requestFailure(status: number, body: Record<string, unknown>): ReturnsAppError {
  const error = body as AppErrorBody;
  const message = typeof error.error?.message === "string" ? error.error.message : `Framework request failed with ${String(status)}`;
  return new ReturnsAppError(status, message);
}

async function responseErrorMessage(response: Response): Promise<string> {
  try {
    const body = await readJsonBody(response);
    return requestFailure(response.status, body).message;
  } catch {
    return `Action failed with status ${String(response.status)}`;
  }
}

async function readBoundedForm(request: Request): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded") && !contentType.includes("multipart/form-data")) {
    throw new ReturnsAppError(415, "ReturnsOS actions require a form submission");
  }
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader !== null) {
    const length = Number(lengthHeader);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_FORM_BYTES) {
      throw new ReturnsAppError(413, "ReturnsOS action form is too large");
    }
  }

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  if (reader !== undefined) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_FORM_BYTES) {
          await reader.cancel();
          throw new ReturnsAppError(413, "ReturnsOS action form is too large");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  const body = new Uint8Array(new ArrayBuffer(totalBytes));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return await new Request("http://localhost/returns/action", {
    method: "POST",
    headers: { "content-type": contentType },
    body
  }).formData();
}

function commandInput(command: string, form: FormData): DocumentData {
  if (command === "acceptReturn") return {};
  if (command === "dispatchReturn") {
    return { tracking_number: requiredReference(form, "tracking_number", "Tracking number") };
  }
  if (command === "inspectReturn") {
    const outcome = requiredChoice(form, "outcome", ["Passed", "Partial", "Failed"]);
    return {
      outcome,
      inspection_notes: optionalText(form, "inspection_notes", 500),
      deduction_amount: optionalMoney(form, "deduction_amount")
    };
  }
  if (command === "approveAndScheduleRefund") {
    return {
      approved_amount: requiredMoney(form, "approved_amount"),
      scheduled_refund_at: requiredDateTime(form, "scheduled_refund_at")
    };
  }
  if (command === "completeRefundAndResolve") {
    return { refund_reference: requiredReference(form, "refund_reference", "Refund reference") };
  }
  throw new ReturnsAppError(404, `Unknown ReturnsOS command '${command}'`);
}

function expectedVersionFromForm(form: FormData): number {
  const raw = form.get("expected_version");
  if (typeof raw !== "string" || !/^\d{1,10}$/.test(raw)) {
    throw new ReturnsAppError(400, "Expected document version is required");
  }
  const version = Number(raw);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ReturnsAppError(400, "Expected document version is invalid");
  }
  return version;
}

function requiredReference(form: FormData, field: string, label: string): string {
  const value = requiredText(form, field, 80);
  if (!REFERENCE_PATTERN.test(value)) throw new ReturnsAppError(400, `${label} contains unsupported characters`);
  return value;
}

function requiredChoice(form: FormData, field: string, choices: readonly string[]): string {
  const value = requiredText(form, field, 32);
  if (!choices.includes(value)) throw new ReturnsAppError(400, `${field} is invalid`);
  return value;
}

function requiredMoney(form: FormData, field: string): number {
  const value = moneyValue(form, field);
  if (value <= 0) throw new ReturnsAppError(400, `${field} must be greater than zero`);
  return value;
}

function optionalMoney(form: FormData, field: string): number {
  const raw = form.get(field);
  if (raw === null || raw === "") return 0;
  return moneyValue(form, field);
}

function moneyValue(form: FormData, field: string): number {
  const raw = form.get(field);
  if (typeof raw !== "string" || !/^\d{1,7}(?:\.\d{1,2})?$/.test(raw)) {
    throw new ReturnsAppError(400, `${field} must be a valid amount`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new ReturnsAppError(400, `${field} is outside the supported range`);
  }
  return value;
}

function requiredDateTime(form: FormData, field: string): string {
  const value = requiredText(form, field, 40);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (match === null) throw new ReturnsAppError(400, `${field} must be a valid date and time`);

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    year < 1000
    || parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
    || parsed.getUTCHours() !== hour
    || parsed.getUTCMinutes() !== minute
  ) {
    throw new ReturnsAppError(400, `${field} must be a valid date and time`);
  }
  return parsed.toISOString();
}

function requiredText(form: FormData, field: string, maxLength: number): string {
  const value = form.get(field);
  if (typeof value !== "string") throw new ReturnsAppError(400, `${field} is required`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new ReturnsAppError(400, `${field} must contain between 1 and ${String(maxLength)} characters`);
  }
  return normalized;
}

function optionalText(form: FormData, field: string, maxLength: number): string {
  const value = form.get(field);
  if (value === null) return "";
  if (typeof value !== "string") throw new ReturnsAppError(400, `${field} is invalid`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new ReturnsAppError(400, `${field} is too long`);
  return normalized;
}

function safeReturnName(segment: string): string {
  const value = safeDecodeSegment(segment, "return name");
  if (!RETURN_NAME_PATTERN.test(value) || value === "." || value === ".." || value.includes("\\")) {
    throw new ReturnsAppError(400, "Return name is invalid");
  }
  return value;
}

function safeIdentifier(segment: string, label: string): string {
  const value = safeDecodeSegment(segment, label);
  if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value)) throw new ReturnsAppError(400, `${label} is invalid`);
  return value;
}

function safeDecodeSegment(segment: string, label: string): string {
  if (segment.length === 0 || segment.length > 192 || segment.includes("/")) {
    throw new ReturnsAppError(400, `${label} is invalid`);
  }
  try {
    const value = decodeURIComponent(segment);
    if (value.length === 0 || value.length > 64 || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new ReturnsAppError(400, `${label} is invalid`);
    }
    return value;
  } catch (error) {
    if (error instanceof ReturnsAppError) throw error;
    throw new ReturnsAppError(400, `${label} is invalid`);
  }
}

function safeNotice(value: string | null): string | undefined {
  if (value === null) return undefined;
  const notices: Readonly<Record<string, string>> = {
    accepted: "Return accepted and reverse logistics opened.",
    dispatched: "Tracking saved and return dispatched.",
    inspected: "Warehouse inspection recorded.",
    approved: "Refund approved and scheduled for processing.",
    refunded: "Refund completed and case resolved.",
    processing: "Case review started.",
    requested: "Refund approval requested.",
    rejected: "Refund rejected.",
    closed: "Case closed."
  };
  return notices[value];
}

function safeSearchQuery(value: string | null): string {
  if (value === null) return "";
  const normalized = value.trim();
  if (normalized.length > 64 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new ReturnsAppError(400, "Search query is invalid");
  }
  return normalized;
}

function matchesSearch(item: ReturnCaseView, query: string): boolean {
  const normalized = query.toLocaleLowerCase("en-US");
  return [
    item.returnId,
    item.customerId,
    item.customerName,
    item.orderId,
    item.itemSummary,
    item.reason,
    item.caseState,
    item.logisticsState,
    item.inspectionState,
    item.refundState
  ].some((value) => value.toLocaleLowerCase("en-US").includes(normalized));
}

function commandNotice(command: string): string {
  const notices: Readonly<Record<string, string>> = {
    acceptReturn: "accepted",
    dispatchReturn: "dispatched",
    inspectReturn: "inspected",
    approveAndScheduleRefund: "approved",
    completeRefundAndResolve: "refunded"
  };
  return notices[command] ?? "updated";
}

function workflowNotice(workflow: string, action: string): string {
  const notices: Readonly<Record<string, string>> = {
    "case:startProcessing": "processing",
    "case:close": "closed",
    "refund:requestApproval": "requested",
    "refund:reject": "rejected"
  };
  return notices[`${workflow}:${action}`] ?? "updated";
}

function redirectToCase(name: string, notice: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location: `/returns/cases/${encodeURIComponent(name)}?notice=${encodeURIComponent(notice)}` }
  });
}

function comparePriority(left: ReturnCaseView, right: ReturnCaseView): number {
  return priorityScore(right) - priorityScore(left) || left.returnId.localeCompare(right.returnId);
}

function priorityScore(item: ReturnCaseView): number {
  return (item.highRisk ? 100 : 0) +
    (item.refundState === "Processing" ? 40 : 0) +
    (item.refundState === "Pending Approval" ? 35 : 0) +
    (item.logisticsState === "Received" && item.inspectionState === "Pending" ? 30 : 0) +
    (item.logisticsState === "In Transit" ? 20 : 0) +
    (item.caseState === "Draft" ? 10 : 0);
}

function lifecycleSummary(item: ReturnCaseView): string {
  return `Case ${item.caseState}, logistics ${item.logisticsState}, inspection ${item.inspectionState}, refund ${item.refundState}`;
}

function hasAnyRole(persona: ReturnsOperationsPersona, roles: readonly string[]): boolean {
  return roles.some((role) => persona.actor.roles.includes(role));
}

function stringField(data: DocumentData, field: string, fallback: string): string {
  return typeof data[field] === "string" ? data[field] : fallback;
}

function numberField(data: DocumentData, field: string): number {
  return typeof data[field] === "number" && Number.isFinite(data[field]) ? data[field] : 0;
}

function booleanField(data: DocumentData, field: string): boolean {
  return data[field] === true;
}

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatDateTime(value: string): string {
  if (value.length === 0) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC"
  }).format(parsed) + " UTC";
}

function initials(value: string): string {
  const parts = value.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "R") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function versionInput(version: number): string {
  return `<input type="hidden" name="expected_version" value="${String(version)}">`;
}

function isDocumentSnapshot(value: unknown): value is DocumentSnapshot {
  if (!isRecord(value)) return false;
  return typeof value.doctype === "string" &&
    typeof value.name === "string" &&
    typeof value.version === "number" &&
    isRecord(value.data);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ReturnsAppError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function appHtmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    }
  });
}

type IconName = "alert" | "arrow" | "automation" | "case" | "check" | "chevron" | "clock" | "inbox" | "inspect" | "overview" | "plus" | "pulse" | "queue" | "search" | "settings" | "shield" | "truck" | "wallet";

function icon(name: IconName): string {
  const paths: Readonly<Record<IconName, string>> = {
    alert: '<path d="M10.3 2.9 2.2 17a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    automation: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="m3 8 3-3"/><path d="m3 8 3 3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/><path d="m21 16-3 3"/><path d="m21 16-3-3"/><rect width="8" height="8" x="8" y="8" rx="2"/>',
    case: '<rect width="18" height="14" x="3" y="6" rx="2"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M12 12h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    inbox: '<path d="M4 4h16v13H4z"/><path d="M4 13h4l2 3h4l2-3h4"/>',
    inspect: '<path d="M9 11h6"/><path d="M9 15h4"/><path d="M5 3h14v18H5z"/><path d="M9 3V1h6v2"/>',
    overview: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    pulse: '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
    queue: '<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    truck: '<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    wallet: '<path d="M3 6h16v13H3z"/><path d="M3 8V5a2 2 0 0 1 2-2h12"/><path d="M15 12h6v4h-6a2 2 0 0 1 0-4Z"/>'
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function appStyles(): string {
  return `
  :root{font-family:"Avenir Next",Avenir,Inter,ui-sans-serif,system-ui,sans-serif;color:#171b1a;background:#f2f4f2;--ink:#171b1a;--muted:#66706c;--line:#d9dfdc;--surface:#fff;--sidebar:#121716;--lime:#c8f65a;--lime-dark:#5b7500;--cyan:#6dd8e7;--cyan-dark:#146472;--amber:#ffc85a;--amber-dark:#7a5200;--violet:#b8a7ff;--violet-dark:#4c3898;--coral:#ff8b78;--coral-dark:#9a2f20}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f2f4f2;color:var(--ink)}button,input,select,textarea{font:inherit}button,a{touch-action:manipulation}a{color:inherit;text-decoration:none}.icon{width:20px;height:20px;flex:none}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.skip-link{position:fixed;left:12px;top:-60px;z-index:1000;background:white;padding:10px 14px;border:2px solid var(--ink)}.skip-link:focus{top:12px}.app-shell{min-height:100dvh;display:grid;grid-template-columns:244px minmax(0,1fr)}.sidebar{position:sticky;top:0;height:100dvh;background:var(--sidebar);color:#eef3f0;padding:26px 18px;display:flex;flex-direction:column}.brand,.mobile-brand{display:flex;align-items:center;gap:11px;font-size:21px;font-weight:650;letter-spacing:0}.brand strong{color:var(--lime)}.brand-mark{width:30px;height:30px;display:grid;grid-template-columns:repeat(3,1fr);gap:3px;align-items:end}.brand-mark i{display:block;background:var(--lime);border-radius:1px}.brand-mark i:nth-child(1){height:14px}.brand-mark i:nth-child(2){height:24px}.brand-mark i:nth-child(3){height:19px;background:var(--cyan)}.primary-nav{display:grid;gap:5px;margin-top:42px}.primary-nav a,.sidebar-section a{height:44px;display:flex;align-items:center;gap:12px;padding:0 12px;color:#aeb9b4;border-radius:5px;font-size:14px;font-weight:600}.primary-nav a:hover,.primary-nav a:focus-visible,.sidebar-section a:hover,.sidebar-section a:focus-visible{background:#202826;color:white;outline:none}.primary-nav a.active{background:#29322f;color:white}.primary-nav a.active .icon{color:var(--lime)}.sidebar-section{border-top:1px solid #2c3532;margin-top:28px;padding-top:20px;display:grid;gap:5px}.sidebar-section>span{padding:0 12px 9px;color:#77837e;font-size:11px;font-weight:750;text-transform:uppercase}.sidebar-foot{margin-top:auto;border-top:1px solid #2c3532;padding:20px 10px 0;display:flex;align-items:center;gap:10px}.sidebar-foot div{display:grid;gap:2px}.sidebar-foot strong{font-size:12px}.sidebar-foot span{font-size:11px;color:#85918c}.live-dot{width:9px;height:9px;border-radius:50%;background:var(--lime);box-shadow:0 0 0 4px rgba(200,246,90,.12)}.app-column{min-width:0}.topbar{height:76px;background:white;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:flex-end;padding:0 34px;gap:22px;position:sticky;top:0;z-index:20}.mobile-brand{display:none}.global-search{margin-right:auto;width:min(390px,38vw);height:42px;border:1px solid var(--line);background:#f7f8f7;display:flex;align-items:center;gap:10px;padding:0 12px;border-radius:5px;color:#7b8581;font-size:13px}.global-search kbd{margin-left:auto;border:1px solid #cfd6d2;background:white;padding:1px 7px;border-radius:3px;font:12px ui-monospace,monospace}.persona-menu{position:relative}.persona-menu summary{list-style:none;display:flex;align-items:center;gap:10px;cursor:pointer;min-height:48px}.persona-menu summary::-webkit-details-marker{display:none}.persona-menu summary>span:nth-child(2){display:grid;gap:1px}.persona-menu summary strong{font-size:13px}.persona-menu summary small{color:var(--muted);font-size:11px}.persona-menu summary .icon{width:16px;height:16px;color:#7b8581;transform:rotate(90deg)}.avatar{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--violet);color:#24185a;font-weight:750;font-size:12px}.avatar.small{width:30px;height:30px;font-size:10px}.persona-popover{position:absolute;right:0;top:56px;width:320px;background:white;border:1px solid var(--line);box-shadow:0 18px 45px rgba(18,23,22,.16);padding:10px;border-radius:6px;z-index:40}.persona-popover>span{display:block;padding:7px 9px;color:var(--muted);font-size:11px;font-weight:750;text-transform:uppercase}.persona-popover form{margin:0}.persona-popover button{width:100%;border:0;background:transparent;text-align:left;padding:10px 9px;display:grid;gap:3px;border-radius:4px;cursor:pointer}.persona-popover button:hover:not(:disabled),.persona-popover button:focus-visible{background:#f0f3f1;outline:none}.persona-popover button:disabled{opacity:.45;cursor:default}.persona-popover button strong{font-size:13px}.persona-popover button small{color:var(--muted);line-height:1.35}main{max-width:1720px;margin:0 auto;padding:34px 38px 70px}.eyebrow{margin:0 0 6px;color:#75807b;font-size:11px;font-weight:800;text-transform:uppercase}.page-heading,.case-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:28px}.page-heading h1,.case-heading h1{margin:0;font-size:34px;line-height:1.12;letter-spacing:0}.page-heading p:not(.eyebrow),.case-heading p{margin:8px 0 0;color:var(--muted);font-size:15px}.heading-actions{display:flex;align-items:center;gap:10px}.button{min-height:42px;border:1px solid transparent;border-radius:4px;padding:0 15px;display:inline-flex;align-items:center;justify-content:center;gap:9px;font-weight:700;font-size:13px;cursor:pointer;transition:transform 160ms ease,background 160ms ease,border-color 160ms ease}.button:hover{transform:translateY(-1px)}.button:focus-visible{outline:3px solid rgba(109,216,231,.45);outline-offset:2px}.button.primary{background:var(--ink);color:white}.button.primary:hover{background:#2b3230}.button.secondary{background:white;border-color:var(--line)}.button.danger{background:#fff2ef;color:var(--coral-dark);border-color:#ffc5bb}.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:30px}.metric-card{background:white;border:1px solid var(--line);border-top:4px solid var(--tone);padding:18px;display:flex;gap:14px;min-height:124px;border-radius:5px}.metric-card.lime{--tone:var(--lime)}.metric-card.coral{--tone:var(--coral)}.metric-card.cyan{--tone:var(--cyan)}.metric-card.violet{--tone:var(--violet)}.metric-icon{width:38px;height:38px;background:#f1f3f2;border-radius:4px;display:grid;place-items:center}.metric-card>div:last-child{display:grid;grid-template-columns:1fr auto;align-items:start;gap:4px 12px;flex:1}.metric-card span{font-size:13px;color:var(--muted)}.metric-card strong{font-size:28px;line-height:1;font-variant-numeric:tabular-nums}.metric-card p{grid-column:1/-1;margin:6px 0 0;color:#808985;font-size:12px}.section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin:38px 0 15px}.section-heading h2{margin:0;font-size:20px;letter-spacing:0}.section-heading>p{margin:0;color:var(--muted);font-size:12px}.pipeline{display:grid;grid-template-columns:repeat(4,minmax(210px,1fr));gap:12px;align-items:start}.lane{min-width:0}.lane>header{height:42px;display:flex;align-items:center;gap:9px;border-bottom:1px solid var(--line)}.lane>header h3{font-size:13px;margin:0}.lane>header>span:last-child{margin-left:auto;color:var(--muted);font-size:12px}.lane-marker,.status-dot{width:8px;height:8px;border-radius:50%}.lane-marker.violet,.status-dot.violet{background:var(--violet)}.lane-marker.cyan,.status-dot.cyan{background:var(--cyan)}.lane-marker.amber,.status-dot.amber{background:var(--amber)}.lane-marker.green,.status-dot.lime{background:var(--lime)}.status-dot.coral{background:var(--coral)}.lane-items{display:grid;gap:8px;padding-top:9px}.case-card{background:white;border:1px solid var(--line);border-radius:5px;padding:13px;display:grid;gap:9px;min-height:126px;transition:transform 160ms ease,border-color 160ms ease,box-shadow 160ms ease}.case-card:hover{transform:translateY(-2px);border-color:#aeb8b3;box-shadow:0 8px 24px rgba(23,27,26,.07)}.case-card:focus-visible{outline:3px solid rgba(109,216,231,.45);outline-offset:2px}.case-card-top,.case-card-meta{display:flex;align-items:center;justify-content:space-between;gap:8px}.case-card-top strong{font-size:13px}.case-card>p{margin:0;color:#39413e;font-size:13px;line-height:1.35;min-height:35px}.case-card-meta{color:var(--muted);font-size:11px}.case-card-meta strong{color:var(--ink);font-size:12px;font-variant-numeric:tabular-nums}.risk-badge{color:var(--coral-dark);background:#fff0ed;padding:3px 6px;border-radius:3px;font-size:9px;font-weight:800;text-transform:uppercase}.state-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;height:3px}.state-strip span{border-radius:1px}.state-strip .violet{background:var(--violet)}.state-strip .cyan{background:var(--cyan)}.state-strip .amber{background:var(--amber)}.state-strip .lime{background:var(--lime)}.lane-empty{border:1px dashed #cbd2cf;color:#89928e;padding:20px 12px;text-align:center;font-size:12px}.content-split{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(300px,.65fr);gap:28px;margin-top:16px}.content-split .section-heading{margin-top:22px}.table-wrap{background:white;border:1px solid var(--line);overflow:auto;border-radius:5px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:13px 14px;border-bottom:1px solid #e8ecea;white-space:nowrap}th{font-size:10px;color:#7b8581;text-transform:uppercase}td{font-size:12px}tbody tr:last-child td{border-bottom:0}td>a:not(.icon-link),td>strong{display:grid;gap:2px}td a span,td>span:not(.signal),td strong+span{color:var(--muted);font-size:10px}.number{font-variant-numeric:tabular-nums;font-weight:700}.signal{display:inline-flex;padding:5px 8px;border-radius:3px;font-size:10px;font-weight:800}.signal.coral{background:#fff0ed;color:var(--coral-dark)}.signal.violet{background:#f0edff;color:var(--violet-dark)}.signal.cyan{background:#e9fbfd;color:var(--cyan-dark)}.signal.amber{background:#fff8e7;color:var(--amber-dark)}.signal.lime{background:#f3ffd9;color:var(--lime-dark)}.signal.neutral{background:#f0f2f1;color:#58615d}.icon-link{width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--line);border-radius:4px}.icon-link .icon{width:16px}.pulse-panel{background:var(--sidebar);color:white;padding:24px;border-radius:5px;align-self:end}.pulse-heading{display:flex;align-items:center;gap:10px;font-weight:750}.pulse-heading .icon{color:var(--lime)}.pulse-panel>p{color:#aeb9b4;font-size:12px;line-height:1.55;margin:12px 0 24px}.pulse-row{margin:17px 0}.pulse-row>div:first-child{display:flex;align-items:center;justify-content:space-between;font-size:11px}.pulse-row strong{font-variant-numeric:tabular-nums}.pulse-track{height:6px;background:#2a3330;margin-top:8px}.pulse-track span{display:block;height:100%}.pulse-track .violet{background:var(--violet)}.pulse-track .cyan{background:var(--cyan)}.pulse-track .amber{background:var(--amber)}.pulse-track .lime{background:var(--lime)}.reliability-note{border-top:1px solid #303a37;margin-top:24px;padding-top:18px;display:flex;gap:12px}.reliability-note .icon{color:var(--lime)}.reliability-note div{display:grid;gap:4px}.reliability-note strong{font-size:11px}.reliability-note span{font-size:10px;color:#92a09a;line-height:1.5}.breadcrumb{display:flex;align-items:center;gap:9px;color:var(--muted);font-size:12px;margin-bottom:22px}.breadcrumb a{color:var(--ink);font-weight:700}.flash{display:flex;align-items:center;gap:10px;padding:12px 14px;margin-bottom:18px;border-radius:4px;font-size:13px}.flash.success{background:#edfad6;color:#405b00;border:1px solid #cae890}.flash.error{background:#fff0ed;color:var(--coral-dark);border:1px solid #ffc5bb}.case-kicker{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;text-transform:uppercase;margin-bottom:8px}.case-heading-side{display:grid;justify-items:end;gap:2px}.case-heading-side .amount-label{color:var(--muted);font-size:11px}.case-heading-side>strong{font-size:28px;font-variant-numeric:tabular-nums}.case-heading-side>a{color:#3f5049;font-size:11px;font-weight:750;margin-top:5px;display:flex;align-items:center;gap:5px}.case-heading-side>a .icon{width:14px}.muted-separator{color:#adb5b1;margin:0 6px}.lifecycle-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:28px}.lifecycle-card{background:white;border:1px solid var(--line);padding:15px;border-radius:5px;display:grid;grid-template-columns:38px 1fr;gap:11px;align-items:center}.lifecycle-icon{width:38px;height:38px;border-radius:4px;display:grid;place-items:center}.lifecycle-icon.violet{background:#f0edff;color:var(--violet-dark)}.lifecycle-icon.cyan{background:#e9fbfd;color:var(--cyan-dark)}.lifecycle-icon.amber{background:#fff8e7;color:var(--amber-dark)}.lifecycle-icon.lime{background:#f3ffd9;color:var(--lime-dark)}.lifecycle-card>div:nth-child(2){display:grid;gap:2px}.lifecycle-card span{font-size:10px;color:var(--muted)}.lifecycle-card strong{font-size:13px}.progress{grid-column:1/-1;height:3px;background:#eef1ef}.progress span{display:block;height:100%}.progress .violet{background:var(--violet)}.progress .cyan{background:var(--cyan)}.progress .amber{background:var(--amber)}.progress .lime{background:var(--lime)}.case-layout{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(310px,.65fr);gap:28px;margin-top:28px;align-items:start}.case-main{min-width:0}.detail-section{border-top:1px solid var(--line);padding:0 0 28px}.detail-section:first-child{border-top:0}.detail-section .section-heading{margin-top:24px}.segment-badge{background:#e9fbfd;color:var(--cyan-dark);padding:5px 8px;border-radius:3px;font-size:10px;font-weight:800}.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 30px;margin:0}.detail-grid div{display:grid;gap:4px}.detail-grid dt{font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:750}.detail-grid dd{margin:0;font-size:13px;font-weight:650;overflow-wrap:anywhere}.customer-note{margin-top:20px;background:white;border-left:4px solid var(--cyan);padding:14px 16px}.customer-note span{font-size:10px;color:var(--muted);font-weight:800;text-transform:uppercase}.customer-note p{margin:6px 0 0;font-size:13px;line-height:1.55}.timeline{list-style:none;padding:0;margin:0}.timeline li{display:grid;grid-template-columns:12px 1fr auto;gap:12px;align-items:start;padding:12px 0;border-bottom:1px solid #e2e6e4}.timeline-dot{width:8px;height:8px;background:var(--cyan);border-radius:50%;margin-top:4px}.timeline li>div{display:grid;gap:3px}.timeline strong{font-size:12px}.timeline li div span{color:var(--muted);font-size:10px}.timeline code{font-size:10px;color:#7c8782}.timeline-empty{color:var(--muted);font-size:12px}.action-panel{position:sticky;top:100px;background:white;border:1px solid var(--line);border-top:5px solid var(--lime);padding:20px;border-radius:5px}.action-panel-heading{padding-bottom:14px}.action-panel-heading h2{font-size:18px;margin:0}.action-card{border-top:1px solid var(--line);padding:17px 0;display:grid;gap:13px}.action-card>div strong{font-size:13px}.action-card>div p{color:var(--muted);font-size:11px;line-height:1.5;margin:5px 0 0}.action-card label{display:grid;gap:6px;color:#4e5954;font-size:10px;font-weight:800;text-transform:uppercase}.action-card input,.action-card select,.action-card textarea{width:100%;border:1px solid #cbd3cf;background:#fbfcfb;color:var(--ink);padding:10px 11px;border-radius:4px;font-size:13px;text-transform:none}.action-card input,.action-card select{min-height:42px}.action-card textarea{resize:vertical}.action-card input:focus,.action-card select:focus,.action-card textarea:focus{outline:3px solid rgba(109,216,231,.35);border-color:var(--cyan-dark)}.action-card .button{width:100%}.action-card.compact .button{justify-content:space-between}.empty-action{border-top:1px solid var(--line);padding:22px 0;display:grid;justify-items:start;gap:8px}.empty-action .icon{color:var(--muted)}.empty-action strong{font-size:13px}.empty-action p{margin:0;color:var(--muted);font-size:11px;line-height:1.5}.assignment-block,.policy-block{border-top:1px solid var(--line);padding-top:17px;margin-top:4px}.assignment-block>span{color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase}.assignment-block>p{font-size:11px;color:var(--muted)}.assignee{display:flex;align-items:center;gap:9px;margin-top:11px}.assignee strong{font-size:11px;overflow-wrap:anywhere}.policy-block{display:flex;gap:10px;color:#53605a}.policy-block .icon{color:var(--lime-dark);width:18px}.policy-block p{margin:0;font-size:10px;line-height:1.5}.failure{min-height:60vh;display:grid;place-items:center;align-content:center;text-align:center}.failure>div{width:52px;height:52px;display:grid;place-items:center;background:#fff0ed;color:var(--coral-dark);border-radius:50%}.failure h1{font-size:28px;margin:18px 0 0}.failure p{color:var(--muted);max-width:520px}.failure .button{margin-top:8px}@media(max-width:1180px){.metric-grid,.lifecycle-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.pipeline{grid-template-columns:repeat(2,minmax(240px,1fr))}.content-split,.case-layout{grid-template-columns:1fr}.action-panel{position:static}.pulse-panel{align-self:auto}}@media(max-width:820px){.app-shell{grid-template-columns:1fr}.sidebar{display:none}.topbar{padding:0 18px;height:66px}.mobile-brand{display:flex;margin-right:auto;font-size:17px}.mobile-brand .brand-mark{width:25px;height:25px}.global-search{display:none}.persona-menu summary>span:nth-child(2){display:none}.persona-popover{position:fixed;left:12px;right:12px;top:72px;width:auto}.page-heading,.case-heading{align-items:flex-start;flex-direction:column}.case-heading-side{justify-items:start}.heading-actions{width:100%}.heading-actions .button{flex:1}main{padding:25px 18px 56px}.page-heading h1,.case-heading h1{font-size:28px}.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.metric-card{padding:14px;min-height:112px}.pipeline{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:8px}.lane{flex:0 0 min(82vw,320px);scroll-snap-align:start}.lifecycle-grid{grid-template-columns:1fr 1fr}.detail-grid{grid-template-columns:1fr}.content-split{gap:10px}.table-wrap{margin-left:-18px;margin-right:-18px;border-left:0;border-right:0;border-radius:0}.action-panel{margin-left:-4px;margin-right:-4px}}@media(max-width:520px){.topbar{gap:10px}.persona-menu summary{min-width:44px}.metric-grid{grid-template-columns:1fr}.heading-actions{flex-direction:column}.heading-actions .button{width:100%}.lifecycle-grid{grid-template-columns:1fr}.page-heading h1,.case-heading h1{font-size:25px}.case-heading-side>strong{font-size:24px}.section-heading{align-items:flex-start}.detail-section .section-heading{margin-top:20px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.button,.case-card{transition:none}}
  .global-search{gap:8px;padding:0 7px 0 12px;font-size:inherit}.global-search input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:var(--ink);font-size:13px}.global-search input::placeholder{color:#7b8581}.global-search button{width:32px;height:32px;border:0;background:transparent;color:#66706c;display:grid;place-items:center;border-radius:3px;cursor:pointer}.global-search button:hover,.global-search button:focus-visible{background:#e7ebe9;outline:none}.global-search button .icon{width:18px}@media(max-width:820px){.global-search{display:none}}
  `;
}
