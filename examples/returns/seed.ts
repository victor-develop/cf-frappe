import type { DocumentData, DocumentSnapshot } from "../../src";

export interface ReturnsDemoTransport {
  request(path: string, init?: RequestInit): Promise<Response>;
}

export interface ReturnsSeedSummary {
  readonly created: readonly string[];
  readonly existing: readonly string[];
  readonly transitions: readonly string[];
}

interface ReturnFixture {
  readonly data: DocumentData;
  readonly stage: "draft" | "in-transit" | "received" | "pending-approval" | "refund-processing";
  readonly inspection?: "pass" | "markPartial";
}

const customers: readonly DocumentData[] = [
  {
    customer_id: "CUST-1001",
    display_name: "Avery Chen",
    email: "avery.chen@example.test",
    segment: "VIP"
  },
  {
    customer_id: "CUST-1002",
    display_name: "Morgan Lee",
    email: "morgan.lee@example.test",
    segment: "Plus"
  }
];

const orders: readonly DocumentData[] = [
  { order_id: "ORD-1001", customer: "CUST-1001", item_summary: "Noise-cancelling headphones", order_total: 329, order_status: "Fulfilled" },
  { order_id: "ORD-1002", customer: "CUST-1002", item_summary: "Travel backpack", order_total: 189, order_status: "Fulfilled" },
  { order_id: "ORD-1003", customer: "CUST-1001", item_summary: "Mechanical keyboard", order_total: 249, order_status: "Fulfilled" },
  { order_id: "ORD-1004", customer: "CUST-1002", item_summary: "Smart desk lamp", order_total: 159, order_status: "Fulfilled" },
  { order_id: "ORD-1005", customer: "CUST-1001", item_summary: "Ergonomic chair", order_total: 699, order_status: "Fulfilled" },
  { order_id: "ORD-1006", customer: "CUST-1002", item_summary: "4K monitor", order_total: 559, order_status: "Fulfilled" },
  { order_id: "ORD-1007", customer: "CUST-1001", item_summary: "Portable projector", order_total: 429, order_status: "Fulfilled" },
  { order_id: "ORD-1008", customer: "CUST-1002", item_summary: "Compact air purifier", order_total: 279, order_status: "Fulfilled" }
];

const returns: readonly ReturnFixture[] = [
  {
    stage: "draft",
    data: {
      customer: "CUST-1001",
      order: "ORD-1001",
      reason: "Changed Mind",
      details: "Unopened item. This case is ready for the agent acceptance journey.",
      requested_amount: 329,
      risk_score: 2
    }
  },
  {
    stage: "in-transit",
    data: {
      customer: "CUST-1002",
      order: "ORD-1002",
      reason: "Not as Described",
      details: "Material differs from the product page.",
      requested_amount: 189,
      risk_score: 4,
      tracking_number: "DEMO-TRACK-1002"
    }
  },
  {
    stage: "received",
    data: {
      customer: "CUST-1001",
      order: "ORD-1003",
      reason: "Damaged",
      details: "Outer case cracked during delivery.",
      requested_amount: 249,
      risk_score: 3,
      tracking_number: "DEMO-TRACK-1003",
      received_at: "2026-08-04T09:30:00.000Z"
    }
  },
  {
    stage: "pending-approval",
    inspection: "markPartial",
    data: {
      customer: "CUST-1002",
      order: "ORD-1004",
      reason: "Wrong Item",
      details: "Correct product family, wrong color variant.",
      requested_amount: 159,
      risk_score: 5,
      tracking_number: "DEMO-TRACK-1004",
      received_at: "2026-08-03T14:15:00.000Z",
      inspection_notes: "Item is usable, but packaging is missing.",
      deduction_amount: 20
    }
  },
  {
    stage: "refund-processing",
    inspection: "pass",
    data: {
      customer: "CUST-1001",
      order: "ORD-1005",
      reason: "Damaged",
      details: "Seat base arrived bent.",
      requested_amount: 699,
      approved_amount: 699,
      risk_score: 2,
      tracking_number: "DEMO-TRACK-1005",
      received_at: "2026-08-02T11:00:00.000Z",
      inspection_notes: "Confirmed carrier damage. Full refund approved.",
      scheduled_refund_at: "2026-08-06T03:00:00.000Z",
      refund_reference: "DEMO-REFUND-1005"
    }
  },
  {
    stage: "draft",
    data: {
      customer: "CUST-1002",
      order: "ORD-1006",
      reason: "Other",
      details: "High-value return with inconsistent intake details.",
      requested_amount: 559,
      risk_score: 9
    }
  }
];

export async function seedReturnsDemo(transport: ReturnsDemoTransport): Promise<ReturnsSeedSummary> {
  const created: string[] = [];
  const existing: string[] = [];
  const transitions: string[] = [];

  for (const customer of customers) {
    await ensureDocument(transport, "Customer", requiredString(customer.customer_id), customer, created, existing);
  }
  for (const order of orders) {
    await ensureDocument(transport, "Order", requiredString(order.order_id), order, created, existing);
  }
  for (const fixture of returns) {
    const document = await ensureReturnDocument(transport, fixture, created, existing);
    await progressReturn(transport, document.name, fixture, transitions);
  }

  return Object.freeze({
    created: Object.freeze(created),
    existing: Object.freeze(existing),
    transitions: Object.freeze(transitions)
  });
}

async function progressReturn(
  transport: ReturnsDemoTransport,
  name: string,
  fixture: ReturnFixture,
  transitions: string[]
): Promise<void> {
  if (fixture.stage === "draft") {
    return;
  }

  let document = await getDocument(transport, "Return Request", name);
  if (document.data.case_state === "Draft" && document.data.logistics_state === "Not Started") {
    document = await executeCommand(transport, document, "acceptReturn");
    transitions.push(`${name}:acceptReturn`);
  }
  if (fixture.stage === "in-transit" || fixture.stage === "received" || fixture.stage === "pending-approval" || fixture.stage === "refund-processing") {
    document = await transitionIfState(transport, document, "logistics", "Awaiting Shipment", "markInTransit", transitions);
  }
  if (fixture.stage === "in-transit") {
    return;
  }

  document = await transitionIfState(transport, document, "case", "Submitted", "startProcessing", transitions);
  document = await transitionIfState(transport, document, "logistics", "In Transit", "receive", transitions);
  if (fixture.stage === "received") {
    return;
  }

  if (fixture.inspection) {
    document = await transitionIfState(transport, document, "inspection", "Pending", fixture.inspection, transitions);
  }
  document = await transitionIfState(transport, document, "refund", "Not Eligible", "requestApproval", transitions);
  if (fixture.stage === "pending-approval") {
    return;
  }

  document = await transitionIfState(transport, document, "refund", "Pending Approval", "approve", transitions);
  await transitionIfState(transport, document, "refund", "Approved", "beginProcessing", transitions);
}

async function transitionIfState(
  transport: ReturnsDemoTransport,
  document: DocumentSnapshot,
  workflow: string,
  expectedState: string,
  action: string,
  transitions: string[]
): Promise<DocumentSnapshot> {
  const stateField = workflowStateField(workflow);
  if (document.data[stateField] !== expectedState) {
    return document;
  }
  const next = await callSnapshot(
    transport,
    `/api/resource/${encodeURIComponent(document.doctype)}/${encodeURIComponent(document.name)}/workflows/${encodeURIComponent(workflow)}/transition/${encodeURIComponent(action)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: document.version })
    }
  );
  transitions.push(`${document.name}:${workflow}.${action}`);
  return next;
}

async function executeCommand(
  transport: ReturnsDemoTransport,
  document: DocumentSnapshot,
  command: string
): Promise<DocumentSnapshot> {
  return await callSnapshot(
    transport,
    `/api/resource/${encodeURIComponent(document.doctype)}/${encodeURIComponent(document.name)}/command/${encodeURIComponent(command)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: document.version })
    }
  );
}

async function ensureDocument(
  transport: ReturnsDemoTransport,
  doctype: string,
  name: string,
  data: DocumentData,
  created: string[],
  existing: string[]
): Promise<void> {
  const current = await maybeGetDocument(transport, doctype, name);
  const key = `${doctype}/${name}`;
  if (current !== null) {
    existing.push(key);
    return;
  }
  await callSnapshot(transport, `/api/resource/${encodeURIComponent(doctype)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data)
  });
  created.push(key);
}

async function ensureReturnDocument(
  transport: ReturnsDemoTransport,
  fixture: ReturnFixture,
  created: string[],
  existing: string[]
): Promise<DocumentSnapshot> {
  const order = requiredString(fixture.data.order);
  const current = await findReturnByOrder(transport, order);
  if (current !== null) {
    existing.push(`Return Request/${current.name}`);
    return current;
  }
  const document = await callSnapshot(transport, "/api/resource/Return%20Request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fixture.data)
  });
  created.push(`Return Request/${document.name}`);
  return document;
}

async function findReturnByOrder(
  transport: ReturnsDemoTransport,
  order: string
): Promise<DocumentSnapshot | null> {
  const response = await transport.request(
    `/api/resource/Return%20Request?default_filters=0&filter_order=${encodeURIComponent(order)}&limit=1`
  );
  const body = await response.json() as {
    readonly data?: unknown;
    readonly error?: { readonly code?: unknown; readonly message?: unknown };
  };
  if (!response.ok) {
    const message = typeof body.error?.message === "string" ? body.error.message : "Could not query seeded returns";
    throw new Error(message);
  }
  if (!Array.isArray(body.data)) {
    throw new Error("Return query returned an invalid response");
  }
  const [document] = body.data;
  return document === undefined ? null : isDocumentSnapshot(document) ? document : null;
}

async function getDocument(
  transport: ReturnsDemoTransport,
  doctype: string,
  name: string
): Promise<DocumentSnapshot> {
  const document = await maybeGetDocument(transport, doctype, name);
  if (document === null) {
    throw new Error(`Seeded document ${doctype}/${name} was not found`);
  }
  return document;
}

async function maybeGetDocument(
  transport: ReturnsDemoTransport,
  doctype: string,
  name: string
): Promise<DocumentSnapshot | null> {
  const response = await transport.request(
    `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`
  );
  if (response.status === 404) {
    return null;
  }
  return await snapshotFromResponse(response);
}

async function callSnapshot(
  transport: ReturnsDemoTransport,
  path: string,
  init: RequestInit
): Promise<DocumentSnapshot> {
  return await snapshotFromResponse(await transport.request(path, init));
}

async function snapshotFromResponse(response: Response): Promise<DocumentSnapshot> {
  const body = await response.json() as { readonly data?: unknown; readonly error?: { readonly code?: unknown; readonly message?: unknown } };
  if (!response.ok) {
    const code = typeof body.error?.code === "string" ? body.error.code : "SEED_REQUEST_FAILED";
    const message = typeof body.error?.message === "string" ? body.error.message : `Request failed with ${String(response.status)}`;
    throw new Error(`${code}: ${message}`);
  }
  if (!isDocumentSnapshot(body.data)) {
    throw new Error("Seed request returned an invalid document snapshot");
  }
  return body.data;
}

function isDocumentSnapshot(value: unknown): value is DocumentSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.doctype === "string" &&
    typeof record.name === "string" &&
    typeof record.version === "number" &&
    typeof record.data === "object" && record.data !== null && !Array.isArray(record.data);
}

function workflowStateField(workflow: string): string {
  const fields: Readonly<Record<string, string>> = {
    case: "case_state",
    logistics: "logistics_state",
    inspection: "inspection_state",
    refund: "refund_state"
  };
  const field = fields[workflow];
  if (field === undefined) {
    throw new Error(`Unsupported seed workflow '${workflow}'`);
  }
  return field;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Seed fixture requires a non-empty name");
  }
  return value;
}
