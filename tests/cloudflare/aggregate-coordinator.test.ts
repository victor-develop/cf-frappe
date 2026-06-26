import { EmailNotificationService, type EventStore } from "../../src";
import { createAggregateCoordinatorClass } from "../../src/cloudflare";
import { createTestRegistry } from "../helpers";

describe("createAggregateCoordinatorClass", () => {
  it("wires email notifications with the aggregate event store and notification rule service", () => {
    let captured: { readonly events: EventStore; readonly notificationRules: unknown } | undefined;
    const AggregateCoordinator = createAggregateCoordinatorClass({
      registry: createTestRegistry(),
      emailNotifications(_env, services) {
        captured = services;
        return new EmailNotificationService({
          events: services.events,
          sender: { async send() { return {}; } },
          from: { email: "notifications@example.com" },
          notificationRules: services.notificationRules
        });
      }
    });

    new AggregateCoordinator({} as DurableObjectState, { DB: {} as D1Database });

    expect(captured).toBeDefined();
    expect(typeof captured?.events.readStream).toBe("function");
    expect(typeof captured?.events.append).toBe("function");
    expect(typeof captured?.notificationRules).toBe("object");
  });
});
