import type { RealtimeEvent } from "../core/realtime";

export interface RealtimePublishResult {
  readonly delivered: number;
}

export interface RealtimePublisher {
  publish(event: RealtimeEvent): Promise<RealtimePublishResult>;
}
