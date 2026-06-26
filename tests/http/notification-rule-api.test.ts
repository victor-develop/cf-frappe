import {
  createResourceApi,
  deterministicIds,
  NotificationRuleService,
  SYSTEM_MANAGER_ROLE,
  unsafeHeaderActorResolver
} from "../../src";
import { createServices, now } from "../helpers";
import { fixedClock } from "../../src";

const adminHeaders = {
  "content-type": "application/json",
  "x-cf-frappe-user": "admin@example.com",
  "x-cf-frappe-roles": `${SYSTEM_MANAGER_ROLE},User`,
  "x-cf-frappe-tenant": "acme"
};

describe("notification rule api", () => {
  it("manages tenant notification rules through generated JSON routes", async () => {
    const { app } = makeNotificationRuleApp();

    const empty = await app.request("/api/notification-rules/Note", { headers: adminHeaders });
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({
      data: { tenantId: "acme", doctypeName: "Note", version: 0, rules: [] }
    });

    const saved = await app.request("/api/notification-rules/Note/Managers%20on%20updates", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        expectedVersion: 0,
        rule: {
          events: ["DocumentUpdated"],
          recipients: [
            { kind: "documentOwner" },
            { kind: "user", userId: "manager@example.com" }
          ],
          channels: ["email", "inbox"],
          subject: "Note changed"
        }
      })
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      data: {
        version: 1,
        rules: [{ rule: { name: "Managers on updates", channels: ["email", "inbox"], subject: "Note changed" }, enabled: true }]
      }
    });

    const cleared = await app.request("/api/notification-rules/Note/Managers%20on%20updates", {
      method: "DELETE",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 1 })
    });
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toMatchObject({ data: { version: 2, rules: [] } });
  });

  it("maps validation, conflict, and permission failures to JSON errors", async () => {
    const { app } = makeNotificationRuleApp();

    const denied = await app.request("/api/notification-rules/Note", {
      headers: { ...adminHeaders, "x-cf-frappe-roles": "User" }
    });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });

    const missingRule = await app.request("/api/notification-rules/Note/Bad", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 0 })
    });
    expect(missingRule.status).toBe(400);
    await expect(missingRule.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "rule must be an object" }
    });

    const invalidRule = await app.request("/api/notification-rules/Note/Bad", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        rule: {
          events: ["UserNotificationRead"],
          recipients: [{ kind: "user", userId: "manager@example.com" }]
        }
      })
    });
    expect(invalidRule.status).toBe(400);
    await expect(invalidRule.json()).resolves.toMatchObject({ error: { code: "NOTIFICATION_RULE_INVALID" } });

    const created = await app.request("/api/notification-rules/Note/Managers", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        expectedVersion: 0,
        rule: {
          events: ["DocumentUpdated"],
          recipients: [{ kind: "user", userId: "manager@example.com" }]
        }
      })
    });
    expect(created.status).toBe(200);

    const stale = await app.request("/api/notification-rules/Note/Other", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        expectedVersion: 0,
        rule: {
          events: ["DocumentUpdated"],
          recipients: [{ kind: "user", userId: "other@example.com" }]
        }
      })
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: { code: "DOCUMENT_CONFLICT" } });

    const { app: oversizedApp } = makeNotificationRuleApp(80);
    const oversized = await oversizedApp.request("/api/notification-rules/Note/TooLarge", {
      method: "PUT",
      headers: { ...adminHeaders, "content-length": "99" },
      body: "{}"
    });
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });
  });
});

function makeNotificationRuleApp(maxJsonBytes = 1_048_576) {
  const services = createServices(["note-1", "note-2"]);
  const notificationRules = new NotificationRuleService({
    registry: services.registry,
    events: services.store,
    ids: deterministicIds(["rule-1", "rule-2"]),
    clock: fixedClock(now)
  });
  return {
    services: { ...services, notificationRules },
    app: createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver,
      notificationRules,
      maxJsonBytes
    })
  };
}
