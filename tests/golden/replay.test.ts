import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures";
import { replay, type GoldenTranscript } from "./harness";

/**
 * Deterministic command-replay goldens (issue #64): each fixture replays a
 * realistic command history against the real D1 engine facade, and the whole
 * transcript — folded snapshots, every stored event, listings, the automation
 * journal — must equal the checked-in golden byte for value.
 *
 * A change to fold logic, event shape, or projection derivation that alters
 * what a history replays to fails here even when every unit test still
 * passes, because the unit tests assert the fold's rules and the goldens
 * assert its consequences.
 *
 * Regenerating a golden is deliberate and reviewed: run
 *
 *   GOLDEN_WRITE=1 npx vitest run tests/golden
 *
 * and commit the diff under tests/golden/goldens/ with the change that
 * justifies it. A golden diff is the reviewed record of a behaviour change.
 */

const goldensDirectory = new URL("./goldens/", import.meta.url);

describe("golden command replay", () => {
  for (const fixture of fixtures) {
    it(`replays ${fixture.name} to its golden transcript`, async () => {
      const actual = await replay(fixture);
      const path = goldenPath(fixture.name);

      if (process.env.GOLDEN_WRITE === "1") {
        mkdirSync(goldensDirectory, { recursive: true });
        writeFileSync(path, serialize(actual));
        return;
      }

      let expected: GoldenTranscript;
      try {
        expected = JSON.parse(readFileSync(path, "utf8")) as GoldenTranscript;
      } catch {
        throw new Error(
          `No golden for '${fixture.name}' at ${path}. If this fixture is new, generate its golden with GOLDEN_WRITE=1 npx vitest run tests/golden and review the diff before committing.`
        );
      }
      expect(actual).toEqual(expected);
    });
  }

  it("names a golden for every fixture", () => {
    // A typo'd fixture name would generate a golden file nothing compares
    // against; pinning the list makes that visible.
    expect(fixtures.map((fixture) => fixture.name)).toEqual([
      "returns-refund-journey",
      "returns-automation-exactly-once",
      "returns-cancel-amend-collab"
    ]);
  });
});

function goldenPath(name: string): string {
  return new URL(`${name}.json`, goldensDirectory).pathname;
}

function serialize(transcript: GoldenTranscript): string {
  return `${JSON.stringify(transcript, null, 2)}\n`;
}
