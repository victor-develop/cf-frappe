import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isArchivableStream } from "../../src";
import { fixtures } from "./fixtures";
import { replay, type GoldenTranscript, type ReplayApp } from "./harness";

/**
 * The golden command histories (issue #64) replayed with the cold event archive
 * switched on and pushed to its limit (issue #18): after every command, every
 * stream the archive is allowed to touch is moved to cold storage in full, in
 * two-event segments. The next command then runs against a hot table that holds
 * none of the history it folds — not the document's, not the automation runs',
 * not the amended document's predecessor — and has only the archive's
 * high-water mark to check its expected version against.
 *
 * The transcript must still equal the checked-in golden exactly. The goldens
 * are not regenerated for this suite; the point is that archiving changes
 * nothing a replay can observe.
 *
 * This goes far past what the cut policies would ever archive (they leave
 * everything above a fold snapshot hot). That is deliberate: the policies decide
 * cost, and this proves that correctness never depended on them.
 */

const goldensDirectory = new URL("./goldens/", import.meta.url);

async function archiveEverything(app: ReplayApp): Promise<void> {
  const streams = app.engine
    .query("SELECT DISTINCT stream FROM cf_frappe_events ORDER BY stream ASC")
    .map((row) => String(row.stream));
  for (const stream of streams.filter(isArchivableStream)) {
    await app.archive!.archive(stream, { through: Number.MAX_SAFE_INTEGER, maxSegmentEvents: 2 });
  }
}

describe("golden command replay with every archivable event in cold storage", () => {
  for (const fixture of fixtures) {
    it(`replays ${fixture.name} to its unchanged golden transcript`, async () => {
      let lastApp: ReplayApp | undefined;
      const actual = await replay(fixture, {
        archived: true,
        afterStep: async (app) => {
          lastApp = app;
          await archiveEverything(app);
        }
      });
      const expected = JSON.parse(
        readFileSync(new URL(`${fixture.name}.json`, goldensDirectory), "utf8")
      ) as GoldenTranscript;

      expect(actual).toEqual(expected);

      // Not vacuous: what is left hot is exactly the protected streams, and
      // everything else came back from the archive.
      const hot = lastApp!.engine
        .query("SELECT DISTINCT stream FROM cf_frappe_events ORDER BY stream ASC")
        .map((row) => String(row.stream));
      expect(hot.every((stream) => !isArchivableStream(stream)), hot.join(", ")).toBe(true);
      const archivedStreams = lastApp!.engine.query("SELECT DISTINCT stream FROM cf_frappe_event_archive_segments");
      expect(archivedStreams.length).toBe(Object.keys(expected.streams).filter(isArchivableStream).length);
    });
  }
});
