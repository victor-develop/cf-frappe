import {
  foldPrintSettings,
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
  printSettingsEventType,
  PRINT_SETTINGS_PAYLOAD_KINDS,
  type PrintSettingsEventPayload
} from "./print-settings-events.js";
import {
  authorizePrintSettingsAdministration,
  ensurePrintSettingsExpectedVersion,
  normalizePrintSettingsPatchInput
} from "./print-settings-policy.js";
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
    return this.stateFor(this.authorizeAdministration(actor, tenantId));
  }

  async defaultsFor(actor: Actor): Promise<PrintSettingsState> {
    return this.stateFor(actor.tenantId ?? DEFAULT_TENANT_ID);
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): TenantId {
    return authorizePrintSettingsAdministration({ actor, tenantId, adminRoles: this.adminRoles });
  }

  async change(command: ChangePrintSettingsCommand): Promise<PrintSettingsState> {
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    const patch = normalizePrintSettingsPatchInput(command.settings);
    const state = await this.stateFor(tenantId);
    ensurePrintSettingsExpectedVersion(state, command.expectedVersion);
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
      ...(await this.events.readStream(printSettingsStream(tenantId), {
        maxSequence: state.version,
        payloadKinds: PRINT_SETTINGS_PAYLOAD_KINDS
      })),
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
    const payload = printSettingsChangedPayload({ settings: printSettingsPatchData(options.settings) });
    const event: NewDomainEvent<PrintSettingsEventPayload> = {
      id: this.ids.next("evt_"),
      tenantId: options.tenantId,
      stream,
      type: printSettingsEventType(payload),
      doctype: "__PrintSettings",
      documentName: "settings",
      actorId: options.actorId,
      occurredAt: this.clock.now(),
      payload,
      metadata: options.metadata ?? {}
    };
    return this.events.append(stream, options.expectedVersion, [event]);
  }

  private async stateFor(tenantId: TenantId): Promise<PrintSettingsState> {
    return foldPrintSettings(tenantId, await this.events.readStream(printSettingsStream(tenantId), {
      payloadKinds: PRINT_SETTINGS_PAYLOAD_KINDS
    }));
  }
}
