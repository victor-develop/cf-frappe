/**
 * `msgprint` / `throw` alerts, ported verbatim from the legacy desk client string
 * (window.alert bridge). Behavior parity: stringify the message (empty string for
 * null/undefined), surface it through `window.alert` when available, and return it;
 * `throwMessage` additionally throws an `Error` carrying the same text.
 *
 * `namespace.ts` currently carries an identical core copy (exposed as
 * `cfFrappe.msgprint` / `cfFrappe.throw` / `cfFrappe.ui.msgprint` and
 * `coreSeam.msgprint`); this module is the standalone home the flip can point the
 * namespace at without pulling in the full core assembly.
 */

export function msgprint(message: unknown): string {
  const text = message == null ? "" : String(message);
  if (typeof window.alert === "function") {
    window.alert(text);
  }
  return text;
}

export function throwMessage(message: unknown): never {
  const text = msgprint(message);
  throw new Error(text);
}
