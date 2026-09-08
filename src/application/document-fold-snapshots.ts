import { foldDocument, foldDocumentFrom } from "../core/events.js";
import type { DocumentSnapshot, StreamName } from "../core/types.js";
import type { DocumentCommit, DocumentStore } from "../ports/document-store.js";
import type { FoldSnapshot, SnapshotStore } from "../ports/snapshot-store.js";

/**
 * Snapshot key for `foldDocument`.
 *
 * Bump the version when what the fold computes changes, so state stored in the
 * old shape is simply not found rather than being folded onto.
 * `tests/application/document-snapshots.test.ts` pins the folded state for a
 * fixed fixture, so a change without a bump fails there.
 */
export const DOCUMENT_FOLD_NAME = "document";
export const DOCUMENT_FOLD_VERSION = 1;

/**
 * Reads and records `foldDocument` snapshots for a document stream.
 *
 * Kept out of `DocumentService` because it is one cohesive unit — resume,
 * record, and the error handling that makes both optional — rather than three
 * private methods in a two-thousand-line service.
 *
 * Every method here holds issue #17's safety rule: **a snapshot may always be
 * ignored, and ignoring it must give exactly the same answer as using it.** With
 * no `SnapshotStore` this class does nothing but the full read the service did
 * before, which is that rule by construction rather than by care.
 */
export class DocumentFoldSnapshots {
  constructor(
    private readonly store: DocumentStore,
    private readonly snapshots: SnapshotStore | undefined
  ) {}

  /**
   * Folds a document forward from its snapshot, or from nothing when there is
   * no usable one.
   */
  async resume(stream: StreamName): Promise<DocumentSnapshot | null> {
    const base = await this.read(stream);
    if (base !== null) {
      try {
        // Inclusive lower bound of one past the snapshot: `+ 0` reapplies the
        // last event it already folded, `+ 2` skips one.
        return foldDocumentFrom(
          base.state,
          await this.store.readStream(stream, { minSequence: base.uptoSequence + 1 })
        );
      } catch {
        // A stored state this fold cannot consume must degrade to a cold fold.
        // A snapshot that can fail the caller is not ignorable, which is the one
        // thing the design forbids.
      }
    }
    return foldDocument(await this.store.readStream(stream));
  }

  /**
   * Records the state a commit just produced, ignoring any failure.
   *
   * The commit has already happened and the events are the truth; a snapshot
   * that fails to save just means the next read replays a little more.
   */
  async record(stream: StreamName, commit: DocumentCommit): Promise<void> {
    if (this.snapshots === undefined) {
      return;
    }
    // Filtered by stream, because sequences are per-stream and a commit batch
    // spans several. The document entry is not last: automation-run entries are
    // appended after it, each a fresh stream at version 0, so taking the batch's
    // last event filed every snapshot at sequence 1 whenever a rule fired — and
    // the newest-wins guard then discarded every later write, so it never
    // recovered. Where the run stream ended *above* the document's own sequence
    // the reader skipped a real event and the document became unwritable.
    //
    // `at(-1)` rather than `at(0)` is defensive: every commit path writes
    // exactly one event to the document's own stream today, so the two agree,
    // and a path that ever wrote two would want the last.
    const uptoSequence = commit.events.filter((event) => event.stream === stream).at(-1)?.sequence;
    if (uptoSequence === undefined) {
      return;
    }
    try {
      await this.snapshots.write<DocumentSnapshot | null>({
        stream,
        foldName: DOCUMENT_FOLD_NAME,
        foldVersion: DOCUMENT_FOLD_VERSION,
        uptoSequence,
        // A fresh object, because a store is now allowed to keep what it is
        // handed rather than copying it — deep-copying an unbounded fold's state
        // cost more than the snapshot saved. A `DocumentSnapshot` is flat, so
        // one level plus its `data` is the whole of it.
        state: { ...commit.snapshot, data: { ...commit.snapshot.data } }
      });
    } catch {
      // Deliberately ignored — see the doc comment.
    }
  }

  /**
   * A read that throws is swallowed on purpose: the snapshot is a cache whose
   * whole contract is that ignoring it changes nothing, so a broken store must
   * degrade to a full fold rather than fail a write.
   */
  private async read(stream: StreamName): Promise<FoldSnapshot<DocumentSnapshot | null> | null> {
    if (this.snapshots === undefined) {
      return null;
    }
    try {
      return await this.snapshots.read<DocumentSnapshot | null>({
        stream,
        foldName: DOCUMENT_FOLD_NAME,
        foldVersion: DOCUMENT_FOLD_VERSION
      });
    } catch {
      return null;
    }
  }
}
