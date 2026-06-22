import type { AccountRecoveryMessage, AccountRecoveryNotifier } from "../../ports/account-recovery";

export interface InMemoryAccountRecoveryNotifier extends AccountRecoveryNotifier {
  readonly passwordResetMessages: AccountRecoveryMessage[];
  readonly emailVerificationMessages: AccountRecoveryMessage[];
}

export function createInMemoryAccountRecoveryNotifier(): InMemoryAccountRecoveryNotifier {
  return {
    passwordResetMessages: [],
    emailVerificationMessages: [],
    sendPasswordReset(message) {
      this.passwordResetMessages.push(message);
    },
    sendEmailVerification(message) {
      this.emailVerificationMessages.push(message);
    }
  };
}
