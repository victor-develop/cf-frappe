/**
 * The marker the tenant fence trigger raises (issue #14). See
 * `D1_TENANT_SHARD_SCHEMA_STATEMENTS`. D1 reports it as
 * `D1_ERROR: CF_FRAPPE_TENANT_FENCED: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)`.
 */
export const D1_TENANT_FENCED_MARKER = "CF_FRAPPE_TENANT_FENCED";

/**
 * A write refused because its tenant has been fenced on this database — it is
 * being, or has been, moved to another shard.
 *
 * Distinguished from a constraint error on purpose. Both arrive as
 * `SQLITE_CONSTRAINT`, but a constraint error means "the stream moved, re-read
 * and retry", which is wrong here: re-reading this database would find the
 * same version and fail the same way forever. A fenced write has to be retried
 * against wherever the tenant lives now.
 */
export function isD1TenantFencedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(D1_TENANT_FENCED_MARKER);
}

export function isD1ConstraintError(error: unknown): boolean {
  return error instanceof Error && !isD1TenantFencedError(error) && /constraint|unique/i.test(error.message);
}
