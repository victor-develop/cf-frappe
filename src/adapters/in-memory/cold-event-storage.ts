import type { ColdEventPutOptions, ColdEventStorage } from "../../ports/cold-event-storage.js";

/**
 * Cold event storage in a `Map`, for tests and local runs without an R2 bucket.
 *
 * Like the port, it has no delete. `objects` is exposed so a test can see what
 * was written — and tamper with it, to prove a corrupted or missing object is
 * refused rather than read as a shorter history.
 */
export class InMemoryColdEventStorage implements ColdEventStorage {
  readonly objects = new Map<string, { readonly body: string; readonly options: ColdEventPutOptions }>();

  async put(key: string, body: string, options: ColdEventPutOptions): Promise<void> {
    this.objects.set(key, { body, options: { sha256: options.sha256, metadata: { ...options.metadata } } });
  }

  async get(key: string): Promise<string | null> {
    return this.objects.get(key)?.body ?? null;
  }
}
