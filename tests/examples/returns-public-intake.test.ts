import {
  DocumentService,
  InMemoryDocumentStore,
  QueryService,
  WebFormService,
  createResourceApi,
  fixedClock,
  type Actor
} from "../../src";
import {
  RETURNS_AGENT_ROLE,
  RETURNS_MANAGER_ROLE,
  returnsRegistry
} from "../../examples/returns/models";
import {
  PUBLIC_RETURN_INTAKE_MAX_BYTES,
  PublicReturnIntakeBoundary,
  publicReturnIntakeActor,
  verifyPublicReturnIntake
} from "../../examples/returns/public-intake";

const tenantId = "default";
const guest: Actor = { id: "guest", roles: ["Guest"], tenantId };
const manager: Actor = {
  id: "returns.manager@demo.local",
  roles: [RETURNS_MANAGER_ROLE, RETURNS_AGENT_ROLE, "User"],
  tenantId
};

describe("ReturnsOS public intake boundary", () => {
  it("denies Guest access to Customer and Order resource APIs", async () => {
    const fixture = await createFixture();
    const app = fixture.appFor(guest);

    for (const path of [
      "/api/resource/Customer",
      "/api/resource/Customer/CUST-2001",
      "/api/resource/Order",
      "/api/resource/Order/ORD-2001"
    ]) {
      const response = await app.request(path);
      expect(response.status).toBe(403);
    }

    const publicForm = await app.request("/web-forms/returns/intake");
    expect(publicForm.status).toBe(200);
    const publicFormHtml = await publicForm.text();
    expect(publicFormHtml).toContain("Start a Return");
    expect(publicFormHtml).toContain("Customer");
    expect(publicFormHtml).not.toContain("Return ID");
    expect(publicFormHtml).not.toContain('name="return_id"');
  });

  it("rejects caller-supplied Return IDs on every generic Web Form submission route", async () => {
    const fixture = await createFixture();
    const internalApp = fixture.appFor(publicReturnIntakeActor);

    expect((await internalApp.request("/api/resource/Customer/CUST-2001")).status).toBe(200);
    expect((await internalApp.request("/api/resource/Order/ORD-2001")).status).toBe(200);

    const data = {
      return_id: "RMA-2001",
      customer: "CUST-2001",
      order: "ORD-2001",
      reason: "Damaged",
      details: "Screen cracked on arrival",
      requested_amount: "240"
    };
    const jsonResponse = await internalApp.request("/api/web-form/Return%20Intake/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data })
    });
    expect(jsonResponse.status).toBe(400);
    for (const path of ["/web-forms/returns/intake", "/web-forms/Return%20Intake"]) {
      expect((await submitForm(internalApp, data, path)).status).toBe(400);
    }
    await expect(fixture.store.list({ tenantId, doctype: "Return Request" })).resolves.toMatchObject({ total: 0 });
  });

  it("does not let a normal Guest create a Return through generic Web Form routes", async () => {
    const fixture = await createFixture();
    const response = await submitForm(fixture.appFor(guest), {
      customer: "CUST-2001",
      order: "ORD-2001",
      reason: "Wrong Item",
      requested_amount: "100"
    });

    expect(response.status).toBe(422);
    await expect(fixture.store.list({ tenantId, doctype: "Return Request" })).resolves.toMatchObject({ total: 0 });
  });

  it("grants the internal actor only to the verified Request identity", async () => {
    const fixture = await createFixture();
    const boundary = new PublicReturnIntakeBoundary();
    const app = fixture.appResolving((request) => boundary.actorForRequest(request) ?? guest);
    const spoofedRequest = intakeRequest(new URLSearchParams({
      return_id: "RMA-2008",
      customer: "CUST-2001",
      order: "ORD-2001",
      reason: "Other",
      requested_amount: "25"
    }), {
      cookie: "returns_demo_persona=admin; actor=public-return-intake@internal",
      "x-role": "Public Return Intake"
    });
    expect(boundary.actorForRequest(spoofedRequest)).toBeUndefined();
    expect((await app.fetch(spoofedRequest.clone() as never)).status).toBe(400);

    const externalRequest = intakeRequest(new URLSearchParams({
      customer: "CUST-2001",
      order: "ORD-2001",
      reason: "Other",
      requested_amount: "25"
    }));

    let forwardedRequest: Request | undefined;
    const response = await boundary.handle(externalRequest, fixture.store, async (request) => {
      forwardedRequest = request;
      expect(boundary.actorForRequest(request)).toEqual(publicReturnIntakeActor);
      return await app.fetch(request as never);
    });
    expect(response.status).toBe(201);
    expect(forwardedRequest).toBeDefined();
    expect(boundary.actorForRequest(forwardedRequest!)).toBeUndefined();
  });

  it("atomically allows only one concurrent Return Request for an order before Automation projects it", async () => {
    const fixture = await createFixture();
    const boundary = new PublicReturnIntakeBoundary();
    const app = fixture.appResolving((request) => boundary.actorForRequest(request) ?? guest);
    const forward = async (request: Request) => await app.fetch(request as never);

    const [first, second] = await Promise.all([
      boundary.handle(intakeRequest(new URLSearchParams({
        customer: "CUST-2001",
        order: "ORD-2001",
        reason: "Damaged",
        requested_amount: "100"
      })), fixture.store, forward),
      boundary.handle(intakeRequest(new URLSearchParams({
        customer: "CUST-2001",
        order: "ORD-2001",
        reason: "Changed Mind",
        requested_amount: "50"
      })), fixture.store, forward)
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 400]);
    await expect(fixture.store.get(tenantId, "Order", "ORD-2001")).resolves.toMatchObject({
      data: { has_open_return: false }
    });
    await expect(fixture.store.get(tenantId, "Return Request", "RMA-2026-000001")).resolves.toMatchObject({
      data: { order: "ORD-2001" }
    });
    const rejected = first.status === 400 ? first : second;
    await expect(rejected.text()).resolves.toBe("Unable to verify this return request. Check the submitted details and try again.");
  });

  it("validates the customer-order relationship and normalizes valid intake deterministically", async () => {
    const fixture = await createFixture();
    const request = intakeRequest(new URLSearchParams({
      customer: " cust-2001 ",
      order: " ord-2001 ",
      reason: " Damaged ",
      details: "  Packaging was crushed.  ",
      requested_amount: "240.50"
    }));

    const verified = await verifyPublicReturnIntake(request, fixture.store);
    expect(verified).toEqual({
      body: "customer=CUST-2001&order=ORD-2001&reason=Damaged&details=Packaging+was+crushed.&requested_amount=240.5",
      data: {
        customer: "CUST-2001",
        order: "ORD-2001",
        reason: "Damaged",
        details: "Packaging was crushed.",
        requested_amount: 240.5
      }
    });
  });

  it("rejects mismatched customers, excessive amounts, and orders with open returns", async () => {
    const fixture = await createFixture();
    await fixture.documents.create({
      actor: manager,
      doctype: "Customer",
      data: { customer_id: "CUST-2002", display_name: "Second Customer", email: "second@example.test" }
    });
    await fixture.documents.create({
      actor: manager,
      doctype: "Order",
      data: {
        order_id: "ORD-2002",
        customer: "CUST-2002",
        item_summary: "Open return item",
        order_total: 100,
        has_open_return: true
      }
    });
    await expectVerificationFailure(fixture.store, {
      customer: "CUST-2002",
      order: "ORD-2001",
      reason: "Damaged",
      requested_amount: "20"
    });
    await expectVerificationFailure(fixture.store, {
      customer: "CUST-2001",
      order: "ORD-2001",
      reason: "Damaged",
      requested_amount: "500"
    });
    await expectVerificationFailure(fixture.store, {
      customer: "CUST-2002",
      order: "ORD-2002",
      reason: "Damaged",
      requested_amount: "50"
    });

  });

  it("rejects malformed, duplicate, oversized, unknown, and wrong-content-type input", async () => {
    const fixture = await createFixture();
    const valid = {
      customer: "CUST-2001",
      order: "ORD-2001",
      reason: "Damaged",
      requested_amount: "20"
    };
    const duplicate = new URLSearchParams(valid);
    duplicate.append("order", "ORD-2001");
    const unknown = new URLSearchParams({ ...valid, unexpected: "value" });

    const requests = [
      new Request("http://localhost/web-forms/returns/intake", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "customer=%ZZ"
      }),
      intakeRequest(duplicate),
      intakeRequest(unknown),
      intakeRequest(new URLSearchParams({ ...valid, details: "x".repeat(PUBLIC_RETURN_INTAKE_MAX_BYTES) })),
      new Request("http://localhost/web-forms/returns/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(valid)
      }),
      new Request("http://localhost/web-forms/returns/intake", { method: "POST", body: "" }),
      new Request("http://localhost/web-forms/returns/intake", {
        method: "GET",
        headers: { "content-type": "application/x-www-form-urlencoded" }
      }),
      intakeRequest(new URLSearchParams({ ...valid, return_id: "RMA-9999" })),
      intakeRequest(new URLSearchParams({ ...valid, customer: "CUSTOMER-2001" })),
      intakeRequest(new URLSearchParams({ ...valid, order: "ORDER-2001" })),
      intakeRequest(new URLSearchParams({ ...valid, reason: "Unlisted" })),
      intakeRequest(new URLSearchParams({ ...valid, requested_amount: "0" })),
      intakeRequest(new URLSearchParams({ ...valid, requested_amount: "1e2" })),
      intakeRequest(new URLSearchParams({ ...valid, details: "unsafe\u0000details" })),
      intakeRequest(new URLSearchParams({
        order: valid.order,
        reason: valid.reason,
        requested_amount: valid.requested_amount
      }))
    ];

    for (const request of requests) {
      await expect(verifyPublicReturnIntake(request, fixture.store)).resolves.toBeNull();
    }
  });

  it("returns a generic failure when verification storage or forwarding fails", async () => {
    const fixture = await createFixture();
    const boundary = new PublicReturnIntakeBoundary();
    const request = () => intakeRequest(new URLSearchParams({
      customer: "CUST-2001",
      order: "ORD-2001",
      reason: "Other",
      requested_amount: "25"
    }));

    await expect(verifyPublicReturnIntake(request(), {
      get: async () => { throw new Error("projection unavailable"); }
    })).resolves.toBeNull();
    expect((await boundary.handle(request(), fixture.store, async () => {
      throw new Error("forward unavailable");
    })).status).toBe(400);
    expect((await boundary.handle(request(), fixture.store, async () => new Response("conflict", { status: 409 }))).status).toBe(400);
    let forwarded = false;
    expect((await boundary.handle(new Request("http://localhost/web-forms/returns/intake", { method: "POST" }), fixture.store, async () => {
      forwarded = true;
      return new Response(null, { status: 201 });
    })).status).toBe(400);
    expect(forwarded).toBe(false);
  });
});

async function createFixture() {
  const store = new InMemoryDocumentStore();
  const documents = new DocumentService({
    registry: returnsRegistry,
    store,
    clock: fixedClock("2026-08-05T00:00:00.000Z")
  });
  await documents.create({
    actor: manager,
    doctype: "Customer",
    data: { customer_id: "CUST-2001", display_name: "Primary Customer", email: "primary@example.test" }
  });
  await documents.create({
    actor: manager,
    doctype: "Order",
    data: {
      order_id: "ORD-2001",
      customer: "CUST-2001",
      item_summary: "Demo monitor",
      order_total: 300
    }
  });
  return {
    documents,
    store,
    appFor(actor: Actor) {
      return createApp(() => actor);
    },
    appResolving(actor: (request: Request) => Actor) {
      return createApp(actor);
    }
  };

  function createApp(actor: (request: Request) => Actor) {
      const queries = new QueryService({ registry: returnsRegistry, projections: store });
      return createResourceApi({
        registry: returnsRegistry,
        documents,
        queries,
        webForms: new WebFormService({ registry: returnsRegistry, documents, queries }),
        actor
      });
  }
}

function intakeRequest(body: URLSearchParams, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/web-forms/returns/intake", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", ...headers },
    body
  });
}

async function submitForm(
  app: ReturnType<Awaited<ReturnType<typeof createFixture>>["appFor"]>,
  data: Record<string, string>,
  path = "/web-forms/returns/intake"
): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data)
  });
}

async function expectVerificationFailure(
  store: InMemoryDocumentStore,
  data: Record<string, string>
): Promise<void> {
  await expect(verifyPublicReturnIntake(intakeRequest(new URLSearchParams(data)), store)).resolves.toBeNull();
}
