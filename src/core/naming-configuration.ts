import { domainEventPayloadKind } from "./domain-events.js";
import { FrameworkError } from "./errors.js";
import { normalizeNamingStrategy } from "./naming.js";
import type {
  DocTypeDefinition,
  DomainEvent,
  NamingStrategy,
  TenantId
} from "./types.js";

export type NamingConfigurationPayloadKind = "NamingStrategySaved" | "NamingStrategyCleared";

export type NamingConfigurationEventPayload =
  | {
      readonly kind: "NamingStrategySaved";
      readonly doctypeName: string;
      readonly strategy: NamingStrategy;
    }
  | {
      readonly kind: "NamingStrategyCleared";
      readonly doctypeName: string;
    };

export const NAMING_CONFIGURATION_PAYLOAD_KINDS = Object.freeze([
  "NamingStrategySaved",
  "NamingStrategyCleared"
] as const satisfies readonly NamingConfigurationPayloadKind[]);

const NAMING_CONFIGURATION_PAYLOAD_KIND_SET = new Set<string>(NAMING_CONFIGURATION_PAYLOAD_KINDS);

export interface NamingConfigurationState {
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly version: number;
  readonly staticStrategy?: NamingStrategy;
  readonly runtimeStrategy?: NamingStrategy;
  readonly effectiveStrategy?: NamingStrategy;
  readonly source: "default" | "static" | "runtime";
  readonly updatedAt?: string;
}

export function foldNamingConfiguration(
  tenantId: TenantId,
  doctype: DocTypeDefinition,
  events: readonly DomainEvent[]
): NamingConfigurationState {
  return foldNamingConfigurationFrom(null, tenantId, doctype, events);
}

export function foldNamingConfigurationFrom(
  initial: NamingConfigurationState | null,
  tenantId: TenantId,
  doctype: DocTypeDefinition,
  events: readonly DomainEvent[]
): NamingConfigurationState {
  let runtimeStrategy: NamingStrategy | undefined = initial?.runtimeStrategy;
  let version = initial?.version ?? 0;
  let updatedAt: string | undefined = initial?.updatedAt;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (!isNamingConfigurationEvent(event) || event.payload.doctypeName !== doctype.name) {
      continue;
    }
    version = Math.max(version, event.sequence);
    updatedAt = event.occurredAt;
    runtimeStrategy = event.payload.kind === "NamingStrategySaved" ? event.payload.strategy : undefined;
  }
  const effectiveStrategy = runtimeStrategy ?? doctype.naming;
  return Object.freeze({
    tenantId,
    doctype: doctype.name,
    version,
    ...(doctype.naming === undefined ? {} : { staticStrategy: doctype.naming }),
    ...(runtimeStrategy === undefined ? {} : { runtimeStrategy }),
    ...(effectiveStrategy === undefined ? {} : { effectiveStrategy }),
    source: runtimeStrategy === undefined ? doctype.naming === undefined ? "default" : "static" : "runtime",
    ...(updatedAt === undefined ? {} : { updatedAt })
  });
}

export function applyNamingConfigurationToDocType(
  base: DocTypeDefinition,
  state: NamingConfigurationState
): DocTypeDefinition {
  if (base.name !== state.doctype) {
    throw new FrameworkError(
      "NAMING_INVALID",
      `Naming configuration for '${state.doctype}' cannot be applied to DocType '${base.name}'`,
      { status: 400 }
    );
  }
  const { naming: _existing, ...withoutNaming } = base;
  const effectiveStrategy = state.effectiveStrategy === undefined
    ? undefined
    : normalizeNamingStrategy(base, state.effectiveStrategy);
  return Object.freeze({
    ...withoutNaming,
    ...(effectiveStrategy === undefined ? {} : { naming: effectiveStrategy })
  });
}

export function isNamingConfigurationPayloadKind(kind: string): kind is NamingConfigurationPayloadKind {
  return NAMING_CONFIGURATION_PAYLOAD_KIND_SET.has(kind);
}

export function isNamingConfigurationEvent(
  event: DomainEvent
): event is DomainEvent<NamingConfigurationEventPayload> {
  return isNamingConfigurationPayloadKind(domainEventPayloadKind(event));
}
