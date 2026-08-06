import { DEFAULT_TENANT_ID, type Actor, type DocumentData, type DocumentSnapshot } from "../../src";
import { readBoundedText } from "../../src/adapters/http/request";
import { PUBLIC_RETURN_INTAKE_ROLE } from "./models";

export const PUBLIC_RETURN_INTAKE_PATH = "/web-forms/returns/intake";
export const PUBLIC_RETURN_INTAKE_MAX_BYTES = 8_192;

const CUSTOMER_ID_PATTERN = /^CUST-[0-9]{4,12}$/;
const ORDER_ID_PATTERN = /^ORD-[0-9]{4,12}$/;
const DECIMAL_AMOUNT_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/;
const FORM_FIELDS = Object.freeze([
  "customer",
  "order",
  "reason",
  "details",
  "requested_amount"
] as const);
const FORM_FIELD_SET = new Set<string>(FORM_FIELDS);
const RETURN_REASONS = new Set([
  "Damaged",
  "Wrong Item",
  "Not as Described",
  "Changed Mind",
  "Other"
]);

export const publicReturnIntakeActor: Actor = Object.freeze({
  id: "public-return-intake@internal",
  roles: Object.freeze(["Guest", PUBLIC_RETURN_INTAKE_ROLE]),
  tenantId: DEFAULT_TENANT_ID
});

export interface PublicReturnIntakeProjectionReader {
  get(tenantId: string, doctype: string, name: string): Promise<DocumentSnapshot | null>;
}

export interface VerifiedPublicReturnIntake {
  readonly body: string;
  readonly data: DocumentData;
}

export class PublicReturnIntakeBoundary {
  readonly #verifiedRequests = new WeakSet<Request>();

  actorForRequest(request: Request): Actor | undefined {
    return this.#verifiedRequests.has(request) ? publicReturnIntakeActor : undefined;
  }

  async handle(
    request: Request,
    projections: PublicReturnIntakeProjectionReader,
    forward: (request: Request) => Promise<Response>
  ): Promise<Response> {
    const verified = await verifyPublicReturnIntake(request, projections);
    if (verified === null) {
      return publicIntakeFailure();
    }
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
    headers.delete("content-length");
    const internalRequest = new Request(request.url, {
      method: "POST",
      headers,
      body: verified.body
    });
    this.#verifiedRequests.add(internalRequest);
    try {
      const response = await forward(internalRequest);
      return response.status < 400 ? response : publicIntakeFailure();
    } catch {
      return publicIntakeFailure();
    } finally {
      this.#verifiedRequests.delete(internalRequest);
    }
  }
}

export async function verifyPublicReturnIntake(
  request: Request,
  projections: PublicReturnIntakeProjectionReader
): Promise<VerifiedPublicReturnIntake | null> {
  try {
    if (request.method.toUpperCase() !== "POST" || !isUrlEncoded(request.headers.get("content-type"))) {
      return null;
    }
    const raw = await readBoundedText(
      request,
      PUBLIC_RETURN_INTAKE_MAX_BYTES,
      "Return intake body is too large"
    );
    if (raw.length === 0 || hasMalformedPercentEncoding(raw)) {
      return null;
    }
    const form = new URLSearchParams(raw);
    if (!hasOnlyKnownSingleValueFields(form)) {
      return null;
    }

    const customerId = normalizedId(singleRequiredValue(form, "customer"), CUSTOMER_ID_PATTERN);
    const orderId = normalizedId(singleRequiredValue(form, "order"), ORDER_ID_PATTERN);
    const reason = trimmedRequiredValue(form, "reason");
    const details = singleOptionalValue(form, "details")?.trim();
    const amountText = trimmedRequiredValue(form, "requested_amount");
    if (
      customerId === null ||
      orderId === null ||
      reason === null ||
      !RETURN_REASONS.has(reason) ||
      (details !== undefined && (details.length > 2_000 || hasUnsafeControlCharacter(details))) ||
      amountText === null ||
      !DECIMAL_AMOUNT_PATTERN.test(amountText)
    ) {
      return null;
    }

    const requestedAmount = Number(amountText);
    if (requestedAmount <= 0) {
      return null;
    }
    const [customer, order] = await Promise.all([
      projections.get(DEFAULT_TENANT_ID, "Customer", customerId),
      projections.get(DEFAULT_TENANT_ID, "Order", orderId)
    ]);
    if (
      !isActiveDocument(customer) ||
      !isActiveDocument(order) ||
      order.data.customer !== customerId ||
      order.data.has_open_return === true ||
      typeof order.data.order_total !== "number" ||
      !Number.isFinite(order.data.order_total) ||
      requestedAmount > order.data.order_total
    ) {
      return null;
    }

    const data: DocumentData = Object.freeze({
      customer: customerId,
      order: orderId,
      reason,
      ...(details === undefined || details.length === 0 ? {} : { details }),
      requested_amount: requestedAmount
    });
    return Object.freeze({
      body: normalizedFormBody(data),
      data
    });
  } catch {
    return null;
  }
}

function isUrlEncoded(contentType: string | null): boolean {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/x-www-form-urlencoded";
}

function hasOnlyKnownSingleValueFields(form: URLSearchParams): boolean {
  for (const key of form.keys()) {
    if (!FORM_FIELD_SET.has(key) || form.getAll(key).length !== 1) {
      return false;
    }
  }
  return true;
}

function singleRequiredValue(form: URLSearchParams, field: string): string | null {
  const values = form.getAll(field);
  return values.length === 1 ? values[0] ?? null : null;
}

function singleOptionalValue(form: URLSearchParams, field: string): string | undefined {
  const values = form.getAll(field);
  return values[0];
}

function trimmedRequiredValue(form: URLSearchParams, field: string): string | null {
  const value = singleRequiredValue(form, field)?.trim();
  return value ? value : null;
}

function normalizedId(value: string | null, pattern: RegExp): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return pattern.test(normalized) ? normalized : null;
}

function hasMalformedPercentEncoding(value: string): boolean {
  for (let index = value.indexOf("%"); index >= 0; index = value.indexOf("%", index + 1)) {
    if (!/^[0-9A-Fa-f]{2}$/.test(value.slice(index + 1, index + 3))) {
      return true;
    }
  }
  return false;
}

function hasUnsafeControlCharacter(value: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

function isActiveDocument(document: DocumentSnapshot | null): document is DocumentSnapshot {
  return document !== null && document.docstatus !== "deleted";
}

function normalizedFormBody(data: DocumentData): string {
  const form = new URLSearchParams();
  for (const field of FORM_FIELDS) {
    const value = data[field];
    if (typeof value === "string" || typeof value === "number") {
      form.append(field, String(value));
    }
  }
  return form.toString();
}

function publicIntakeFailure(): Response {
  return new Response("Unable to verify this return request. Check the submitted details and try again.", {
    status: 400,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
