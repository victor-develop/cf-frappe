import { FrameworkError, type FrameworkErrorCode } from "./errors.js";

/**
 * Which store a report or dashboard reads from (issue #16, phase T4 of #5).
 *
 * `operational` is the D1 projection every list, form and link lookup already
 * reads. `analytical` is a copy of that projection exported to R2 (or to any
 * other {@link AnalyticsDocumentReader}) so a wide aggregation does not scan
 * the single-writer database that serves the Desk.
 *
 * The declaration is a request, not a switch: an `analytical` report still runs
 * on the operational projection when the deployment has not configured an
 * analytics store. That is what keeps the mode off by default — a model that
 * declares it behaves exactly as before until someone wires the store in.
 */
export type QueryPath = "operational" | "analytical";

export const QUERY_PATHS = Object.freeze(["operational", "analytical"] as const satisfies readonly QueryPath[]);

export const DEFAULT_QUERY_PATH: QueryPath = "operational";

export function isQueryPath(value: unknown): value is QueryPath {
  return typeof value === "string" && (QUERY_PATHS as readonly string[]).includes(value);
}

export function isAnalyticalQueryPath(value: QueryPath | undefined): boolean {
  return value === "analytical";
}

export function assertQueryPath(
  value: unknown,
  context: string,
  code: FrameworkErrorCode
): asserts value is QueryPath | undefined {
  if (value === undefined || isQueryPath(value)) {
    return;
  }
  throw new FrameworkError(
    code,
    `${context} has invalid queryPath '${String(value)}'; expected one of ${QUERY_PATHS.join(", ")}`,
    { status: 400 }
  );
}
