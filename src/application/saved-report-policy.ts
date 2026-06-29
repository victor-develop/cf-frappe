import type { SavedReport, SavedReportDefinition } from "./saved-report-events.js";
import { can } from "../core/permissions.js";
import type { Actor, DocTypeDefinition, TenantId } from "../core/types.js";

export type SavedReportWriteDecision =
  | { readonly status: "missing"; readonly message: string }
  | { readonly status: "write" };

export type SavedReportLookupDecision =
  | { readonly status: "found"; readonly report: SavedReport }
  | { readonly status: "missing"; readonly message: string };

export type SavedReportReadAccessDecision =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly message: string };

export function findSavedReport(
  reports: readonly SavedReport[],
  id: string
): SavedReport | undefined {
  return reports.find((report) => report.id === id);
}

export function planSavedReportReadAccess(command: {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
}): SavedReportReadAccessDecision {
  if (!can(command.actor, command.doctype, "read")) {
    return {
      status: "deny",
      message: `Actor '${command.actor.id}' cannot read ${command.doctype.name}`
    };
  }
  return { status: "allow" };
}

export function planSavedReportLookup(
  report: SavedReport | undefined,
  id: string
): SavedReportLookupDecision {
  return report === undefined
    ? { status: "missing", message: `Saved report '${id}' was not found` }
    : { status: "found", report };
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
