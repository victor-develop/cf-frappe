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

  it("wires an email notification delivery queue into the aggregate delivery hooks", () => {
    let emailServices: { readonly events: EventStore; readonly notificationRules: unknown } | undefined;
    let queueServices: { readonly events: EventStore; readonly notificationRules: unknown } | undefined;
    const AggregateCoordinator = createAggregateCoordinatorClass({
      registry: createTestRegistry(),
      emailNotifications(_env, services) {
        emailServices = services;
        return new EmailNotificationService({
          events: services.events,
          sender: { async send() { return {}; } },
          from: { email: "notifications@example.com" },
          notificationRules: services.notificationRules
        });
      },
      emailNotificationDeliveryQueue(_env, services) {
        queueServices = services;
        return {
          async enqueue() {
            return undefined;
          }
        };
      }
    });

    new AggregateCoordinator({} as DurableObjectState, { DB: {} as D1Database });

    expect(queueServices).toBeDefined();
    expect(queueServices?.events).toBe(emailServices?.events);
    expect(queueServices?.notificationRules).toBe(emailServices?.notificationRules);
  });

  it("does not create the email delivery queue when email notifications are disabled", () => {
    let queueCreated = false;
    const AggregateCoordinator = createAggregateCoordinatorClass({
      registry: createTestRegistry(),
      emailNotificationDeliveryQueue() {
        queueCreated = true;
        return {
          async enqueue() {
            return undefined;
          }
        };
      }
    });

    new AggregateCoordinator({} as DurableObjectState, { DB: {} as D1Database });

    expect(queueCreated).toBe(false);
  });
});
