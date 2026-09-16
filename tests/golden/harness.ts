import {
  AutomationRunConsumer,
  AutomationRunPlanner,
  AutomationRunService,
  DocumentService,
  D1DocumentStore,
  D1EventStore,
  D1ProjectionStore,
  type Actor,
  type Clock,
  type DocumentData,
  type DocumentSnapshot,
  type DomainEvent,
  type IdGenerator,
  type ModelRegistry
} from "../../src";
import { createTestD1, frameworkSchema, type TestD1 } from "../d1-engine";

/**
 * The deterministic replay harness behind the golden suite (issue #64).
 *
 * Everything the replay touches is injected: one shared id sequence, one
 * ticking clock, the real D1 engine facade over `frameworkSchema()`, and the
 * registry the fixture names. No `Date.now`, no `crypto.randomUUID`, no
 * in-memory doubles — so a golden transcript is a function of the fixture's
 * command history and the framework code, and nothing else.
 */

const DEFAULT_TENANT = "default";
const CLOCK_STEP_MS = 60_000;

/** Advances one minute per read: timestamps stay strictly ordered, never tied. */
export function tickingClock(base: string): Clock {
  let ticks = 0;
  const start = Date.parse(base);
  return { now: () => new Date(start + ticks++ * CLOCK_STEP_MS).toISOString() };
}

/**
 * One shared sequence for every service. `cf_frappe_events` keys rows by
 * event id alone, so services must not mint colliding ids — the in-memory
 * store the journeys tests use does not enforce that, which makes a shared
 * generator a D1-specific wiring requirement, not a style choice.
 */
export function sequentialIds(): IdGenerator {
  let value = 0;
  return { next: (prefix = "") => `${prefix}${String(++value).padStart(4, "0")}` };
}

export interface ReplayApp {
  readonly engine: TestD1;
  readonly documents: DocumentService;
  readonly runs: AutomationRunService;
  readonly consumer: AutomationRunConsumer;
  readonly events: D1EventStore;
  readonly projections: D1ProjectionStore;
}

export function buildReplayApp(registry: ModelRegistry, options: { readonly clock: Clock; readonly ids: IdGenerator }): ReplayApp {
  const engine = createTestD1({ schema: frameworkSchema() });
  const store = new D1DocumentStore(engine.database);
  const events = new D1EventStore(engine.database);
  const projections = new D1ProjectionStore(engine.database);
  const documents = new DocumentService({
    registry,
    store,
    clock: options.clock,
    ids: options.ids,
    automationRuns: new AutomationRunPlanner({ ids: options.ids })
  });
  const runs = new AutomationRunService({ store, projections, ids: options.ids, clock: options.clock });
  const consumer = new AutomationRunConsumer({
    runs,
    documents,
    events,
    projections,
    clock: options.clock
  });
  return { engine, documents, runs, consumer, events, projections };
}

/**
 * One step of a recorded history. Steps are data, not functions, so a fixture
 * reads as the history it is. The harness resolves `expectedVersion` from the
 * replay's own last snapshot of the named document, which keeps optimistic
 * concurrency in the path without demanding version bookkeeping in fixtures.
 */
export type GoldenStep =
  | { readonly op: "create"; readonly actor: string; readonly doctype: string; readonly data: DocumentData; readonly as: string }
  | { readonly op: "update"; readonly actor: string; readonly doctype: string; readonly name: string; readonly patch: DocumentData }
  | { readonly op: "submit"; readonly actor: string; readonly doctype: string; readonly name: string }
  | { readonly op: "transition"; readonly actor: string; readonly doctype: string; readonly name: string; readonly workflow: string; readonly action: string }
  | { readonly op: "execute"; readonly actor: string; readonly doctype: string; readonly name: string; readonly command: string; readonly input: DocumentData }
  | { readonly op: "comment"; readonly actor: string; readonly doctype: string; readonly name: string; readonly text: string }
  | { readonly op: "assign"; readonly actor: string; readonly doctype: string; readonly name: string; readonly assignee: string }
  | { readonly op: "tag"; readonly actor: string; readonly doctype: string; readonly name: string; readonly tag: string }
  | { readonly op: "follow"; readonly actor: string; readonly doctype: string; readonly name: string }
  | { readonly op: "cancel"; readonly actor: string; readonly doctype: string; readonly name: string }
  | { readonly op: "amend"; readonly actor: string; readonly doctype: string; readonly name: string; readonly data?: DocumentData }
  | { readonly op: "drainAutomations"; readonly claimId: string };

export interface GoldenFixture {
  readonly name: string;
  /** A one-line statement of what the history exercises, quoted in the golden. */
  readonly description: string;
  readonly clockStart: string;
  readonly registry: ModelRegistry;
  readonly actors: Readonly<Record<string, Actor>>;
  readonly steps: readonly GoldenStep[];
}

export interface GoldenTranscript {
  readonly fixture: string;
  readonly description: string;
  /** Final folded snapshot per document in the database, keyed `doctype/name`. */
  readonly documents: Readonly<Record<string, DocumentSnapshot | null>>;
  /** Every event of every stream in the database, ordered by stream then sequence. */
  readonly streams: Readonly<Record<string, readonly DomainEvent[]>>;
  /**
   * The default listing per doctype present: membership, versions, and the
   * newest-first order, with rows tied on updatedAt canonicalised by name.
   */
  readonly listings: Readonly<Record<string, readonly { readonly name: string; readonly version: number; readonly docstatus: string; readonly updatedAt: string }[]>>;
  /** The automation journal after the history's final drain. */
  readonly automationRuns: Awaited<ReturnType<AutomationRunService["list"]>>;
}

/**
 * Replays a fixture against the real engine and collects the transcript from
 * the finished database — never from in-flight command results — so the
 * golden is exactly what a fresh fold of the stored history and the derived
 * projections say, not what the commands happened to return.
 */
export async function replay(fixture: GoldenFixture): Promise<GoldenTranscript> {
  const clock = tickingClock(fixture.clockStart);
  const ids = sequentialIds();
  const app = buildReplayApp(fixture.registry, { clock, ids });
  const versions = new Map<string, number>();
  // Series-named documents (RMA-2026-000001 and friends) get their name from
  // the engine, so a create step names the result with an `as` alias and later
  // steps reference the fixture-visible alias, not the minted name.
  const aliases = new Map<string, string>();

  for (const step of fixture.steps) {
    if (step.op === "drainAutomations") {
      await drainAll(app.consumer, step.claimId);
      continue;
    }
    const actor = fixture.actors[step.actor];
    if (actor === undefined) {
      throw new Error(`Fixture '${fixture.name}' step '${step.op}': unknown actor '${step.actor}'`);
    }
    if (step.op === "create") {
      const created = await app.documents.create({ actor, doctype: step.doctype, data: step.data });
      aliases.set(step.as, created.name);
      versions.set(`${step.doctype}/${step.as}`, created.version);
      continue;
    }
    const name = aliases.get(step.name) ?? step.name;
    const versionKey = `${step.doctype}/${step.name}`;
    const version = versions.get(versionKey);
    const snapshot = await applyStep(app.documents, step, actor, name, version);
    if (snapshot === undefined) {
      throw new Error(`Fixture '${fixture.name}' step '${step.op}' returned no snapshot`);
    }
    // An amend mints a fresh series name for the amended copy; re-point the
    // fixture's reference so later steps follow the document, not its old shell.
    if (snapshot.name !== name) {
      aliases.set(step.name, snapshot.name);
    }
    versions.set(versionKey, snapshot.version);
  }

  return await collect(app, fixture);
}

async function applyStep(
  documents: DocumentService,
  step: Exclude<GoldenStep, { readonly op: "create" } | { readonly op: "drainAutomations" }>,
  actor: Actor,
  name: string,
  version: number | undefined
): Promise<DocumentSnapshot | undefined> {
  switch (step.op) {
    case "update":
      return await documents.update({ actor, doctype: step.doctype, name, patch: step.patch, expectedVersion: requiredVersion(step, version) });
    case "submit":
      return await documents.submit({ actor, doctype: step.doctype, name, expectedVersion: requiredVersion(step, version) });
    case "transition":
      return await documents.transition({ actor, doctype: step.doctype, name, workflow: step.workflow, action: step.action, expectedVersion: requiredVersion(step, version) });
    case "execute":
      return await documents.execute({ actor, doctype: step.doctype, name, command: step.command, input: step.input, expectedVersion: requiredVersion(step, version) });
    case "comment":
      return await documents.comment({ actor, doctype: step.doctype, name, text: step.text, expectedVersion: requiredVersion(step, version) });
    case "assign":
      return await documents.assign({ actor, doctype: step.doctype, name, assignee: step.assignee, expectedVersion: requiredVersion(step, version) });
    case "tag":
      return await documents.tag({ actor, doctype: step.doctype, name, tag: step.tag, expectedVersion: requiredVersion(step, version) });
    case "follow":
      return await documents.follow({ actor, doctype: step.doctype, name, expectedVersion: requiredVersion(step, version) });
    case "cancel":
      return await documents.cancel({ actor, doctype: step.doctype, name, expectedVersion: requiredVersion(step, version) });
    case "amend":
      return await documents.amend({ actor, doctype: step.doctype, name, ...(step.data === undefined ? {} : { data: step.data }), expectedVersion: requiredVersion(step, version) });
  }
}

function requiredVersion(step: Exclude<GoldenStep, { readonly op: "create" } | { readonly op: "drainAutomations" }>, version: number | undefined): number {
  if (version === undefined) {
    throw new Error(`Fixture step '${step.op}' names document '${step.name}' before the replay created it`);
  }
  return version;
}

async function drainAll(consumer: AutomationRunConsumer, claimId: string): Promise<void> {
  // Mirrors the production drain loop (examples/returns/worker.ts): repeat
  // while progress is being made, since a delivered run can plan another.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await consumer.drain({ tenantId: DEFAULT_TENANT, claimId, limit: 100 });
    if (result.claimed === 0 || result.failed > 0 || result.dead > 0) {
      return;
    }
  }
}

async function collect(app: ReplayApp, fixture: GoldenFixture): Promise<GoldenTranscript> {
  const documents: Record<string, DocumentSnapshot | null> = {};
  for (const row of app.engine.query("SELECT doctype, name FROM cf_frappe_documents ORDER BY doctype ASC, name ASC")) {
    const doctype = String(row.doctype);
    const name = String(row.name);
    documents[`${doctype}/${name}`] = await app.projections.get(DEFAULT_TENANT, doctype, name);
  }

  const streams: Record<string, readonly DomainEvent[]> = {};
  for (const row of app.engine.query("SELECT DISTINCT stream FROM cf_frappe_events ORDER BY stream ASC")) {
    const stream = String(row.stream);
    streams[stream] = await app.events.readStream(stream);
  }

  const listings: Record<string, { name: string; version: number; docstatus: string; updatedAt: string }[]> = {};
  for (const row of app.engine.query("SELECT DISTINCT doctype FROM cf_frappe_documents ORDER BY doctype ASC")) {
    const doctype = String(row.doctype);
    const listed = await app.projections.list({ tenantId: DEFAULT_TENANT, doctype });
    listings[doctype] = listed.data
      .map((document) => ({
        name: document.name,
        version: document.version,
        docstatus: document.docstatus,
        updatedAt: document.updatedAt
      }))
      // The listing contract is newest-first; among rows tied on updatedAt the
      // store's ORDER BY has no further key, so ties are canonicalised by name.
      // Without this, a SQLite version that scans ties differently would force
      // a spurious golden diff.
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name)
      );
  }

  return {
    fixture: fixture.name,
    description: fixture.description,
    documents,
    streams,
    listings,
    automationRuns: await app.runs.list(DEFAULT_TENANT)
  };
}
