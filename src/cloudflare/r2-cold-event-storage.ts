import { FrameworkError } from "../core/errors.js";
import type { ColdEventPutOptions, ColdEventStorage } from "../ports/cold-event-storage.js";

/**
 * Archived event segments in an R2 bucket (issue #18).
 *
 * Thin on purpose: everything that decides whether an event may leave D1 lives
 * in `D1EventArchive`, which is exercised against the real SQLite engine. What
 * this adds is the two things only R2 can do:
 *
 * - `sha256` is handed to `put`, so R2 verifies the body on receipt and a
 *   corrupted upload is rejected before the archive reads it back.
 * - Reads are strongly consistent in R2, so the archive's read-back after a
 *   write sees the object it just wrote.
 *
 * Objects are written to the Standard storage class. Infrequent Access is
 * cheaper to store but bills every read and has a minimum storage duration;
 * which is right depends on how often archived documents are opened, so it is
 * left to a deployment's bucket lifecycle rules rather than chosen here.
 */
export class R2ColdEventStorage implements ColdEventStorage {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, body: string, options: ColdEventPutOptions): Promise<void> {
    const stored = await this.bucket.put(key, body, {
      sha256: options.sha256,
      httpMetadata: { contentType: "application/x-ndjson; charset=utf-8" },
      customMetadata: { ...options.metadata }
    });
    if (stored === null) {
      // Only an `onlyIf` precondition makes `put` return null, and none is set —
      // so this is R2 declining the write, and the archive must not proceed.
      throw new FrameworkError("EVENT_ARCHIVE_INTEGRITY", `R2 did not store '${key}'`, { status: 500 });
    }
  }

  async get(key: string): Promise<string | null> {
    const object = await this.bucket.get(key);
    return object === null ? null : await object.text();
  }
}
