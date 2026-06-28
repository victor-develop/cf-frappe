import type { AccountRecoveryMessage, AccountRecoveryNotifier } from "../../ports/account-recovery.js";

export interface InMemoryAccountRecoveryNotifier extends AccountRecoveryNotifier {
  readonly passwordResetMessages: readonly AccountRecoveryMessage[];
  readonly emailVerificationMessages: readonly AccountRecoveryMessage[];
}

export function createInMemoryAccountRecoveryNotifier(): InMemoryAccountRecoveryNotifier {
  return new RecordingAccountRecoveryNotifier();
}

class RecordingAccountRecoveryNotifier implements InMemoryAccountRecoveryNotifier {
  private readonly passwordResetRecords: AccountRecoveryMessage[] = [];
  private readonly emailVerificationRecords: AccountRecoveryMessage[] = [];

  get passwordResetMessages(): readonly AccountRecoveryMessage[] {
    return this.passwordResetRecords.map(cloneAccountRecoveryMessage);
  }

  get emailVerificationMessages(): readonly AccountRecoveryMessage[] {
    return this.emailVerificationRecords.map(cloneAccountRecoveryMessage);
  }

  sendPasswordReset(message: AccountRecoveryMessage): void {
    this.passwordResetRecords.push(cloneAccountRecoveryMessage(message));
  }

  sendEmailVerification(message: AccountRecoveryMessage): void {
    this.emailVerificationRecords.push(cloneAccountRecoveryMessage(message));
  }
}

function cloneAccountRecoveryMessage(message: AccountRecoveryMessage): AccountRecoveryMessage {
  return { ...message };
}
