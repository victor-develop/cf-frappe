import {
  definePrintLayout,
  type PrintLayoutDefinition
} from "./print-format.js";
import { domainEventPayloadKind } from "./domain-events.js";
import type { DocumentData, DomainEvent, TenantId } from "./types.js";

export type PrintSettingsStatePayloadKind = "PrintSettingsChanged";

export interface PrintSettingsStateEventPayload {
  readonly kind: "PrintSettingsChanged";
  readonly settings: DocumentData;
}

export const PRINT_SETTINGS_STATE_PAYLOAD_KINDS = Object.freeze([
  "PrintSettingsChanged"
] as const satisfies readonly PrintSettingsStatePayloadKind[]);

const PRINT_SETTINGS_STATE_PAYLOAD_KIND_SET = new Set<string>(PRINT_SETTINGS_STATE_PAYLOAD_KINDS);

export interface PrintSettings {
  readonly defaultLayout?: PrintLayoutDefinition;
}

export interface PrintSettingsPatch {
  readonly defaultLayout?: PrintLayoutDefinition | null;
}

export interface PrintSettingsInput {
  readonly defaultLayout?: PrintLayoutDefinition | null;
}

export interface PrintSettingsState {
  readonly tenantId: TenantId;
  readonly version: number;
  readonly settings: PrintSettings;
  readonly updatedAt?: string;
}

export function foldPrintSettings(tenantId: TenantId, events: readonly DomainEvent[]): PrintSettingsState {
  let state: PrintSettingsState = {
    tenantId,
    version: 0,
    settings: {}
  };
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (!isPrintSettingsStateEvent(event)) {
      continue;
    }
    state = {
      tenantId,
      version: event.sequence,
      settings: applyPrintSettingsPatch(state.settings, normalizePrintSettingsPatch(event.payload.settings)),
      updatedAt: event.occurredAt
    };
  }
  return state;
}

export function printSettingsStateEventType(payload: PrintSettingsStateEventPayload): PrintSettingsStatePayloadKind {
  return payload.kind;
}

export function isPrintSettingsStatePayloadKind(kind: string): kind is PrintSettingsStatePayloadKind {
  return PRINT_SETTINGS_STATE_PAYLOAD_KIND_SET.has(kind);
}

function isPrintSettingsStateEvent(
  event: DomainEvent
): event is DomainEvent & { readonly payload: PrintSettingsStateEventPayload } {
  return isPrintSettingsStatePayloadKind(domainEventPayloadKind(event));
}

export function normalizePrintSettingsPatch(input: Record<string, unknown>): PrintSettingsPatch {
  const unknownField = Object.keys(input).find((field) => field !== "defaultLayout");
  if (unknownField) {
    throw new Error(`Unknown print settings field '${unknownField}'`);
  }
  if (!Object.prototype.hasOwnProperty.call(input, "defaultLayout")) {
    return {};
  }
  const defaultLayout = input.defaultLayout;
  if (defaultLayout === null) {
    return { defaultLayout: null };
  }
  if (defaultLayout === undefined) {
    return {};
  }
  if (!isRecord(defaultLayout)) {
    throw new Error("defaultLayout must be an object or null");
  }
  return {
    defaultLayout: definePrintLayout(defaultLayout as PrintLayoutDefinition, "Print settings")
  };
}

export function applyPrintSettingsPatch(settings: PrintSettings, patch: PrintSettingsPatch): PrintSettings {
  if (!Object.prototype.hasOwnProperty.call(patch, "defaultLayout")) {
    return settings;
  }
  if (patch.defaultLayout === null) {
    const { defaultLayout: _defaultLayout, ...withoutDefaultLayout } = settings;
    return withoutDefaultLayout;
  }
  return {
    ...settings,
    ...(patch.defaultLayout === undefined ? {} : { defaultLayout: patch.defaultLayout })
  };
}

export function printSettingsPatchData(patch: PrintSettingsPatch): DocumentData {
  const data: DocumentData = {};
  if (Object.prototype.hasOwnProperty.call(patch, "defaultLayout")) {
    data.defaultLayout = patch.defaultLayout === undefined || patch.defaultLayout === null
      ? null
      : (patch.defaultLayout as unknown as DocumentData);
  }
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
