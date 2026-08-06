import {
  AUTOMATION_RUN_DRAIN_JOB_NAME,
  AutomationRunConsumer,
  AutomationRunService,
  DEFAULT_TENANT_ID,
  D1DocumentStore,
  D1EventStore,
  D1ProjectionStore,
  SYSTEM_MANAGER_ROLE,
  createAutomationRunDrainJob,
  createJobRegistry,
  type Actor,
  type AutomationRunRecord,
  type JobMessage
} from "../../src";
import {
  CloudflareJobQueue,
  DurableObjectCommandExecutor,
  createAggregateCoordinatorClass,
  createCloudFrappeWorker,
  type CloudFrappeEnv,
  type CloudFrappeRuntimeServices
} from "../../src/cloudflare";
import {
  FINANCE_APPROVER_ROLE,
  RETURNS_AGENT_ROLE,
  RETURNS_MANAGER_ROLE,
  WAREHOUSE_INSPECTOR_ROLE,
  returnsRegistry
} from "./models";
import {
  PUBLIC_RETURN_INTAKE_PATH,
  PublicReturnIntakeBoundary
} from "./public-intake";
import { handleReturnsOperationsRequest } from "./operations-app";
import { seedReturnsDemo, type ReturnsDemoTransport, type ReturnsSeedSummary } from "./seed";

export interface ReturnsEnv extends CloudFrappeEnv {
  readonly RETURNS_DEMO_MODE?: string;
  readonly RETURNS_JOBS: Queue<JobMessage>;
}

export interface DemoPersona {
  readonly slug: string;
  readonly label: string;
  readonly actor: Actor;
  readonly journey: string;
}

const DEMO_PERSONA_COOKIE = "returns_demo_persona";
const DEMO_COOKIE_MAX_AGE_SECONDS = 28_800;

export const demoPersonas = Object.freeze({
  "returns-agent": Object.freeze({
    slug: "returns-agent",
    label: "Returns Agent",
    actor: Object.freeze({
      id: "returns.agent@demo.local",
      roles: Object.freeze([RETURNS_AGENT_ROLE, "User"]),
      tenantId: DEFAULT_TENANT_ID
    }),
    journey: "Accept intake, coordinate shipment, and request refund approval."
  }),
  "warehouse-inspector": Object.freeze({
    slug: "warehouse-inspector",
    label: "Warehouse Inspector",
    actor: Object.freeze({
      id: "warehouse.inspector@demo.local",
      roles: Object.freeze([WAREHOUSE_INSPECTOR_ROLE, "User"]),
      tenantId: DEFAULT_TENANT_ID
    }),
    journey: "Receive returned goods and record an inspection outcome."
  }),
  "finance-approver": Object.freeze({
    slug: "finance-approver",
    label: "Finance Approver",
    actor: Object.freeze({
      id: "finance.approver@demo.local",
      roles: Object.freeze([FINANCE_APPROVER_ROLE, "User"]),
      tenantId: DEFAULT_TENANT_ID
    }),
    journey: "Approve, schedule, and complete refunds."
  }),
  "returns-manager": Object.freeze({
    slug: "returns-manager",
    label: "Returns Manager",
    actor: Object.freeze({
      id: "returns.manager@demo.local",
      roles: Object.freeze([RETURNS_MANAGER_ROLE, RETURNS_AGENT_ROLE, WAREHOUSE_INSPECTOR_ROLE, FINANCE_APPROVER_ROLE, "User"]),
      tenantId: DEFAULT_TENANT_ID
    }),
    journey: "Review the end-to-end operation and close resolved cases."
  }),
  admin: Object.freeze({
    slug: "admin",
    label: "Demo Administrator",
    actor: Object.freeze({
      id: "admin@demo.local",
      roles: Object.freeze([
        SYSTEM_MANAGER_ROLE,
        RETURNS_MANAGER_ROLE,
        RETURNS_AGENT_ROLE,
        WAREHOUSE_INSPECTOR_ROLE,
        FINANCE_APPROVER_ROLE,
        "User"
      ]),
      tenantId: DEFAULT_TENANT_ID
    }),
    journey: "Seed fixtures and inspect framework administration surfaces."
  })
} satisfies Readonly<Record<string, DemoPersona>>);

type DemoPersonaSlug = keyof typeof demoPersonas;

const guestActor: Actor = Object.freeze({
  id: "guest",
  roles: Object.freeze(["Guest"]),
  tenantId: DEFAULT_TENANT_ID
});
const publicReturnIntakeBoundary = new PublicReturnIntakeBoundary();

const automationJobs = createJobRegistry<CloudFrappeRuntimeServices>({
  jobs: [createAutomationRunDrainJob<CloudFrappeRuntimeServices>()]
});

export class ExampleAggregateCoordinator extends createAggregateCoordinatorClass<ReturnsEnv>({
  registry: returnsRegistry
}) {}

const baseWorker = createCloudFrappeWorker<ReturnsEnv>({
  registry: returnsRegistry,
  actor: (request, env) => publicReturnIntakeBoundary.actorForRequest(request) ?? demoActorForRequest(request, env),
  jobs: {
    registry: automationJobs,
    queue: (env) => new CloudflareJobQueue(env.RETURNS_JOBS),
    cronTriggers: ["* * * * *"],
    schedules: [{
      id: "returns-automation-recovery",
      cron: "* * * * *",
      jobName: AUTOMATION_RUN_DRAIN_JOB_NAME,
      tenantId: DEFAULT_TENANT_ID,
      payload: { limit: 100 }
    }]
  }
});

type BaseWorkerRequest = Parameters<NonNullable<typeof baseWorker.fetch>>[0];
type BaseWorkerQueueArgs = Parameters<NonNullable<typeof baseWorker.queue>>;
type BaseWorkerScheduledArgs = Parameters<NonNullable<typeof baseWorker.scheduled>>;

export default {
  async fetch(request: BaseWorkerRequest, env: ReturnsEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === PUBLIC_RETURN_INTAKE_PATH && request.method.toUpperCase() === "POST") {
      return await handlePublicReturnIntake(request, env, ctx);
    }
    if (url.pathname === "/returns" || url.pathname.startsWith("/returns/")) {
      if (!isReturnsDemoRequest(request, env)) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.pathname.startsWith("/returns/persona/") && request.method === "POST") {
        const slug = safeDecodePathSegment(url.pathname.slice("/returns/persona/".length));
        if (!isDemoPersonaSlug(slug)) {
          return new Response("Unknown demo persona", { status: 400 });
        }
        return new Response(null, {
          status: 303,
          headers: {
            location: "/returns",
            "set-cookie": `${DEMO_PERSONA_COOKIE}=${slug}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(DEMO_COOKIE_MAX_AGE_SECONDS)}`
          }
        });
      }
      return await handleReturnsOperationsRequest(request, {
        persona: demoPersonaFromCookie(request.headers.get("cookie")) ?? demoPersonas["returns-agent"],
        personas: Object.values(demoPersonas),
        transport: operationsTransport(request, env, ctx)
      });
    }
    if (url.pathname === "/demo" || url.pathname.startsWith("/demo/")) {
      return await handleDemoRequest(request, env, ctx);
    }
    const response = await baseWorker.fetch!(request, env, ctx);
    if (shouldSignalAutomationDrain(request, response)) {
      ctx.waitUntil(signalAutomationDrain(env));
    }
    return response;
  },
  queue(...args: BaseWorkerQueueArgs) {
    return baseWorker.queue!(...args);
  },
  scheduled(...args: BaseWorkerScheduledArgs) {
    return baseWorker.scheduled!(...args);
  }
} satisfies ExportedHandler<ReturnsEnv, JobMessage>;

export function demoActorForRequest(request: Request, env: Pick<ReturnsEnv, "RETURNS_DEMO_MODE">): Actor {
  if (!isReturnsDemoRequest(request, env)) {
    return guestActor;
  }
  return demoPersonaFromCookie(request.headers.get("cookie"))?.actor ?? demoPersonas["returns-agent"].actor;
}

export function demoPersonaFromCookie(cookieHeader: string | null): DemoPersona | undefined {
  if (cookieHeader === null || cookieHeader.length > 4_096) {
    return undefined;
  }
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === DEMO_PERSONA_COOKIE && isDemoPersonaSlug(value)) {
      return demoPersonas[value];
    }
  }
  return undefined;
}

export function isReturnsDemoRequest(
  request: Request,
  env: Pick<ReturnsEnv, "RETURNS_DEMO_MODE">
): boolean {
  return env.RETURNS_DEMO_MODE === "true" && isLocalHostname(new URL(request.url).hostname);
}

export function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function shouldSignalAutomationDrain(request: Request, response: Response): boolean {
  return response.status < 400 && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase());
}

export async function handleDemoRequest(request: Request, env: ReturnsEnv, ctx: ExecutionContext): Promise<Response> {
  if (!isReturnsDemoRequest(request, env)) {
    return new Response("Not Found", { status: 404 });
  }
  const url = new URL(request.url);
  if (url.pathname === "/demo" && request.method === "GET") {
    return htmlResponse(renderDemoHome(demoPersonaFromCookie(request.headers.get("cookie")) ?? demoPersonas["returns-agent"]));
  }
  if (url.pathname.startsWith("/demo/persona/") && request.method === "POST") {
    const slug = safeDecodePathSegment(url.pathname.slice("/demo/persona/".length));
    if (!isDemoPersonaSlug(slug)) {
      return new Response("Unknown demo persona", { status: 400 });
    }
    return new Response(null, {
      status: 303,
      headers: {
        location: "/demo",
        "set-cookie": `${DEMO_PERSONA_COOKIE}=${slug}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(DEMO_COOKIE_MAX_AGE_SECONDS)}`
      }
    });
  }
  if (url.pathname === "/demo/seed" && request.method === "POST") {
    if (!isDemoAdmin(request)) {
      return new Response("Select the Demo Administrator persona before seeding", { status: 403 });
    }
    try {
      const summary = await seedReturnsDemo(seedTransport(request, env, ctx));
      const drain = await drainReturnsAutomations(env);
      return htmlResponse(renderSeedResult(summary, drain));
    } catch (error) {
      return htmlResponse(renderDemoError(error), 500);
    }
  }
  if (url.pathname === "/demo/automation/drain" && request.method === "POST") {
    if (!isDemoAdmin(request)) {
      return new Response("Select the Demo Administrator persona before draining automation", { status: 403 });
    }
    const drain = await drainReturnsAutomations(env);
    return htmlResponse(renderDrainResult(drain));
  }
  if (url.pathname === "/demo/automation-runs" && request.method === "GET") {
    if (!isDemoAdmin(request)) {
      return new Response("Select the Demo Administrator persona before inspecting automation runs", { status: 403 });
    }
    const runs = await listAutomationRuns(env);
    return htmlResponse(renderAutomationRuns(runs));
  }
  return new Response("Not Found", { status: 404 });
}

async function handlePublicReturnIntake(
  request: BaseWorkerRequest,
  env: ReturnsEnv,
  ctx: ExecutionContext
): Promise<Response> {
  return await publicReturnIntakeBoundary.handle(
    request,
    new D1ProjectionStore(env.DB),
    async (internalRequest) => {
      const workerRequest = internalRequest as BaseWorkerRequest;
      const response = await baseWorker.fetch!(workerRequest, env, ctx);
      if (response.status < 400 && shouldSignalAutomationDrain(workerRequest, response)) {
        ctx.waitUntil(signalAutomationDrain(env));
      }
      return response;
    }
  );
}

function seedTransport(request: Request, env: ReturnsEnv, ctx: ExecutionContext): ReturnsDemoTransport {
  return {
    async request(path, init = {}) {
      const url = new URL(path, request.url);
      const headers = new Headers(init.headers);
      headers.set("cookie", `${DEMO_PERSONA_COOKIE}=admin`);
      const internalRequest = new Request(url, { ...init, headers }) as BaseWorkerRequest;
      return await baseWorker.fetch!(internalRequest, env, ctx);
    }
  };
}

function operationsTransport(request: Request, env: ReturnsEnv, ctx: ExecutionContext): ReturnsDemoTransport {
  return {
    async request(path, init = {}) {
      const url = new URL(path, request.url);
      const headers = new Headers(init.headers);
      const cookie = request.headers.get("cookie");
      if (cookie !== null) {
        headers.set("cookie", cookie);
      }
      const internalRequest = new Request(url, { ...init, headers }) as BaseWorkerRequest;
      const response = await baseWorker.fetch!(internalRequest, env, ctx);
      if (shouldSignalAutomationDrain(internalRequest, response)) {
        ctx.waitUntil(signalAutomationDrain(env));
      }
      return response;
    }
  };
}

async function signalAutomationDrain(env: ReturnsEnv): Promise<void> {
  const id = crypto.randomUUID();
  await new CloudflareJobQueue(env.RETURNS_JOBS).send({
    tenantId: DEFAULT_TENANT_ID,
    jobName: AUTOMATION_RUN_DRAIN_JOB_NAME,
    payload: { limit: 100 },
    runId: `job_${id}`,
    idempotencyKey: `returns-http-drain:${id}`,
    enqueuedAt: new Date().toISOString(),
    metadata: { dispatchSource: "returns-demo-http" }
  });
}

async function drainReturnsAutomations(env: ReturnsEnv): Promise<{
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
  readonly dead: number;
}> {
  const consumer = automationConsumer(env);
  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let dead = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await consumer.drain({ tenantId: DEFAULT_TENANT_ID, limit: 100 });
    claimed += result.claimed;
    delivered += result.delivered;
    failed += result.failed;
    dead += result.dead;
    if (result.claimed === 0 || result.failed > 0 || result.dead > 0) {
      break;
    }
  }
  return Object.freeze({ claimed, delivered, failed, dead });
}

async function listAutomationRuns(env: ReturnsEnv): Promise<readonly AutomationRunRecord[]> {
  const projections = new D1ProjectionStore(env.DB);
  return await new AutomationRunService({
    store: new D1DocumentStore(env.DB),
    projections
  }).list(DEFAULT_TENANT_ID);
}

function automationConsumer(env: ReturnsEnv): AutomationRunConsumer {
  const projections = new D1ProjectionStore(env.DB);
  const store = new D1DocumentStore(env.DB);
  const runs = new AutomationRunService({ store, projections });
  return new AutomationRunConsumer({
    runs,
    documents: new DurableObjectCommandExecutor({ registry: returnsRegistry, namespace: env.AGGREGATES }),
    events: new D1EventStore(env.DB),
    projections
  });
}

function isDemoAdmin(request: Request): boolean {
  return demoPersonaFromCookie(request.headers.get("cookie"))?.slug === "admin";
}

function isDemoPersonaSlug(value: string): value is DemoPersonaSlug {
  return Object.prototype.hasOwnProperty.call(demoPersonas, value);
}

function safeDecodePathSegment(value: string): string {
  if (value.length === 0 || value.length > 64 || value.includes("/")) {
    return "";
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function renderDemoHome(current: DemoPersona): string {
  const personas = Object.values(demoPersonas).map((persona) => `
    <form method="post" action="/demo/persona/${encodeURIComponent(persona.slug)}">
      <button type="submit"${persona.slug === current.slug ? " disabled" : ""}>${escapeHtml(persona.label)}</button>
      <span>${escapeHtml(persona.actor.id)}</span>
      <small>${escapeHtml(persona.journey)}</small>
    </form>`).join("");
  const adminControls = current.slug === "admin"
    ? `<form method="post" action="/demo/seed"><button class="primary" type="submit">Seed deterministic demo data</button></form>
       <form method="post" action="/demo/automation/drain"><button type="submit">Drain pending automation</button></form>`
    : `<p class="notice">Select Demo Administrator to seed fixtures or manually drain pending automation.</p>`;
  const automationRunsLink = current.slug === "admin"
    ? `<a href="/demo/automation-runs">Automation runs</a>`
    : "";
  return demoLayout("ReturnsOS Demo", `
    <header>
      <div><p class="eyebrow">Local test harness</p><h1>ReturnsOS</h1></div>
      <p>Current persona: <strong>${escapeHtml(current.label)}</strong> (${escapeHtml(current.actor.id)})</p>
    </header>
    <nav>
      <a href="/returns">Open ReturnsOS app</a>
      <a href="/desk/workspaces/Returns%20Operations">Admin Desk</a>
      <a href="/desk/Return%20Request">Return requests</a>
      <a href="/web-forms/returns/intake">Customer intake</a>
      ${automationRunsLink}
    </nav>
    <section><h2>Personas</h2><div class="personas">${personas}</div></section>
    <section><h2>Fixture controls</h2><div class="controls">${adminControls}</div></section>
  `);
}

function renderSeedResult(
  summary: ReturnsSeedSummary,
  drain: { readonly claimed: number; readonly delivered: number; readonly failed: number; readonly dead: number }
): string {
  return demoLayout("ReturnsOS Seed Complete", `
    <header><div><p class="eyebrow">Idempotent seed</p><h1>Fixtures are ready</h1></div></header>
    <section class="metrics">
      ${metric("Created", summary.created.length)}
      ${metric("Already present", summary.existing.length)}
      ${metric("Transitions applied", summary.transitions.length)}
      ${metric("Automation delivered", drain.delivered)}
    </section>
    <section><h2>Result</h2><p>Automation claimed ${String(drain.claimed)}, failed ${String(drain.failed)}, dead-lettered ${String(drain.dead)}.</p>
      <p><a href="/desk/workspaces/Returns%20Operations">Open Returns Operations</a> <a href="/demo/automation-runs">Inspect automation runs</a> <a href="/demo">Back to demo controls</a></p>
    </section>
  `);
}

function renderDrainResult(
  drain: { readonly claimed: number; readonly delivered: number; readonly failed: number; readonly dead: number }
): string {
  return demoLayout("Automation Drain", `
    <header><div><p class="eyebrow">Durable automation</p><h1>Drain complete</h1></div></header>
    <section class="metrics">
      ${metric("Claimed", drain.claimed)}
      ${metric("Delivered", drain.delivered)}
      ${metric("Failed", drain.failed)}
      ${metric("Dead", drain.dead)}
    </section>
    <p><a href="/demo/automation-runs">Inspect runs</a> <a href="/demo">Back to demo controls</a></p>
  `);
}

function renderAutomationRuns(runs: readonly AutomationRunRecord[]): string {
  const recent = [...runs].reverse().slice(0, 100);
  const rows = recent.map((run) => `<tr>
    <td>${escapeHtml(run.status)}</td>
    <td>${escapeHtml(run.sourceDoctype)}/${escapeHtml(run.sourceDocumentName)}</td>
    <td>${escapeHtml(run.ruleName)}</td>
    <td>${escapeHtml(run.action.target.doctype)}/${escapeHtml(run.action.target.name)}</td>
    <td>${String(run.attempts)}</td>
  </tr>`).join("");
  return demoLayout("ReturnsOS Automation Runs", `
    <header><div><p class="eyebrow">Durable execution log</p><h1>Automation runs</h1></div><p>${String(runs.length)} total</p></header>
    <section class="table-wrap"><table><thead><tr><th>Status</th><th>Source</th><th>Rule</th><th>Target</th><th>Attempts</th></tr></thead>
      <tbody>${rows || "<tr><td colspan=\"5\">No automation runs yet.</td></tr>"}</tbody></table></section>
    <p><a href="/demo">Back to demo controls</a></p>
  `);
}

function renderDemoError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown seed failure";
  return demoLayout("ReturnsOS Demo Error", `
    <header><div><p class="eyebrow">Demo operation failed</p><h1>Could not complete the operation</h1></div></header>
    <section><p class="error">${escapeHtml(message)}</p><p><a href="/demo">Back to demo controls</a></p></section>
  `);
}

function metric(label: string, value: number): string {
  return `<article><strong>${String(value)}</strong><span>${escapeHtml(label)}</span></article>`;
}

function demoLayout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title><style>
      :root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#172033;background:#f6f8fb}*{box-sizing:border-box}body{margin:0}main{width:min(1120px,calc(100% - 32px));margin:32px auto 64px}header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;border-bottom:1px solid #d7dce5;padding-bottom:20px}h1{font-size:36px;line-height:1.05;margin:4px 0 0;letter-spacing:0}h2{font-size:18px;letter-spacing:0;margin:0 0 14px}.eyebrow{margin:0;color:#526071;font-size:13px;text-transform:uppercase;font-weight:700}nav{display:flex;flex-wrap:wrap;gap:12px;padding:18px 0}a{color:#1454d8;text-decoration:none;font-weight:650}section{padding:22px 0;border-top:1px solid #e1e5ec}.personas{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.personas form{display:grid;gap:6px;border:1px solid #d7dce5;background:white;padding:14px;border-radius:6px}.personas span,.personas small{overflow-wrap:anywhere}.personas small{color:#5e6878;line-height:1.45}.controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.controls form{margin:0}button{border:1px solid #aeb7c6;background:white;color:#172033;padding:9px 12px;border-radius:5px;font:inherit;font-weight:650;cursor:pointer}button.primary{background:#1454d8;color:white;border-color:#1454d8}button:disabled{opacity:.55;cursor:default}.notice{color:#5e6878}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.metrics article{background:white;border:1px solid #d7dce5;border-radius:6px;padding:16px;display:grid;gap:4px}.metrics strong{font-size:28px}.metrics span{color:#5e6878}.table-wrap{overflow:auto;background:white;border:1px solid #d7dce5;border-radius:6px;padding:0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #e5e8ee;white-space:nowrap}.error{color:#b42318}@media(max-width:720px){header{align-items:flex-start;flex-direction:column}h1{font-size:30px}}
    </style></head><body><main>${body}</main></body></html>`;
}

function htmlResponse(html: string, status = 200): Response {
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
