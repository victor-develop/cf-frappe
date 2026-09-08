import { EmailNotificationService, defineDocType, createRegistry, type EventStore } from "../../src";
import { createTestD1, frameworkSchema } from "../d1-engine.js";
import { createAggregateCoordinatorClass } from "../../src/cloudflare";
import { createTestRegistry } from "../helpers";

describe("createAggregateCoordinatorClass", () => {
  it("resumes document folds in production, not only in tests", async () => {
    // Asserted because the opposite shipped once: the snapshot feature landed
    // with an in-memory adapter and nothing wiring it here, so every test
    // measured the win and production replayed the whole history anyway. A
    // wiring nobody pins is a wiring that quietly goes away.
    //
    // In-memory is the right store *here* specifically — the namespace id is
    // `${tenantId}:${doctype}:${name}`, so one instance is the single writer
    // for one document's stream.
    const Note = defineDocType({ name: "Note", fields: [{ name: "title", type: "text" }] });
    const d1 = createTestD1({ schema: frameworkSchema() });
    const AggregateCoordinator = createAggregateCoordinatorClass({
      registry: createRegistry({ doctypes: [Note] }),
      documentDeliveryOutbox: false,
      notifications: false,
      assignmentRuleActor: false
    });
    const coordinator = new AggregateCoordinator({} as DurableObjectState, { DB: d1.database });
    const actor = { id: "owner@example.com", roles: ["System Manager"], tenantId: "acme" };

    const created = await coordinator.transact({ kind: "create", actor, doctype: "Note", data: { title: "t0" } });
    const before = d1.executed.length;
    await coordinator.transact({
      kind: "update",
      actor,
      doctype: "Note",
      name: (created as { readonly name: string }).name,
      patch: { title: "t1" }
    });

    // A resumed read is bounded below; a full replay is not. The point is the
    // presence of the bound, not how many events came back.
    const reads = d1.executed.slice(before).filter((sql) => sql.includes("FROM cf_frappe_events"));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.some((sql) => sql.includes("sequence >= ?"))).toBe(true);
    d1.close();
  });

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

  it("creates assignment-rule write hooks by default and accepts overrides", () => {
    const DefaultAggregateCoordinator = createAggregateCoordinatorClass({
      registry: createTestRegistry()
    });
    const AggregateCoordinator = createAggregateCoordinatorClass({
      registry: createTestRegistry(),
      assignmentRuleActor: {
        id: "assignment-rules@example.com",
        roles: ["Task Manager"],
        tenantId: "acme"
      }
    });
    const DisabledAggregateCoordinator = createAggregateCoordinatorClass({
      registry: createTestRegistry(),
      assignmentRuleActor: false
    });

    expect(() => new DefaultAggregateCoordinator({} as DurableObjectState, { DB: {} as D1Database })).not.toThrow();
    expect(() => new AggregateCoordinator({} as DurableObjectState, { DB: {} as D1Database })).not.toThrow();
    expect(() => new DisabledAggregateCoordinator({} as DurableObjectState, { DB: {} as D1Database })).not.toThrow();
  });
});
