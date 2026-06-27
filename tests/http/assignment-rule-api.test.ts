import {
  AssignmentRuleService,
  createResourceApi,
  deterministicIds,
  fixedClock,
  SYSTEM_MANAGER_ROLE,
  unsafeHeaderActorResolver
} from "../../src";
import { createServices, now } from "../helpers";

const adminHeaders = {
  "content-type": "application/json",
  "x-cf-frappe-user": "admin@example.com",
  "x-cf-frappe-roles": `${SYSTEM_MANAGER_ROLE},User`,
  "x-cf-frappe-tenant": "acme"
};

describe("assignment rule api", () => {
  it("manages tenant assignment rules through generated JSON routes", async () => {
    const { app } = makeAssignmentRuleApp();

    const empty = await app.request("/api/assignment-rules/Note", { headers: adminHeaders });
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({
      data: { tenantId: "acme", doctypeName: "Note", version: 0, rules: [] }
    });

    const saved = await app.request("/api/assignment-rules/Note/High%20priority%20triage", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        expectedVersion: 0,
        rule: {
          events: ["DocumentCreated", "DocumentUpdated"],
          assignees: [
            { kind: "user", userId: "manager@example.com" },
            { kind: "field", field: "created_by" }
          ],
          condition: { field: "priority", value: "High" },
          excludeActor: true
        }
      })
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      data: {
        version: 1,
        rules: [
          {
            rule: {
              name: "High priority triage",
              condition: { field: "priority", value: "High" },
              excludeActor: true
            },
            enabled: true
          }
        ]
      }
    });

    const fetched = await app.request("/api/assignment-rules/Note/High%20priority%20triage", { headers: adminHeaders });
    expect(fetched.status).toBe(200);
    await expect(fetched.json()).resolves.toMatchObject({
      data: {
        tenantId: "acme",
        doctypeName: "Note",
        version: 1,
        rules: [
          {
            rule: {
              name: "High priority triage",
              events: ["DocumentCreated", "DocumentUpdated"],
              assignees: [
                { kind: "user", userId: "manager@example.com" },
                { kind: "field", field: "created_by" }
              ],
              condition: { field: "priority", value: "High" },
              excludeActor: true
            }
          }
        ]
      }
    });

    const disabled = await app.request("/api/assignment-rules/Note/High%20priority%20triage/disable", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 1 })
    });
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({
      data: {
        version: 2,
        rules: [
          {
            enabled: false,
            rule: {
              name: "High priority triage",
              enabled: false,
              condition: { field: "priority", value: "High" },
              excludeActor: true
            }
          }
        ]
      }
    });

    const enabled = await app.request("/api/assignment-rules/Note/High%20priority%20triage/enable", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 2 })
    });
    expect(enabled.status).toBe(200);
    await expect(enabled.json()).resolves.toMatchObject({
      data: {
        version: 3,
        rules: [
          {
            enabled: true,
            rule: {
              name: "High priority triage",
              enabled: true,
              condition: { field: "priority", value: "High" },
              excludeActor: true
            }
          }
        ]
      }
    });

    const cleared = await app.request("/api/assignment-rules/Note/High%20priority%20triage", {
      method: "DELETE",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 3 })
    });
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toMatchObject({ data: { version: 4, rules: [] } });
  });

  it("maps validation, conflict, and permission failures to JSON errors", async () => {
    const { app } = makeAssignmentRuleApp();

    const denied = await app.request("/api/assignment-rules/Note", {
      headers: { ...adminHeaders, "x-cf-frappe-roles": "User" }
    });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });

    const missingRule = await app.request("/api/assignment-rules/Note/Bad", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 0 })
    });
    expect(missingRule.status).toBe(400);
    await expect(missingRule.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "rule must be an object" }
    });

    const invalidRule = await app.request("/api/assignment-rules/Note/Bad", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        rule: {
          events: ["DocumentAssigned"],
          assignees: [{ kind: "user", userId: "manager@example.com" }]
        }
      })
    });
    expect(invalidRule.status).toBe(400);
    await expect(invalidRule.json()).resolves.toMatchObject({ error: { code: "ASSIGNMENT_RULE_INVALID" } });

    const created = await app.request("/api/assignment-rules/Note/Managers", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        expectedVersion: 0,
        rule: {
          events: ["DocumentCreated"],
          assignees: [{ kind: "user", userId: "manager@example.com" }]
        }
      })
    });
    expect(created.status).toBe(200);

    const stale = await app.request("/api/assignment-rules/Note/Other", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        expectedVersion: 0,
        rule: {
          events: ["DocumentCreated"],
          assignees: [{ kind: "user", userId: "other@example.com" }]
        }
      })
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: { code: "DOCUMENT_CONFLICT" } });

    const invalidCondition = await app.request("/api/assignment-rules/Note/BadCondition", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        rule: {
          events: ["DocumentCreated"],
          assignees: [{ kind: "user", userId: "manager@example.com" }],
          condition: { field: "metadata", value: "x" }
        }
      })
    });
    expect(invalidCondition.status).toBe(400);
    await expect(invalidCondition.json()).resolves.toMatchObject({ error: { code: "ASSIGNMENT_RULE_INVALID" } });

    const missing = await app.request("/api/assignment-rules/Note/Missing", { headers: adminHeaders });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: "ASSIGNMENT_RULE_NOT_FOUND", message: "Assignment rule 'Missing' was not found" }
    });

    const { app: oversizedApp } = makeAssignmentRuleApp(80);
    const oversized = await oversizedApp.request("/api/assignment-rules/Note/TooLarge", {
      method: "PUT",
      headers: { ...adminHeaders, "content-length": "99" },
      body: "{}"
    });
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });
  });
});

function makeAssignmentRuleApp(maxJsonBytes = 1_048_576) {
  const services = createServices(["note-1", "note-2"]);
  const assignmentRules = new AssignmentRuleService({
    registry: services.registry,
    events: services.store,
    ids: deterministicIds(["rule-1", "rule-2", "rule-3", "rule-4"]),
    clock: fixedClock(now)
  });
  return {
    services: { ...services, assignmentRules },
    app: createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor: unsafeHeaderActorResolver,
      assignmentRules,
      maxJsonBytes
    })
  };
}
