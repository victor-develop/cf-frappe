import {
  documentTimelineBaselineEventCount,
  normalizeDocumentTimelineBaselineLimit,
  normalizeDocumentTimelineBeforeSequence,
  normalizeDocumentTimelineLimit,
  selectDocumentTimelinePage,
  type DomainEvent
} from "../../src";

describe("document history policy", () => {
  it("selects authorized timeline pages in sequence order with older-event cursors", () => {
    const page = selectDocumentTimelinePage({
      events: [
        event(4, "evt-4"),
        event(1, "evt-1"),
        event(5, "evt-5"),
        event(3, "evt-3"),
        event(2, "evt-2")
      ],
      beforeSequence: 4,
      limit: 2
    });

    expect(page.visibleEvents.map((item) => item.sequence)).toEqual([3, 4]);
    expect(page.nextBeforeSequence).toBe(2);
  });

  it("omits older-event cursors when the selected timeline page is exact", () => {
    const page = selectDocumentTimelinePage({
      events: [event(1, "evt-1"), event(2, "evt-2")],
      beforeSequence: 2,
      limit: 10
    });

    expect(page.visibleEvents.map((item) => item.sequence)).toEqual([1, 2]);
    expect(page.nextBeforeSequence).toBeUndefined();
  });

  it("normalizes timeline limits and beforeSequence cursors", () => {
    expect(normalizeDocumentTimelineLimit(undefined)).toBe(50);
    expect(normalizeDocumentTimelineLimit(500)).toBe(200);
    expect(normalizeDocumentTimelineBeforeSequence(undefined, 7)).toBe(7);
    expect(normalizeDocumentTimelineBeforeSequence(10, 7)).toBe(7);
    expect(normalizeDocumentTimelineBeforeSequence(3, 7)).toBe(3);
    expect(() => normalizeDocumentTimelineLimit(0)).toThrow("Timeline limit must be a positive integer");
    expect(() => normalizeDocumentTimelineBeforeSequence(1.5, 7))
      .toThrow("Timeline beforeSequence must be a positive integer");
  });

  it("normalizes diff baseline budgets", () => {
    expect(normalizeDocumentTimelineBaselineLimit(undefined)).toBe(1_000);
    expect(normalizeDocumentTimelineBaselineLimit(0)).toBe(0);
    expect(normalizeDocumentTimelineBaselineLimit(5)).toBe(5);
    expect(() => normalizeDocumentTimelineBaselineLimit(-1))
      .toThrow("Timeline diff baseline event limit must be a non-negative integer");
  });

  it("calculates baseline event counts and rejects exhausted baseline budgets", () => {
    expect(documentTimelineBaselineEventCount(undefined, 3)).toBeUndefined();
    expect(documentTimelineBaselineEventCount(1, 3)).toBeUndefined();
    expect(documentTimelineBaselineEventCount(4, 3)).toBe(3);
    expect(() => documentTimelineBaselineEventCount(5, 3))
      .toThrow("Timeline diff baseline needs 4 prior events, exceeding the configured limit of 3");
  });
});

function event(sequence: number, id: string): DomainEvent {
  return {
    id,
    stream: "tenant:acme:doctype:Note:document:Timeline",
    sequence,
    type: "NoteUpdated",
    tenantId: "acme",
    doctype: "Note",
    documentName: "Timeline",
    actorId: "owner@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { kind: "DocumentUpdated", patch: { count: sequence } },
    metadata: {}
  };
}
