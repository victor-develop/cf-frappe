import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures";
import { RoutedProjectionStore } from "../../src";
import { replay, replayApp, type GoldenTranscript } from "./harness";

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

  // Issue #15: the same histories with every registered DocType on a typed
  // projection table. `active` reads lists and documents from the typed tables,
  // so an equal transcript is the claim that they are invisible to the
  // application. `shadow` reads the shared table, so there the claim is that the
  // follower write never fails and ends up row-for-row equal to the shared one.
  for (const fixture of fixtures) {
    it(`replays ${fixture.name} on active typed projection tables to the same golden`, async () => {
      const expected = JSON.parse(readFileSync(goldenPath(fixture.name), "utf8")) as GoldenTranscript;
      expect(await replay(fixture, { typedProjections: "active" })).toEqual(expected);

      // And the typed tables were really the ones written and read, not bypassed.
      const app = await replayApp(fixture, { typedProjections: "active" });
      let typedRows = 0;
      for (const doctype of fixture.registry.list()) {
        const table = app.typed!.tableFor(doctype.name)!;
        typedRows += Number(app.engine.query(`SELECT COUNT(*) AS n FROM ${table}`)[0]!.n);
        await app.projections.list({ tenantId: "default", doctype: doctype.name });
        expect(app.engine.executed.some((sql) => sql.includes(`FROM ${table}`)), table).toBe(true);
      }
      expect(typedRows).toBeGreaterThan(0);
    });

    it(`keeps shadow typed projection tables row-for-row equal to the shared table for ${fixture.name}`, async () => {
      const app = await replayApp(fixture, { typedProjections: "shadow" });
      const router = new RoutedProjectionStore({
        targets: [
          { name: "shared", state: "active", store: app.shared },
          { name: "typed", state: "caught-up", store: app.typed! }
        ]
      });
      let compared = 0;
      for (const doctype of fixture.registry.list()) {
        const result = await router.compare("typed", "default", doctype.name);
        expect(result.differences, doctype.name).toEqual([]);
        compared += (await app.shared.list({ tenantId: "default", doctype: doctype.name })).total;
      }
      // Guard against a vacuous pass: the histories do write documents.
      expect(compared).toBeGreaterThan(0);
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
