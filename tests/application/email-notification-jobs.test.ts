import {
  createEmailNotificationDeliveryJob,
  createJobRegistry,
  deterministicIds,
  EmailNotificationDeliveryQueueService,
  EMAIL_NOTIFICATION_DELIVERY_JOB_NAME,
  InMemoryJobQueue,
  JobDispatcher,
  JobExecutor,
  fixedClock,
  type DocumentEmailNotificationDelivery
} from "../../src";
import { now } from "../helpers";

describe("Email notification delivery jobs", () => {
  it("delivers one outbox message through the built-in job", async () => {
    const calls: Array<{ readonly tenantId: string; readonly messageId: string }> = [];
    const registry = createJobRegistry({
      jobs: [createEmailNotificationDeliveryJob()]
    });
    const executor = new JobExecutor({
      registry,
      resources: {
        emailNotifications: {
          async deliverOutboxMessage(tenantId, messageId) {
            calls.push({ tenantId, messageId });
            return sentDelivery(messageId);
          }
        }
      },
      clock: fixedClock(now)
    });

    await expect(executor.execute(jobMessage("acme", "msg_001"))).resolves.toEqual({
      status: "succeeded",
      result: {
        delivered: true,
        status: "sent",
        messageId: "msg_001",
        eventId: "evt_001",
        ruleName: "Email owners",
        recipientId: "user_123",
        to: "reviewer@example.com",
        subject: "Note My Note changed",
        providerMessageId: "cf-msg-1"
      }
    });
    expect(calls).toEqual([{ tenantId: "acme", messageId: "msg_001" }]);
  });

  it("marks failed delivery as retryable so queue retry policy can redeliver", async () => {
    const registry = createJobRegistry({
      jobs: [createEmailNotificationDeliveryJob()]
    });
    const executor = new JobExecutor({
      registry,
      resources: {
        emailNotifications: {
          async deliverOutboxMessage(_tenantId, messageId) {
            return {
              status: "failed",
              messageId,
              eventId: "evt_001",
              ruleName: "Email owners",
              recipientId: "user_123",
              to: "reviewer@example.com",
              subject: "Note My Note changed",
              error: "Cloudflare Email temporarily unavailable"
            };
          }
        }
      },
      clock: fixedClock(now)
    });

    await expect(executor.execute(jobMessage("acme", "msg_001"))).rejects.toMatchObject({
      name: "JobExecutionError",
      kind: "retryable",
      message: "Cloudflare Email temporarily unavailable"
    });
  });

  it("returns delivered false when the outbox message is already complete or currently claimed", async () => {
    const registry = createJobRegistry({
      jobs: [createEmailNotificationDeliveryJob()]
    });
    const executor = new JobExecutor({
      registry,
      resources: {
        emailNotifications: {
          async deliverOutboxMessage() {
            return undefined;
          }
        }
      },
      clock: fixedClock(now)
    });

    await expect(executor.execute(jobMessage("acme", "msg_001"))).resolves.toEqual({
      status: "succeeded",
      result: {
        delivered: false,
        messageId: "msg_001"
      }
    });
  });

  it("enqueues deterministic delivery jobs for a tenant/message id pair", async () => {
    const queue = new InMemoryJobQueue();
    const registry = createJobRegistry({
      jobs: [createEmailNotificationDeliveryJob()]
    });
    const dispatcher = new JobDispatcher({
      registry,
      queue,
      clock: fixedClock(now),
      ids: deterministicIds(["email-001"])
    });
    const deliveries = new EmailNotificationDeliveryQueueService({ dispatcher });

    await expect(
      deliveries.enqueue("acme", "evt_update:rule:Email%20owners:email:user_123", {
        delaySeconds: 30,
        metadata: { source: "after-commit" }
      })
    ).resolves.toMatchObject({
      message: {
        tenantId: "acme",
        jobName: EMAIL_NOTIFICATION_DELIVERY_JOB_NAME,
        runId: "job_email-001",
        idempotencyKey: expect.stringMatching(
          /^cf-frappe\.email-notifications\.deliver:[0-9a-f]{32}:[0-9a-f]{32}$/
        ),
        payload: {
          messageId: "evt_update:rule:Email%20owners:email:user_123"
        },
        metadata: {
          source: "after-commit",
          dispatchSource: "email-notifications"
        }
      }
    });
    expect(queue.queued()).toEqual([
      expect.objectContaining({
        delaySeconds: 30,
        message: expect.objectContaining({
          jobName: EMAIL_NOTIFICATION_DELIVERY_JOB_NAME,
          payload: { messageId: "evt_update:rule:Email%20owners:email:user_123" }
        })
      })
    ]);
  });

  it("keeps default delivery idempotency keys bounded for long message ids", async () => {
    const queue = new InMemoryJobQueue();
    const registry = createJobRegistry({
      jobs: [createEmailNotificationDeliveryJob()]
    });
    const dispatcher = new JobDispatcher({
      registry,
      queue,
      clock: fixedClock(now),
      ids: deterministicIds(["email-001"])
    });
    const deliveries = new EmailNotificationDeliveryQueueService({ dispatcher });
    const longMessageId = `evt_update:rule:${"VeryLongRuleName".repeat(20)}:email:${"user".repeat(40)}@example.com`;

    const { message } = await deliveries.enqueue("acme", longMessageId);

    expect(message.idempotencyKey.length).toBeLessThanOrEqual(256);
    expect(message.payload).toEqual({ messageId: longMessageId });
    expect(queue.queued()).toHaveLength(1);
  });

  it("does not collapse message ids that collide under a narrow 32-bit hash", async () => {
    const queue = new InMemoryJobQueue();
    const registry = createJobRegistry({
      jobs: [createEmailNotificationDeliveryJob()]
    });
    const dispatcher = new JobDispatcher({
      registry,
      queue,
      clock: fixedClock(now),
      ids: deterministicIds(["email-001", "email-002"])
    });
    const deliveries = new EmailNotificationDeliveryQueueService({ dispatcher });

    const first = await deliveries.enqueue("acme", "msg-fhepmp5ifx-9eu");
    const second = await deliveries.enqueue("acme", "msg-sn2vtehoee-x0n");

    expect(first.message.idempotencyKey).not.toEqual(second.message.idempotencyKey);
    expect(first.message.payload).toEqual({ messageId: "msg-fhepmp5ifx-9eu" });
    expect(second.message.payload).toEqual({ messageId: "msg-sn2vtehoee-x0n" });
  });

  it("rejects invalid delivery job payloads before calling resources", async () => {
    const registry = createJobRegistry({
      jobs: [createEmailNotificationDeliveryJob()]
    });
    const executor = new JobExecutor({
      registry,
      resources: {
        emailNotifications: {
          async deliverOutboxMessage() {
            throw new Error("should not be called");
          }
        }
      },
      clock: fixedClock(now)
    });

    await expect(executor.execute({ ...jobMessage("acme", "msg_001"), payload: { messageId: "" } }))
      .rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Email notification delivery job messageId is invalid"
      });
  });
});

function jobMessage(tenantId: string, messageId: string) {
  return {
    tenantId,
    jobName: EMAIL_NOTIFICATION_DELIVERY_JOB_NAME,
    payload: { messageId },
    runId: "job_001",
    idempotencyKey: `${EMAIL_NOTIFICATION_DELIVERY_JOB_NAME}:${messageId}`,
    enqueuedAt: now,
    metadata: {}
  };
}

function sentDelivery(messageId: string): DocumentEmailNotificationDelivery {
  return {
    status: "sent",
    messageId,
    providerMessageId: "cf-msg-1",
    eventId: "evt_001",
    ruleName: "Email owners",
    recipientId: "user_123",
    to: "reviewer@example.com",
    subject: "Note My Note changed"
  };
}
