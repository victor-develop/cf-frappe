import { badRequest } from "../core/errors.js";
import type { DomainEvent } from "../core/types.js";

export const DEFAULT_TIMELINE_LIMIT = 50;
export const MAX_TIMELINE_LIMIT = 200;
export const DEFAULT_DIFF_BASELINE_EVENT_LIMIT = 1_000;

export interface DocumentTimelinePage {
  readonly visibleEvents: readonly DomainEvent[];
  readonly nextBeforeSequence?: number;
}

export function selectDocumentTimelinePage(options: {
  readonly events: readonly DomainEvent[];
  readonly beforeSequence: number;
  readonly limit: number;
}): DocumentTimelinePage {
  const authorizedEvents = options.events
    .filter((event) => event.sequence <= options.beforeSequence)
    .sort(bySequence);
  const hasMore = authorizedEvents.length > options.limit;
  const overflow = hasMore ? authorizedEvents[authorizedEvents.length - options.limit - 1] : undefined;
  const visibleEvents = hasMore
    ? authorizedEvents.slice(authorizedEvents.length - options.limit)
    : authorizedEvents;
  return {
    visibleEvents,
    ...(overflow === undefined ? {} : { nextBeforeSequence: overflow.sequence })
  };
}

export function normalizeDocumentTimelineLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_TIMELINE_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("Timeline limit must be a positive integer");
  }
  return Math.min(limit, MAX_TIMELINE_LIMIT);
}

export function normalizeDocumentTimelineBaselineLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_DIFF_BASELINE_EVENT_LIMIT;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw badRequest("Timeline diff baseline event limit must be a non-negative integer");
  }
  return value;
}

export function normalizeDocumentTimelineBeforeSequence(
  beforeSequence: number | undefined,
  authorizedVersion: number
): number {
  if (beforeSequence === undefined) {
    return authorizedVersion;
  }
  if (!Number.isInteger(beforeSequence) || beforeSequence < 1) {
    throw badRequest("Timeline beforeSequence must be a positive integer");
  }
  return Math.min(beforeSequence, authorizedVersion);
}

export function documentTimelineBaselineEventCount(
  firstVisibleSequence: number | undefined,
  maxDiffBaselineEvents: number
): number | undefined {
  if (firstVisibleSequence === undefined || firstVisibleSequence <= 1) {
    return undefined;
  }
  const baselineEventCount = firstVisibleSequence - 1;
  if (baselineEventCount > maxDiffBaselineEvents) {
    throw badRequest(
      `Timeline diff baseline needs ${baselineEventCount} prior events, exceeding the configured limit of ${maxDiffBaselineEvents}`
    );
  }
  return baselineEventCount;
}

function bySequence(left: DomainEvent, right: DomainEvent): number {
  return left.sequence - right.sequence;
}
