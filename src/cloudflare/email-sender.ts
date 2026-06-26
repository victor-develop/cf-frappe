import type { EmailAddress, EmailMessage, EmailSendResult, EmailSender } from "../ports/email.js";

export class CloudflareEmailSender implements EmailSender {
  private readonly binding: SendEmail;

  constructor(binding: SendEmail) {
    this.binding = binding;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const result = await this.binding.send({
      from: cloudflareAddress(message.from),
      to: message.to.map(cloudflareAddress),
      subject: message.subject,
      text: message.text,
      ...(message.html === undefined ? {} : { html: message.html }),
      ...(message.headers === undefined ? {} : { headers: message.headers })
    });
    return cloudflareMessageId(result);
  }
}

export function createCloudflareEmailSender(binding: SendEmail): EmailSender {
  return new CloudflareEmailSender(binding);
}

function cloudflareAddress(address: EmailAddress): string | { readonly email: string; readonly name: string } {
  return address.name === undefined
    ? address.email
    : { email: address.email, name: address.name };
}

function cloudflareMessageId(result: unknown): EmailSendResult {
  if (typeof result === "object" && result !== null && "messageId" in result) {
    const messageId = (result as { readonly messageId?: unknown }).messageId;
    return typeof messageId === "string" ? { id: messageId } : {};
  }
  return {};
}
