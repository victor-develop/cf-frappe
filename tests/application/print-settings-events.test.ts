import {
  isPrintSettingsEvent,
  isPrintSettingsPayloadKind,
  printSettingsChangedPayload,
  printSettingsEventType,
  PRINT_SETTINGS_PAYLOAD_KINDS
} from "../../src";
import type { DomainEvent, PrintSettingsEventPayload } from "../../src";

describe("print settings events", () => {
  it("builds print settings change payloads", () => {
    expect(printSettingsPayload(printSettingsChangedPayload({
      settings: {
        defaultLayout: {
          pageSize: "A4",
          orientation: "landscape"
        }
      }
    }))).toEqual({
      kind: "PrintSettingsChanged",
      settings: {
        defaultLayout: {
          pageSize: "A4",
          orientation: "landscape"
        }
      }
    });
  });

  it("derives print settings event types from payload identity", () => {
    expect(printSettingsEventType(printSettingsChangedPayload({
      settings: { defaultLayout: null }
    }))).toBe("PrintSettingsChanged");
  });

  it("exposes the bounded print settings payload kind set", () => {
    expect(PRINT_SETTINGS_PAYLOAD_KINDS).toEqual(["PrintSettingsChanged"]);
  });

  it("narrows print settings events by payload kind when event type names are custom", () => {
    const changed = {
      ...event(printSettingsChangedPayload({ settings: { defaultLayout: null } })),
      type: "TenantPrintDefaultsUpdated"
    };

    expect(isPrintSettingsPayloadKind("PrintSettingsChanged")).toBe(true);
    expect(isPrintSettingsPayloadKind("DocumentDeleted")).toBe(false);
    expect(isPrintSettingsEvent(changed)).toBe(true);
    expect(isPrintSettingsEvent(event({ kind: "DocumentDeleted" }))).toBe(false);
  });
});

function printSettingsPayload(payload: PrintSettingsEventPayload): PrintSettingsEventPayload {
  return payload;
}

function event(payload: DomainEvent["payload"], type: string = payload.kind): DomainEvent {
  return {
    id: "evt_print_settings",
    tenantId: "acme",
    stream: "acme:__PrintSettings",
    sequence: 1,
    type,
    doctype: "__PrintSettings",
    documentName: "settings",
    actorId: "admin@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload,
    metadata: {}
  };
}
