import type { TenantId } from "../core/types.js";

export interface AccountRecoveryMessage {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly email: string;
  readonly token: string;
  readonly expiresAt: string;
}

export interface AccountRecoveryNotifier {
  sendPasswordReset(message: AccountRecoveryMessage): void | Promise<void>;
  sendEmailVerification(message: AccountRecoveryMessage): void | Promise<void>;
}
