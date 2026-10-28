/**
 * Naming helpers shared by everything that derives a SQL identifier from
 * metadata: projection index names, migration ids and typed projection tables.
 * One copy, so a name planned in one module is the name looked up in another.
 */

/** Lower-case `[a-z0-9_]` form of a metadata name, e.g. `Sales Order` -> `sales_order`. */
export function sqlSlug(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_+|_+$/g, "");
}

/** 32-bit FNV-1a as eight hex digits. Stable across runtimes; not a security hash. */
export function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
