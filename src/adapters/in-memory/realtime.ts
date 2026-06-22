import type { RealtimeEvent } from "../../core/realtime.js";
import type { RealtimePublisher, RealtimePublishResult } from "../../ports/realtime.js";

export class InMemoryRealtimePublisher implements RealtimePublisher {
  private readonly published: RealtimeEvent[] = [];

  async publish(event: RealtimeEvent): Promise<RealtimePublishResult> {
    this.published.push(event);
    return { delivered: event.topics.length };
  }

  events(): readonly RealtimeEvent[] {
    return [...this.published];
  }

  clear(): void {
    this.published.length = 0;
  }
}
