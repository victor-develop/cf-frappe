import type { RealtimeEvent } from "../../core/realtime.js";
import { badRequest } from "../../core/errors.js";
import { cloneJsonValue, isJsonValue } from "../../core/json.js";
import type { RealtimePublisher, RealtimePublishResult } from "../../ports/realtime.js";

export class InMemoryRealtimePublisher implements RealtimePublisher {
  private readonly published: RealtimeEvent[] = [];

  async publish(event: RealtimeEvent): Promise<RealtimePublishResult> {
    const stored = cloneRealtimeEvent(event);
    this.published.push(stored);
    return { delivered: stored.topics.length };
  }

  events(): readonly RealtimeEvent[] {
    return this.published.map(cloneRealtimeEvent);
  }

  clear(): void {
    this.published.length = 0;
  }
}

function cloneRealtimeEvent(event: RealtimeEvent): RealtimeEvent {
  if (!isJsonValue(event.payload)) {
    throw badRequest("Realtime event payload must be JSON-serializable");
  }
  return {
    ...event,
    topics: [...event.topics],
    payload: cloneJsonValue(event.payload)
  };
}
