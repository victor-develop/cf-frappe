import { cloneRealtimeEvent, type RealtimeEvent } from "../../core/realtime.js";
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
