import type { DocumentHooks } from "../core/registry";
import { realtimeEventFromDomainEvent } from "../core/realtime";
import type { RealtimePublisher } from "../ports/realtime";

export function createDocumentRealtimeHooks(publisher: RealtimePublisher): DocumentHooks {
  return {
    async afterCommit({ event, snapshot }) {
      await publisher.publish(realtimeEventFromDomainEvent(event, snapshot));
    }
  };
}
