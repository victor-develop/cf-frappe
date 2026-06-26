import { createCloudflareEmailSender } from "../../src/cloudflare";

describe("CloudflareEmailSender", () => {
  it("maps framework email messages to the Workers SendEmail binding", async () => {
    const sent: unknown[] = [];
    const sender = createCloudflareEmailSender({
      async send(message: unknown) {
        sent.push(message);
        return { messageId: "cf-msg-1" };
      }
    } as SendEmail);

    await expect(sender.send({
      from: { email: "notifications@example.com", name: "Notifications" },
      to: [{ email: "user@example.com" }, { email: "ops@example.com", name: "Ops" }],
      subject: "Task changed",
      text: "Task changed",
      html: "<p>Task changed</p>",
      headers: { "X-CF-Frappe-Event": "evt_1" }
    })).resolves.toEqual({ id: "cf-msg-1" });

    expect(sent).toEqual([
      {
        from: { email: "notifications@example.com", name: "Notifications" },
        to: ["user@example.com", { email: "ops@example.com", name: "Ops" }],
        subject: "Task changed",
        text: "Task changed",
        html: "<p>Task changed</p>",
        headers: { "X-CF-Frappe-Event": "evt_1" }
      }
    ]);
  });
});
