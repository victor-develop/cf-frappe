import type { DocumentSnapshot, TenantId } from "../core/types.js";

export interface AutomationRunClaimStore {
  listAutomationRunClaimCandidates(query: {
    readonly tenantId: TenantId;
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly DocumentSnapshot[]>;
}

export function isAutomationRunClaimStore(value: unknown): value is AutomationRunClaimStore {
  return typeof value === "object" &&
    value !== null &&
    "listAutomationRunClaimCandidates" in value &&
    typeof (value as { readonly listAutomationRunClaimCandidates?: unknown }).listAutomationRunClaimCandidates === "function";
}
