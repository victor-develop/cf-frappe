import {
  doctypeTopic,
  doctypeTopicFromOptions,
  documentTopic,
  documentTopicFromOptions,
  tenantIdFromOptions,
  tenantTopic,
  tenantTopicFromOptions,
  userTopic,
  userTopicFromOptions
} from "../../src/adapters/desk/client-src/topics";

describe("client-src realtime topic builders", () => {
  it("builds encoded topic strings", () => {
    expect(documentTopic("t 1", "Sales Order", "SO/1")).toBe("document:t%201:Sales%20Order:SO%2F1");
    expect(doctypeTopic("t1", "Task")).toBe("doctype:t1:Task");
    expect(tenantTopic("t 1")).toBe("tenant:t%201");
    expect(userTopic("t1", "u@x")).toBe("user:t1:u%40x");
  });

  it("tenantIdFromOptions resolves direct and document-nested tenant ids", () => {
    expect(tenantIdFromOptions({ tenantId: "t1" }, "doctype")).toBe("t1");
    expect(tenantIdFromOptions({ document: { tenantId: "t2" } }, "document")).toBe("t2");
    expect(tenantIdFromOptions({ tenantId: "t1", document: { tenantId: "t2" } }, "doctype")).toBe("t1");
  });

  it("tenantIdFromOptions throws a labeled error without a tenant id", () => {
    expect(() => tenantIdFromOptions(undefined, "tenant")).toThrow(
      "tenantId is required for tenant realtime subscriptions"
    );
    expect(() => tenantIdFromOptions({}, "doctype")).toThrow(
      "tenantId is required for doctype realtime subscriptions"
    );
    expect(() => tenantIdFromOptions({ document: {} }, "document")).toThrow(
      "tenantId is required for document realtime subscriptions"
    );
  });

  it("builds topics from options", () => {
    expect(doctypeTopicFromOptions("Task", { tenantId: "t1" })).toBe("doctype:t1:Task");
    expect(documentTopicFromOptions("Task", "T1", { document: { tenantId: "t1" } })).toBe("document:t1:Task:T1");
    expect(tenantTopicFromOptions({ tenantId: "t1" })).toBe("tenant:t1");
  });

  it("user topics resolve userId from the argument or options", () => {
    expect(userTopicFromOptions("u1", { tenantId: "t1" })).toBe("user:t1:u1");
    expect(userTopicFromOptions(undefined, { tenantId: "t1", userId: "u2" })).toBe("user:t1:u2");
    expect(userTopicFromOptions("u1", { tenantId: "t1", userId: "u2" })).toBe("user:t1:u1");
  });

  it("user topics throw without a user id", () => {
    expect(() => userTopicFromOptions(undefined, { tenantId: "t1" })).toThrow(
      "userId is required for user realtime subscriptions"
    );
  });
});
