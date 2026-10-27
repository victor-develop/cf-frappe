import { FrameworkError } from "../../core/errors.js";
import type { JobDefinition, JobPayload } from "../../core/jobs.js";
import type { TenantId } from "../../core/types.js";

export const TENANT_MOVE_ADVANCE_JOB_NAME = "cf-frappe.tenant-move.advance";
export const DEFAULT_TENANT_MOVE_ADVANCE_STEPS = 10;
export const MAX_TENANT_MOVE_ADVANCE_STEPS = 50;

/** What the job needs of a mover: `D1TenantMover` is one. */
export interface TenantMoveAdvancer {
  activeMove(tenantId: TenantId): Promise<{ readonly moveId: string } | null>;
  advance(moveId: string): Promise<{ readonly moveId: string; readonly phase: string; readonly state: unknown }>;
}

export interface TenantMoveAdvanceJobResources {
  readonly tenantShards?: { readonly mover: TenantMoveAdvancer };
}

/**
 * Advances the job tenant's move in progress by up to `steps` bounded steps
 * (`payload.steps`, 10 by default). Schedule it per tenant being moved, the
 * way the projection drain is scheduled, or dispatch it on demand. With no move
 * in progress it does nothing, so a schedule left behind after a move is
 * harmless.
 *
 * Each step is a handful of D1 queries — see `D1TenantMover` — so the default
 * stays well inside the per-invocation query limit on Workers Paid; lower
 * `steps` (and the mover's `pagesPerAdvance`) on Workers Free.
 */
export function createTenantMoveAdvanceJob<
  TResources extends TenantMoveAdvanceJobResources = TenantMoveAdvanceJobResources
>(options: { readonly name?: string } = {}): JobDefinition<JobPayload, TResources> {
  return {
    name: options.name ?? TENANT_MOVE_ADVANCE_JOB_NAME,
    description: "Advance a cf-frappe tenant's move between shards",
    retry: { maxAttempts: 3, baseDelaySeconds: 10, maxDelaySeconds: 120 },
    async handler({ tenantId, payload, resources }) {
      const mover = resources.tenantShards?.mover;
      if (mover === undefined) {
        throw new FrameworkError("JOB_RESOURCE_INVALID", "Tenant sharding is not configured", { status: 500 });
      }
      if (tenantId === undefined) {
        throw new FrameworkError("JOB_RESOURCE_INVALID", `${TENANT_MOVE_ADVANCE_JOB_NAME} needs a tenant`, { status: 400 });
      }
      const steps = advanceSteps(payload.steps);
      const active = await mover.activeMove(tenantId);
      if (active === null) {
        return { tenantId, moving: false };
      }
      let move = await mover.advance(active.moveId);
      for (let step = 1; step < steps && move.phase !== "completed" && move.phase !== "aborted"; step += 1) {
        move = await mover.advance(active.moveId);
      }
      return { tenantId, moving: move.phase !== "completed" && move.phase !== "aborted", moveId: move.moveId, phase: move.phase };
    }
  };
}

function advanceSteps(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_TENANT_MOVE_ADVANCE_STEPS;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > MAX_TENANT_MOVE_ADVANCE_STEPS) {
    throw new FrameworkError(
      "JOB_RESOURCE_INVALID",
      `${TENANT_MOVE_ADVANCE_JOB_NAME} steps must be an integer between 1 and ${MAX_TENANT_MOVE_ADVANCE_STEPS}`,
      { status: 400 }
    );
  }
  return value;
}
