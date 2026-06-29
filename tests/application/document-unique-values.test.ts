import { describe, expect, it } from "vitest";

import {
  activeUniqueValueOwner,
  canonicalUniqueValue,
  defineDocType,
  planUniqueValueReservationOwnerLookup,
  planUniqueValueReleaseWriteDecision,
  planUniqueValueReservationWriteDecision,
  planUniqueValueReleaseEvent,
  planUniqueValueReservationEvent,
  projectUniqueValueReleaseWrite,
  projectUniqueValueReservationWrite,
  releasedUniqueValueReservations,
  uniqueReservationOwnerStillOwnsValue,
  uniqueValueEventCommand,
  uniqueValueReservations,
  type DomainEvent,
  type DocumentSnapshot,
  type UniqueValueReservation
} from "../../src";

const Contact = defineDocType({
  name: "Contact",
  fields: [
    { name: "email", type: "text", unique: true },
    { name: "age", type: "integer", unique: true },
    { name: "enabled", type: "boolean", unique: true },
    { name: "display_name", type: "text" }
  ]
});

describe("document unique values", () => {
  it("plans reservation streams for metadata-defined scalar unique fields", () => {
    expect(
      uniqueValueReservations(
        "acme",
        Contact,
        { email: "ada@example.com", age: 36, enabled: true, display_name: "Ada" },
        "ada"
      )
    ).toEqual([
      {
        tenantId: "acme",
        stream: "acme:__UniqueValues:Contact%3Aemail%3As%3Aada%40example%2Ecom",
        doctype: "Contact",
        field: "email",
        valueKey: "s:ada@example.com",
        valueLabel: "ada@example.com",
        documentName: "ada"
      },
      {
        tenantId: "acme",
        stream: "acme:__UniqueValues:Contact%3Aage%3An%3A36",
        doctype: "Contact",
        field: "age",
        valueKey: "n:36",
        valueLabel: "36",
        documentName: "ada"
      },
      {
        tenantId: "acme",
        stream: "acme:__UniqueValues:Contact%3Aenabled%3Ab%3Atrue",
        doctype: "Contact",
        field: "enabled",
        valueKey: "b:true",
        valueLabel: "true",
        documentName: "ada"
      }
    ]);
  });

  it("ignores empty unique values and non-unique fields", () => {
    expect(
      uniqueValueReservations("acme", Contact, { email: "", display_name: "Ada" }, "ada")
    ).toEqual([]);
  });

  it("rejects non-scalar and overlong unique values at the command boundary", () => {
    expect(() => canonicalUniqueValue({ nested: true }, "email")).toThrow("Validation failed");
    expect(() => canonicalUniqueValue("x".repeat(511), "email")).toThrow("Validation failed");
  });

  it("resolves the active owner from a unique-value projection", () => {
    expect(activeUniqueValueOwner(uniqueValueSnapshot({ documentName: "ada", active: true }))).toBe("ada");
    expect(activeUniqueValueOwner(uniqueValueSnapshot({ documentName: "ada", active: false }))).toBeUndefined();
    expect(activeUniqueValueOwner({ ...uniqueValueSnapshot({ documentName: "ada" }), docstatus: "deleted" }))
      .toBeUndefined();
    expect(activeUniqueValueOwner(null)).toBeUndefined();
  });

  it("checks whether a reservation owner still holds the same unique value", () => {
    const reservation = reservationFor("ada@example.com");

    expect(uniqueReservationOwnerStillOwnsValue(reservation, contactSnapshot("ada", "ada@example.com"))).toBe(true);
    expect(uniqueReservationOwnerStillOwnsValue(reservation, contactSnapshot("ada", "grace@example.com"))).toBe(false);
    expect(uniqueReservationOwnerStillOwnsValue(reservation, null)).toBe(false);
  });

  it("returns only reservations that disappeared from the next document state", () => {
    const email = reservationFor("ada@example.com");
    const age = { ...email, stream: "acme:__UniqueValues:Contact%3Aage%3An%3A36", field: "age", valueKey: "n:36" };

    expect(releasedUniqueValueReservations([email, age], [email])).toEqual([age]);
  });

  it("plans unique-value reservation start and transfer events", () => {
    const reservation = reservationFor("ada@example.com");

    expect(planUniqueValueReservationEvent(reservation, null)).toEqual({
      eventType: "UniqueValueStarted",
      documentName: "Contact:email:s:ada@example.com",
      payload: {
        kind: "DocumentCreated",
        data: {
          doctype: "Contact",
          field: "email",
          value: "ada@example.com",
          valueKey: "s:ada@example.com",
          documentName: "ada",
          active: true
        },
        docstatus: "draft"
      },
      metadata: { target_doctype: "Contact", target_field: "email" }
    });

    expect(planUniqueValueReservationEvent({ ...reservation, documentName: "grace" }, uniqueValueSnapshot({}))).toEqual({
      eventType: "UniqueValueReserved",
      documentName: "Contact:email:s:ada@example.com",
      payload: { kind: "DocumentUpdated", patch: { active: true, documentName: "grace" } },
      metadata: { target_doctype: "Contact", target_field: "email" }
    });
  });

  it("plans unique-value release events", () => {
    expect(planUniqueValueReleaseEvent(reservationFor("ada@example.com"))).toEqual({
      eventType: "UniqueValueReleased",
      documentName: "Contact:email:s:ada@example.com",
      payload: { kind: "DocumentUpdated", patch: { active: false } },
      metadata: { target_doctype: "Contact", target_field: "email" }
    });
  });

  it("shapes unique-value reservation event commands from event plans", () => {
    const reservation = reservationFor("ada@example.com");
    const plan = planUniqueValueReservationEvent(reservation, null);

    expect(
      uniqueValueEventCommand({
        reservation,
        actorId: "user@example.com",
        occurredAt: "2026-06-28T02:00:00.000Z",
        plan
      })
    ).toEqual({
      tenantId: "acme",
      stream: "acme:__UniqueValues:Contact%3Aemail%3As%3Aada%40example%2Ecom",
      type: "UniqueValueStarted",
      doctype: "__UniqueValues",
      documentName: "Contact:email:s:ada@example.com",
      actorId: "user@example.com",
      occurredAt: "2026-06-28T02:00:00.000Z",
      payload: plan.payload,
      metadata: { target_doctype: "Contact", target_field: "email" }
    });
  });

  it("shapes unique-value release event commands from event plans", () => {
    const reservation = reservationFor("ada@example.com");
    const plan = planUniqueValueReleaseEvent(reservation);

    expect(
      uniqueValueEventCommand({
        reservation,
        actorId: "user@example.com",
        occurredAt: "2026-06-28T02:00:00.000Z",
        plan
      })
    ).toEqual({
      tenantId: "acme",
      stream: "acme:__UniqueValues:Contact%3Aemail%3As%3Aada%40example%2Ecom",
      type: "UniqueValueReleased",
      doctype: "__UniqueValues",
      documentName: "Contact:email:s:ada@example.com",
      actorId: "user@example.com",
      occurredAt: "2026-06-28T02:00:00.000Z",
      payload: plan.payload,
      metadata: { target_doctype: "Contact", target_field: "email" }
    });
  });

  it("skips owner lookup when no active unique-value owner exists", () => {
    const reservation = reservationFor("ada@example.com");

    expect(planUniqueValueReservationOwnerLookup({ reservation, existing: null })).toEqual({
      status: "skip",
      ownerStillOwnsValue: false
    });
    expect(
      planUniqueValueReservationOwnerLookup({
        reservation,
        existing: uniqueValueSnapshot({ documentName: "grace", active: false })
      })
    ).toEqual({ status: "skip", ownerStillOwnsValue: false });
  });

  it("skips owner lookup when the active owner already matches the reservation", () => {
    const reservation = reservationFor("ada@example.com");

    expect(
      planUniqueValueReservationOwnerLookup({
        reservation,
        existing: uniqueValueSnapshot({ documentName: "ada", active: true })
      })
    ).toEqual({ status: "skip", ownerStillOwnsValue: false });
  });

  it("plans owner lookup when another document owns the unique-value projection", () => {
    expect(
      planUniqueValueReservationOwnerLookup({
        reservation: reservationFor("ada@example.com"),
        existing: uniqueValueSnapshot({ documentName: "grace", active: true })
      })
    ).toEqual({ status: "read-owner", documentName: "grace" });
  });

  it("skips reservation writes when the active owner already matches the document", () => {
    const reservation = reservationFor("ada@example.com");

    expect(
      planUniqueValueReservationWriteDecision({
        reservation,
        existing: uniqueValueSnapshot({ documentName: "ada", active: true }),
        ownerStillOwnsValue: true
      })
    ).toEqual({ status: "skip" });
  });

  it("rejects reservation writes when another active owner still holds the unique value", () => {
    const reservation = reservationFor("ada@example.com");

    expect(
      planUniqueValueReservationWriteDecision({
        reservation,
        existing: uniqueValueSnapshot({ documentName: "grace", active: true }),
        ownerStillOwnsValue: true
      })
    ).toEqual({
      status: "conflict",
      message: "Unique field 'email' on Contact already uses value 'ada@example.com'"
    });
  });

  it("plans reservation writes when an old owner no longer holds the unique value", () => {
    const reservation = reservationFor("ada@example.com");
    const existing = uniqueValueSnapshot({ documentName: "grace", active: true });

    expect(
      planUniqueValueReservationWriteDecision({
        reservation,
        existing,
        ownerStillOwnsValue: false
      })
    ).toEqual({ status: "reserve", reservation, existing });
  });

  it("skips release writes when the unique-value projection is missing", () => {
    expect(
      planUniqueValueReleaseWriteDecision({
        reservation: reservationFor("ada@example.com"),
        existing: null
      })
    ).toEqual({ status: "skip" });
  });

  it("skips release writes when another owner is active", () => {
    expect(
      planUniqueValueReleaseWriteDecision({
        reservation: reservationFor("ada@example.com"),
        existing: uniqueValueSnapshot({ documentName: "grace", active: true })
      })
    ).toEqual({ status: "skip" });
  });

  it("plans release writes when the active owner matches the reservation", () => {
    const reservation = reservationFor("ada@example.com");
    const existing = uniqueValueSnapshot({ documentName: "ada", active: true });

    expect(planUniqueValueReleaseWriteDecision({ reservation, existing })).toEqual({
      status: "release",
      reservation,
      existing
    });
  });

  it("projects new unique-value reservation writes from saved create events", () => {
    const reservation = reservationFor("ada@example.com");

    expect(
      projectUniqueValueReservationWrite({
        reservation,
        existing: null,
        saved: uniqueValueEvent({
          payload: planUniqueValueReservationEvent(reservation, null).payload
        })
      })
    ).toEqual({
      tenantId: "acme",
      doctype: "__UniqueValues",
      name: "Contact:email:s:ada@example.com",
      version: 2,
      docstatus: "draft",
      data: {
        doctype: "Contact",
        field: "email",
        value: "ada@example.com",
        valueKey: "s:ada@example.com",
        documentName: "ada",
        active: true
      },
      createdAt: "2026-06-28T02:00:00.000Z",
      updatedAt: "2026-06-28T02:00:00.000Z"
    });
  });

  it("projects transferred unique-value reservation writes from saved update events", () => {
    const reservation = { ...reservationFor("ada@example.com"), documentName: "grace" };

    expect(
      projectUniqueValueReservationWrite({
        reservation,
        existing: uniqueValueSnapshot({ documentName: "ada", active: true }),
        saved: uniqueValueEvent({
          sequence: 3,
          payload: planUniqueValueReservationEvent(reservation, uniqueValueSnapshot({})).payload
        })
      })
    ).toEqual({
      ...uniqueValueSnapshot({ documentName: "ada", active: true }),
      version: 3,
      data: { documentName: "grace", active: true },
      updatedAt: "2026-06-28T02:00:00.000Z"
    });
  });

  it("projects unique-value release writes from saved update events", () => {
    const existing = uniqueValueSnapshot({ documentName: "ada", valueKey: "s:ada@example.com", active: true });

    expect(
      projectUniqueValueReleaseWrite({
        existing,
        saved: uniqueValueEvent({
          sequence: 4,
          payload: planUniqueValueReleaseEvent(reservationFor("ada@example.com")).payload
        })
      })
    ).toEqual({
      ...existing,
      version: 4,
      data: { documentName: "ada", valueKey: "s:ada@example.com", active: false },
      updatedAt: "2026-06-28T02:00:00.000Z"
    });
  });
});

function reservationFor(email: string): UniqueValueReservation {
  return uniqueValueReservations("acme", Contact, { email }, "ada")[0]!;
}

function contactSnapshot(name: string, email: string): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Contact",
    name,
    version: 1,
    docstatus: "draft",
    data: { email },
    createdAt: "2026-06-28T01:00:00.000Z",
    updatedAt: "2026-06-28T01:00:00.000Z"
  };
}

function uniqueValueSnapshot(data: Record<string, string | boolean>): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "__UniqueValues",
    name: "Contact:email:s:ada@example.com",
    version: 1,
    docstatus: "draft",
    data,
    createdAt: "2026-06-28T01:00:00.000Z",
    updatedAt: "2026-06-28T01:00:00.000Z"
  };
}

function uniqueValueEvent(options: {
  readonly sequence?: number;
  readonly payload: DomainEvent["payload"];
}): DomainEvent {
  return {
    id: "event-1",
    tenantId: "acme",
    stream: "acme:__UniqueValues:Contact%3Aemail%3As%3Aada%40example%2Ecom",
    sequence: options.sequence ?? 2,
    type: options.payload.kind === "DocumentCreated" ? "UniqueValueStarted" : "UniqueValueReserved",
    doctype: "__UniqueValues",
    documentName: "Contact:email:s:ada@example.com",
    actorId: "owner@example.com",
    occurredAt: "2026-06-28T02:00:00.000Z",
    payload: options.payload,
    metadata: {}
  };
}
