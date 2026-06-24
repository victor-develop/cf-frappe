import type { PrintSettingsService } from "../../application/print-settings-service.js";
import type { PrintLayoutDefinition } from "../../core/print-format.js";
import type { Actor } from "../../core/types.js";

export async function defaultPrintLayoutFor(
  printSettings: PrintSettingsService | undefined,
  actor: Actor
): Promise<PrintLayoutDefinition | undefined> {
  return (await printSettings?.defaultsFor(actor))?.settings.defaultLayout;
}
