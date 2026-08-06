import {
  DocumentService,
  InMemoryDocumentStore,
  QueryService,
  fixedClock,
  type Actor,
  type IdGenerator
} from "../../src";
import { createResourceApi } from "../../src/adapters/http/resource-api";
import {
  FINANCE_APPROVER_ROLE,
  RETURNS_AGENT_ROLE,
  RETURNS_MANAGER_ROLE,
  WAREHOUSE_INSPECTOR_ROLE,
  returnsRegistry
} from "../../examples/returns/models";
import { seedReturnsDemo } from "../../examples/returns/seed";
import {
  default as returnsWorker,
  demoActorForRequest,
  demoPersonaFromCookie,
  handleDemoRequest,
  isLocalHostname,
  isReturnsDemoRequest,
  shouldSignalAutomationDrain,
  type ReturnsEnv
} from "../../examples/returns/worker";

const admin: Actor = {
  id: "admin@demo.local",
  roles: ["System Manager", RETURNS_MANAGER_ROLE, RETURNS_AGENT_ROLE, WAREHOUSE_INSPECTOR_ROLE, FINANCE_APPROVER_ROLE, "User"],
  tenantId: "default"
};

describe("ReturnsOS local demo harness", () => {
  it("enables personas only for explicit localhost demo mode", () => {
    const local = new Request("http://localhost/demo", { headers: { cookie: "returns_demo_persona=finance-approver" } });
    const remote = new Request("https://returns.example.com/demo", { headers: { cookie: "returns_demo_persona=admin" } });

    expect(isLocalHostname("localhost")).toBe(true);
    expect(isLocalHostname("127.0.0.1")).toBe(true);
    expect(isLocalHostname("returns.example.com")).toBe(false);
    expect(isReturnsDemoRequest(local, { RETURNS_DEMO_MODE: "true" })).toBe(true);
    expect(isReturnsDemoRequest(local, { RETURNS_DEMO_MODE: "false" })).toBe(false);
    expect(isReturnsDemoRequest(remote, { RETURNS_DEMO_MODE: "true" })).toBe(false);
    expect(demoActorForRequest(local, { RETURNS_DEMO_MODE: "true" })).toMatchObject({
      id: "finance.approver@demo.local",
      roles: [FINANCE_APPROVER_ROLE, "User"]
    });
    expect(demoActorForRequest(remote, { RETURNS_DEMO_MODE: "true" })).toMatchObject({ id: "guest", roles: ["Guest"] });
  });

  it("rejects malformed or unknown persona cookie values", () => {
    expect(demoPersonaFromCookie("returns_demo_persona=admin")?.actor.id).toBe("admin@demo.local");
    expect(demoPersonaFromCookie("returns_demo_persona=unknown")).toBeUndefined();
    expect(demoPersonaFromCookie(`returns_demo_persona=${"x".repeat(4_100)}`)).toBeUndefined();
  });

  it("signals automation only after successful mutating requests", () => {
    expect(shouldSignalAutomationDrain(new Request("http://localhost/api/resource/Order", { method: "POST" }), new Response(null, { status: 201 }))).toBe(true);
    expect(shouldSignalAutomationDrain(new Request("http://localhost/api/resource/Order"), new Response(null, { status: 200 }))).toBe(false);
    expect(shouldSignalAutomationDrain(new Request("http://localhost/api/resource/Order", { method: "POST" }), new Response(null, { status: 409 }))).toBe(false);
  });

  it("keeps Automation Runs visible only to the local Demo Administrator", async () => {
    const env = { RETURNS_DEMO_MODE: "true" } as ReturnsEnv;
    const ctx = {} as ExecutionContext;
    const denied = await handleDemoRequest(new Request("http://localhost/demo/automation-runs", {
      headers: { cookie: "returns_demo_persona=finance-approver" }
    }), env, ctx);
    expect(denied.status).toBe(403);

    const agentHome = await handleDemoRequest(new Request("http://localhost/demo", {
      headers: { cookie: "returns_demo_persona=returns-agent" }
    }), env, ctx);
    expect(await agentHome.text()).not.toContain('href="/demo/automation-runs"');

    const adminHome = await handleDemoRequest(new Request("http://localhost/demo", {
      headers: { cookie: "returns_demo_persona=admin" }
    }), env, ctx);
    expect(await adminHome.text()).toContain('href="/demo/automation-runs"');
    expect(await handleDemoRequest(new Request("http://localhost/demo"), env, ctx).then((response) => response.text()))
      .toContain('href="/returns"');
  });

  it("exposes persona switching for the standalone app only in local demo mode", async () => {
    const env = { RETURNS_DEMO_MODE: "true" } as ReturnsEnv;
    const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;

    const selected = await returnsWorker.fetch(
      new Request("http://localhost/returns/persona/admin", { method: "POST" }) as never,
      env,
      ctx
    );
    expect(selected.status).toBe(303);
    expect(selected.headers.get("location")).toBe("/returns");
    expect(selected.headers.get("set-cookie")).toContain("returns_demo_persona=admin");

    const remote = await returnsWorker.fetch(
      new Request("https://returns.example.com/returns/persona/admin", { method: "POST" }) as never,
      env,
      ctx
    );
    expect(remote.status).toBe(404);
  });

  it("seeds every fixture idempotently through the public resource contract", async () => {
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({
      registry: returnsRegistry,
      store,
      clock: fixedClock("2026-08-05T00:00:00.000Z"),
      ids: sequentialIds()
    });
    const app = createResourceApi({
      registry: returnsRegistry,
      documents,
      queries: new QueryService({ registry: returnsRegistry, projections: store }),
      actor: () => admin
    });
    const transport = { request: async (path: string, init?: RequestInit) => await app.request(path, init) };

    const first = await seedReturnsDemo(transport);
    const second = await seedReturnsDemo(transport);

    expect(first.created).toHaveLength(16);
    expect(first.existing).toHaveLength(0);
    expect(first.transitions.length).toBeGreaterThan(15);
    expect(second.created).toHaveLength(0);
    expect(second.existing).toHaveLength(16);
    expect(second.transitions).toHaveLength(0);
    await expect(store.get("default", "Return Request", "RMA-2026-000005")).resolves.toMatchObject({
      data: {
        case_state: "Processing",
        logistics_state: "Received",
        inspection_state: "Passed",
        refund_state: "Processing",
        refund_reference: "DEMO-REFUND-1005"
      }
    });
    await expect(store.get("default", "Return Request", "RMA-2026-000006")).resolves.toMatchObject({
      data: { risk_score: 9, high_risk: false }
    });
  });
});

function sequentialIds(): IdGenerator {
  let value = 0;
  return { next: (prefix = "") => `${prefix}${String(++value).padStart(6, "0")}` };
}
