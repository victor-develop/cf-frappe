import { describe, expect, it } from "vitest";
import type { DomainEvent } from "../../src";
import {
  foldCustomFields,
  foldCustomFieldsFrom,
  foldDocument,
  foldDocumentAssignments,
  foldDocumentAssignmentsFrom,
  foldDocumentFollowers,
  foldDocumentFollowersFrom,
  foldDocumentFrom,
  foldDocumentShares,
  foldDocumentSharesFrom,
  foldDocumentTags,
  foldDocumentTagsFrom,
  foldJobScheduleDefinitions,
  foldJobScheduleDefinitionsFrom,
  foldJobScheduleOverrides,
  foldJobScheduleOverridesFrom,
  foldPrintSettings,
  foldPrintSettingsFrom,
  foldRoleCatalog,
  foldRoleCatalogFrom,
  foldUserProfile,
  foldUserProfileFrom
} from "../../src";

/**
 * Folds must be resumable: replaying a whole stream and replaying a prefix
 * then resuming from its result have to agree. Snapshots depend on this, and
 * the failure mode it catches is a fold that quietly assumes it has seen the
 * whole stream - a branch that only initialises on the first `Created` event,
 * for instance, breaks the moment the tail no longer contains one.
 */

const base = {
  id: "evt",
  tenantId: "acme",
  stream: "acme:Note:One",
  doctype: "Note",
  documentName: "One",
  actorId: "owner",
  occurredAt: "2026-01-01T00:00:00.000Z",
  metadata: {}
};

function event(sequence: number, payload: DomainEvent["payload"]): DomainEvent {
  return {
    ...base,
    id: `evt${sequence}`,
    sequence,
    type: payload.kind,
    payload
  } as DomainEvent;
}

function events(...payloads: readonly DomainEvent["payload"][]): DomainEvent[] {
  return payloads.map((payload, index) => event(index + 1, payload));
}

interface FoldCase<TState> {
  readonly name: string;
  readonly events: readonly DomainEvent[];
  foldAll(stream: readonly DomainEvent[]): TState;
  foldFrom(initial: TState | null, stream: readonly DomainEvent[]): TState;
}

function foldCase<TState>(input: FoldCase<TState>): FoldCase<unknown> {
  return input as FoldCase<unknown>;
}

const TENANT = "acme";
const USER = "user-1";

const cases: readonly FoldCase<unknown>[] = [
  foldCase({
    name: "foldDocument",
    events: events(
      { kind: "DocumentCreated", data: { title: "One" }, docstatus: "draft" },
      { kind: "DocumentUpdated", patch: { body: "first" } },
      { kind: "DocumentUpdated", patch: { body: "second", extra: 1 } },
      { kind: "DocumentUpdated", patch: {}, unset: ["extra"] }
    ),
    foldAll: (stream) => foldDocument(stream),
    foldFrom: (initial, stream) => foldDocumentFrom(initial, stream)
  }),
  foldCase({
    name: "foldDocumentAssignments",
    events: events(
      { kind: "DocumentAssigned", assigneeId: "a" },
      { kind: "DocumentAssigned", assigneeId: "b" },
      { kind: "DocumentUnassigned", assigneeId: "a" },
      { kind: "DocumentAssigned", assigneeId: "c" }
    ),
    foldAll: (stream) => foldDocumentAssignments(stream),
    foldFrom: (initial, stream) => foldDocumentAssignmentsFrom(initial, stream)
  }),
  foldCase({
    name: "foldDocumentTags",
    events: events(
      { kind: "DocumentTagged", tag: "red" },
      { kind: "DocumentTagged", tag: "blue" },
      { kind: "DocumentUntagged", tag: "red" }
    ),
    foldAll: (stream) => foldDocumentTags(stream),
    foldFrom: (initial, stream) => foldDocumentTagsFrom(initial, stream)
  }),
  foldCase({
    name: "foldDocumentFollowers",
    events: events(
      { kind: "DocumentFollowed", followerId: "a" },
      { kind: "DocumentFollowed", followerId: "b" },
      { kind: "DocumentUnfollowed", followerId: "a" }
    ),
    foldAll: (stream) => foldDocumentFollowers(stream),
    foldFrom: (initial, stream) => foldDocumentFollowersFrom(initial, stream)
  }),
  foldCase({
    name: "foldDocumentShares",
    events: events(
      { kind: "DocumentShared", userId: "a", permissions: ["read"] },
      { kind: "DocumentShared", userId: "b", permissions: ["read", "update"] },
      { kind: "DocumentShareRevoked", userId: "a" },
      { kind: "DocumentShared", userId: "c", permissions: ["read"] }
    ),
    foldAll: (stream) => foldDocumentShares(TENANT, "Note", "One", stream),
    foldFrom: (initial, stream) => foldDocumentSharesFrom(initial, TENANT, "Note", "One", stream)
  }),
  foldCase({
    name: "foldCustomFields",
    events: events(
      {
        kind: "CustomFieldSaved",
        doctypeName: "Note",
        field: { name: "alpha", type: "text" }
      },
      {
        kind: "CustomFieldSaved",
        doctypeName: "Note",
        field: { name: "beta", type: "number" }
      },
      { kind: "CustomFieldDisabled", doctypeName: "Note", fieldName: "alpha" }
    ),
    foldAll: (stream) => foldCustomFields(TENANT, "Note", stream),
    foldFrom: (initial, stream) => foldCustomFieldsFrom(initial, TENANT, "Note", stream)
  }),
  foldCase({
    name: "foldPrintSettings",
    events: events(
      {
        kind: "PrintSettingsChanged",
        settings: { defaultLayout: { pageSize: "A4" } }
      },
      {
        kind: "PrintSettingsChanged",
        settings: { defaultLayout: { pageSize: "Letter" } }
      }
    ),
    foldAll: (stream) => foldPrintSettings(TENANT, stream),
    foldFrom: (initial, stream) => foldPrintSettingsFrom(initial, TENANT, stream)
  }),
  foldCase({
    name: "foldRoleCatalog",
    events: events(
      { kind: "RoleCreated", role: "Auditor", enabled: true },
      { kind: "RoleCreated", role: "Approver", enabled: true },
      { kind: "RoleDescriptionChanged", role: "Auditor", description: "reads everything" },
      { kind: "RoleDisabled", role: "Approver" },
      { kind: "RoleEnabled", role: "Approver" }
    ),
    foldAll: (stream) => foldRoleCatalog(TENANT, stream),
    foldFrom: (initial, stream) => foldRoleCatalogFrom(initial, TENANT, stream)
  }),
  foldCase({
    name: "foldJobScheduleOverrides",
    events: events(
      { kind: "JobScheduleOverrideSet", scheduleId: "nightly", enabled: false },
      { kind: "JobSchedulePaused", scheduleId: "hourly", pausedUntil: "2026-02-01T00:00:00.000Z" },
      { kind: "JobScheduleOverrideCleared", scheduleId: "nightly" },
      { kind: "JobScheduleOverrideSet", scheduleId: "weekly", enabled: true }
    ),
    foldAll: (stream) => foldJobScheduleOverrides(TENANT, stream),
    foldFrom: (initial, stream) => foldJobScheduleOverridesFrom(initial, TENANT, stream)
  }),
  foldCase({
    name: "foldJobScheduleDefinitions",
    events: events(
      {
        kind: "JobScheduleSaved",
        scheduleId: "nightly",
        cron: "0 0 * * *",
        jobName: "rebuild",
        tenantId: TENANT,
        enabled: true
      },
      {
        kind: "JobScheduleSaved",
        scheduleId: "hourly",
        cron: "0 * * * *",
        jobName: "drain",
        tenantId: TENANT,
        enabled: true
      },
      { kind: "JobScheduleDeleted", scheduleId: "nightly", tenantId: TENANT }
    ),
    foldAll: (stream) => foldJobScheduleDefinitions(stream),
    foldFrom: (initial, stream) => foldJobScheduleDefinitionsFrom(initial, stream)
  }),
  foldCase({
    name: "foldUserProfile",
    events: events(
      { kind: "UserProfileChanged", userId: USER, profile: { fullName: "Ada" } },
      { kind: "UserProfileChanged", userId: USER, profile: { timeZone: "UTC" } },
      { kind: "UserProfileChanged", userId: "someone-else", profile: { fullName: "Bob" } }
    ),
    foldAll: (stream) => foldUserProfile(TENANT, USER, stream),
    foldFrom: (initial, stream) => foldUserProfileFrom(initial, TENANT, USER, stream)
  })
];

describe("fold associativity", () => {
  for (const testCase of cases) {
    describe(testCase.name, () => {
      const all = testCase.events;
      const expected = testCase.foldAll(all);

      it("folds the whole stream from an empty prior", () => {
        expect(testCase.foldFrom(null, all)).toEqual(expected);
      });

      for (let split = 0; split <= all.length; split += 1) {
        it(`resumes from a prior folded at ${split}/${all.length}`, () => {
          const head = all.slice(0, split);
          const tail = all.slice(split);
          expect(testCase.foldFrom(testCase.foldAll(head), tail)).toEqual(expected);
        });
      }

      it("is idempotent when the tail is empty", () => {
        expect(testCase.foldFrom(expected, [])).toEqual(expected);
      });
    });
  }
});
