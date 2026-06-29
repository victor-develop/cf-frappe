import type { SavedReport, SavedReportDefinition } from "./saved-report-events.js";
import type { TenantId } from "../core/types.js";

export type SavedReportWriteDecision =
  | { readonly status: "missing"; readonly message: string }
  | { readonly status: "write" };

export function findSavedReport(
  reports: readonly SavedReport[],
  id: string
): SavedReport | undefined {
  return reports.find((report) => report.id === id);
}

export function planSavedReportSave(
  existing: SavedReport | undefined,
  requestedId: string | undefined
): SavedReportWriteDecision {
  return requestedId !== undefined && existing === undefined
    ? { status: "missing", message: `Saved report '${requestedId}' was not found` }
    : { status: "write" };
}

export function planSavedReportDelete(
  existing: SavedReport | undefined,
  id: string
): SavedReportWriteDecision {
  return existing === undefined
    ? { status: "missing", message: `Saved report '${id}' was not found` }
    : { status: "write" };
}

export function projectSavedReportSave(input: {
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly id: string;
  readonly label: string;
  readonly ownerId: string;
  readonly definition: SavedReportDefinition;
  readonly existing?: SavedReport | undefined;
  readonly now: string;
}): SavedReport {
  return {
    tenantId: input.tenantId,
    doctype: input.doctype,
    id: input.id,
    label: input.label,
    ownerId: input.ownerId,
    definition: input.definition,
    createdAt: input.existing?.createdAt ?? input.now,
    updatedAt: input.now
  };
}
