export interface EmailAddress {
  readonly email: string;
  readonly name?: string;
}

export interface EmailMessage {
  readonly from: EmailAddress;
  readonly to: readonly EmailAddress[];
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly headers?: Record<string, string>;
}

export interface EmailSendResult {
  readonly id?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
}
