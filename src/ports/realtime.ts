import type { RealtimeEvent } from "../core/realtime.js";

export interface RealtimePublishResult {
  readonly delivered: number;
}

export interface RealtimePublisher {
  publish(event: RealtimeEvent): Promise<RealtimePublishResult>;
}
