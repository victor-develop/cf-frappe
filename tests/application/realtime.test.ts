import {
  createDocumentRealtimeHooks,
  InMemoryRealtimePublisher
} from "../../src";
import { createServices, data, owner } from "../helpers";

describe("document realtime hooks", () => {
  it("publishes committed domain events to realtime topics", async () => {
    const publisher = new InMemoryRealtimePublisher();
    const hooks = createDocumentRealtimeHooks(publisher);
    const services = createServices(["evt1"], {
      afterCommit: async (context) => {
        await hooks.afterCommit?.(context);
      }
    });

    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Realtime" }) });

    expect(publisher.events()).toHaveLength(1);
    expect(publisher.events()[0]).toMatchObject({
      id: "evt_evt1",
      type: "NoteCreated",
      topics: ["tenant:acme", "doctype:acme:Note", "document:acme:Note:Realtime"]
    });
  });
});
