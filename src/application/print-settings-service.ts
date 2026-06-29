import { FrameworkError, badRequest, conflict, permissionDenied } from "../core/errors.js";
import {
  foldPrintSettings,
  normalizePrintSettingsPatch,
  printSettingsPatchData,
  type PrintSettingsInput,
  type PrintSettingsPatch,
  type PrintSettingsState
} from "../core/print-settings.js";
import { printSettingsStream } from "../core/streams.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type DomainEvent,
  type NewDomainEvent,
  type TenantId
} from "../core/types.js";
import {
  printSettingsChangedPayload,
  type PrintSettingsEventPayload
} from "./print-settings-events.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";

export type { PrintSettingsEventPayload } from "./print-settings-events.js";

export interface PrintSettingsServiceOptions {
  readonly events: EventStore;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly adminRoles?: readonly string[];
}

export interface ChangePrintSettingsCommand {
  readonly actor: Actor;
  readonly settings: PrintSettingsInput | Record<string, unknown>;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export class PrintSettingsService {
  private readonly events: EventStore;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];

  constructor(options: PrintSettingsServiceOptions) {
    this.events = options.events;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
  }

  async get(actor: Actor, tenantId?: TenantId): Promise<PrintSettingsState> {
    this.authorizeAdministration(actor, tenantId);
    return this.stateFor(resolveActorTenant(actor, tenantId));
  }

  async defaultsFor(actor: Actor): Promise<PrintSettingsState> {
    return this.stateFor(actor.tenantId ?? DEFAULT_TENANT_ID);
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): void {
    this.ensureAdmin(actor);
    resolveActorTenant(actor, tenantId);
  }

  async change(command: ChangePrintSettingsCommand): Promise<PrintSettingsState> {
    this.ensureAdmin(command.actor);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const patch = normalizeSettingsPatch(command.settings);
    const state = await this.stateFor(tenantId);
    ensureExpectedVersion(state, command.expectedVersion);
    if (Object.keys(patch).length === 0) {
      return state;
    }
    const saved = await this.appendSettingsChangedEvent({
      tenantId,
      expectedVersion: state.version,
      actorId: command.actor.id,
      metadata: command.metadata,
      settings: patch
    });
    return foldPrintSettings(tenantId, [
      ...(await this.events.readStream(printSettingsStream(tenantId), { maxSequence: state.version })),
      ...saved
    ]);
  }

  private async appendSettingsChangedEvent(options: {
    readonly tenantId: TenantId;
    readonly expectedVersion: number;
    readonly actorId: string;
    readonly metadata: DocumentData | undefined;
    readonly settings: PrintSettingsPatch;
  }): Promise<readonly DomainEvent[]> {
    const stream = printSettingsStream(options.tenantId);
    const event: NewDomainEvent<PrintSettingsEventPayload> = {
      id: this.ids.next("evt_"),
      tenantId: options.tenantId,
      stream,
      type: "PrintSettingsChanged",
      doctype: "__PrintSettings",
      documentName: "settings",
      actorId: options.actorId,
      occurredAt: this.clock.now(),
      payload: printSettingsChangedPayload({ settings: printSettingsPatchData(options.settings) }),
      metadata: options.metadata ?? {}
    };
    return this.events.append(stream, options.expectedVersion, [event]);
  }

  private async stateFor(tenantId: TenantId): Promise<PrintSettingsState> {
    return foldPrintSettings(tenantId, await this.events.readStream(printSettingsStream(tenantId)));
  }

  private ensureAdmin(actor: Actor): void {
    if (!this.adminRoles.some((role) => actor.roles.includes(role))) {
      throw permissionDenied(`Actor '${actor.id}' cannot manage print settings`);
    }
  }
}

function resolveActorTenant(actor: Actor, explicitTenantId: TenantId | undefined): TenantId {
  const actorTenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = explicitTenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${actor.id}' cannot manage print settings for tenant '${tenantId}'`);
  }
  return tenantId;
}

function normalizeSettingsPatch(input: PrintSettingsInput | Record<string, unknown>): PrintSettingsPatch {
  try {
    return normalizePrintSettingsPatch(input as Record<string, unknown>);
  } catch (error) {
    if (error instanceof FrameworkError) {
      throw error;
    }
    throw badRequest(error instanceof Error ? error.message : "Print settings are invalid");
  }
}

function ensureExpectedVersion(state: PrintSettingsState, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected print settings at version ${expectedVersion}, found ${state.version}`);
  }
}
