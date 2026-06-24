import { createRegistry } from "../../src";
import { DurableObjectCommandExecutor, type RpcDurableObjectNamespace } from "../../src/cloudflare";
import { createTestRegistry, data, owner, supportTicketDocType } from "../helpers";

describe("DurableObjectCommandExecutor", () => {
  it("routes create commands by tenant, doctype, and previewed document name", async () => {
    const calls: unknown[] = [];
    const names: string[] = [];
    const namespace = fakeNamespace(names, calls);
    const executor = new DurableObjectCommandExecutor({
      registry: createTestRegistry(),
      namespace
    });

    await executor.create({ actor: owner, doctype: "Note", data: data() });

    expect(names).toEqual(["acme:Note:My Note"]);
    expect(calls).toMatchObject([{ kind: "create", doctype: "Note" }]);
  });

  it("routes series-named creates through a shared series aggregate", async () => {
    const calls: unknown[] = [];
    const names: string[] = [];
    const namespace = fakeNamespace(names, calls);
    const executor = new DurableObjectCommandExecutor({
      registry: createRegistry({ doctypes: [supportTicketDocType] }),
      namespace
    });

    await executor.create({ actor: owner, doctype: "Support Ticket", data: { subject: "First" } });
    await executor.create({ actor: owner, doctype: "Support Ticket", name: "MANUAL-1", data: { subject: "Second" } });

    expect(names).toEqual([
      "acme:Support Ticket:_series:TICK-.####",
      "acme:Support Ticket:_series:TICK-.####"
    ]);
    expect(calls).toMatchObject([
      { kind: "create", doctype: "Support Ticket" },
      { kind: "create", doctype: "Support Ticket" }
    ]);
  });

  it("routes duplicate commands by destination name or naming-series aggregate", async () => {
    const calls: unknown[] = [];
    const names: string[] = [];
    const namespace = fakeNamespace(names, calls);
    const executor = new DurableObjectCommandExecutor({
      registry: createTestRegistry(),
      namespace
    });

    await executor.duplicate({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      data: { title: "My Note Copy" },
      expectedVersion: 1
    });
    await executor.duplicate({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      newName: "Manual Copy",
      expectedVersion: 1
    });

    const seriesCalls: unknown[] = [];
    const seriesNames: string[] = [];
    const seriesExecutor = new DurableObjectCommandExecutor({
      registry: createRegistry({ doctypes: [supportTicketDocType] }),
      namespace: fakeNamespace(seriesNames, seriesCalls)
    });
    await seriesExecutor.duplicate({
      actor: owner,
      doctype: "Support Ticket",
      name: "TICK-.0001",
      data: { subject: "Copied ticket" },
      expectedVersion: 1
    });

    expect(names).toEqual(["acme:Note:My Note Copy", "acme:Note:Manual Copy"]);
    expect(calls).toMatchObject([
      { kind: "duplicate", name: "My Note", data: { title: "My Note Copy" }, expectedVersion: 1 },
      { kind: "duplicate", name: "My Note", newName: "Manual Copy", expectedVersion: 1 }
    ]);
    expect(seriesNames).toEqual(["acme:Support Ticket:_series:TICK-.####"]);
    expect(seriesCalls).toMatchObject([{ kind: "duplicate", doctype: "Support Ticket" }]);
  });

  it("routes amend commands by destination name or naming-series aggregate", async () => {
    const calls: unknown[] = [];
    const names: string[] = [];
    const namespace = fakeNamespace(names, calls);
    const executor = new DurableObjectCommandExecutor({
      registry: createTestRegistry(),
      namespace
    });

    await executor.amend({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      data: { title: "My Note Rev 1" },
      expectedVersion: 3
    });
    await executor.amend({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      newName: "Manual Rev 1",
      expectedVersion: 3
    });

    const seriesCalls: unknown[] = [];
    const seriesNames: string[] = [];
    const seriesExecutor = new DurableObjectCommandExecutor({
      registry: createRegistry({ doctypes: [supportTicketDocType] }),
      namespace: fakeNamespace(seriesNames, seriesCalls)
    });
    await seriesExecutor.amend({
      actor: owner,
      doctype: "Support Ticket",
      name: "TICK-.0001",
      data: { subject: "Amended ticket" },
      expectedVersion: 3
    });

    expect(names).toEqual(["acme:Note:My Note Rev 1", "acme:Note:Manual Rev 1"]);
    expect(calls).toMatchObject([
      { kind: "amend", name: "My Note", data: { title: "My Note Rev 1" }, expectedVersion: 3 },
      { kind: "amend", name: "My Note", newName: "Manual Rev 1", expectedVersion: 3 }
    ]);
    expect(seriesNames).toEqual(["acme:Support Ticket:_series:TICK-.####"]);
    expect(seriesCalls).toMatchObject([{ kind: "amend", doctype: "Support Ticket" }]);
  });

  it("routes named mutations to the same aggregate identity", async () => {
    const calls: unknown[] = [];
    const names: string[] = [];
    const namespace = fakeNamespace(names, calls);
    const executor = new DurableObjectCommandExecutor({
      registry: createTestRegistry(),
      namespace
    });

    await executor.update({ actor: owner, doctype: "Note", name: "My Note", patch: { body: "New" } });
    await executor.merge({ actor: owner, doctype: "Note", name: "My Note", baseVersion: 1, patch: { title: "Merged" } });
    await executor.submit({ actor: owner, doctype: "Note", name: "My Note" });
    await executor.cancel({ actor: owner, doctype: "Note", name: "My Note" });
    await executor.transition({ actor: owner, doctype: "Note", name: "My Note", action: "close" });
    await executor.execute({ actor: owner, doctype: "Note", name: "My Note", command: "archive", input: {} });
    await executor.comment({ actor: owner, doctype: "Note", name: "My Note", text: "Routed comment" });
    await executor.recordActivity({ actor: owner, doctype: "Note", name: "My Note", subject: "Follow-up sent" });
    await executor.assign({ actor: owner, doctype: "Note", name: "My Note", assignee: "support@example.com" });
    await executor.unassign({ actor: owner, doctype: "Note", name: "My Note", assignee: "support@example.com" });
    await executor.tag({ actor: owner, doctype: "Note", name: "My Note", tag: "Urgent" });
    await executor.untag({ actor: owner, doctype: "Note", name: "My Note", tag: "Urgent" });
    await executor.follow({ actor: owner, doctype: "Note", name: "My Note" });
    await executor.unfollow({ actor: owner, doctype: "Note", name: "My Note" });
    await executor.share({
      actor: owner,
      doctype: "Note",
      name: "My Note",
      userId: "collab@example.com",
      permissions: ["read"]
    });
    await executor.revokeShare({ actor: owner, doctype: "Note", name: "My Note", userId: "collab@example.com" });
    await executor.delete({ actor: owner, doctype: "Note", name: "My Note" });

    expect(names).toEqual([
      "acme:Note:My Note",
      "acme:Note:My Note",
      "acme:Note:My Note",
      "acme:Note:My Note",
      "acme:Note:My Note",
      "acme:Note:My Note",
      "acme:Note:My Note",
      "acme:Note:My Note",
      "acme:Note:My Note",
      "acme:Note:My Note",
      "acme:Note:My Note",
      "acme:Note:My Note",
      "acme:Note:My Note",
      "acme:Note:My Note",
      "acme:Note:My Note",
      "acme:Note:My Note",
      "acme:Note:My Note"
    ]);
    expect(calls).toMatchObject([
      { kind: "update" },
      { kind: "merge", baseVersion: 1, patch: { title: "Merged" } },
      { kind: "submit" },
      { kind: "cancel" },
      { kind: "transition" },
      { kind: "execute" },
      { kind: "comment" },
      { kind: "recordActivity" },
      { kind: "assign" },
      { kind: "unassign" },
      { kind: "tag" },
      { kind: "untag" },
      { kind: "follow" },
      { kind: "unfollow" },
      { kind: "share" },
      { kind: "revokeShare" },
      { kind: "delete" }
    ]);
  });

  it("routes bulk document commands per aggregate and preserves serializable failure envelopes", async () => {
    const calls: unknown[] = [];
    const names: string[] = [];
    const namespace: RpcDurableObjectNamespace<any> = {
      idFromName(name: string) {
        names.push(name);
        return name as unknown as DurableObjectId;
      },
      get() {
        return {
          transact() {
            throw new Error("Bulk commands should use tryTransact");
          },
          tryTransact(command: { readonly kind: string; readonly name: string; readonly expectedVersion?: number }) {
            calls.push(command);
            if (command.name === "Stale Note") {
              return Promise.resolve({
                ok: false as const,
                failure: {
                  name: command.name,
                  code: "DOCUMENT_CONFLICT" as const,
                  message: "Expected version 99, found 1",
                  status: 409
                }
              });
            }
            return Promise.resolve({
              ok: true as const,
              snapshot: {
                tenantId: "acme",
                doctype: "Note",
                name: command.name,
                version: 2,
                docstatus: "deleted" as const,
                data: { title: command.name },
                createdAt: "now",
                updatedAt: "now"
              }
            });
          }
        };
      }
    };
    const executor = new DurableObjectCommandExecutor({
      registry: createTestRegistry(),
      namespace
    });

    const result = await executor.bulkDelete({
      actor: owner,
      doctype: "Note",
      documents: [
        { name: "Selected Note", expectedVersion: 1 },
        { name: "Stale Note", expectedVersion: 99 }
      ]
    });
    const submitted = await executor.bulkSubmit({
      actor: owner,
      doctype: "Note",
      documents: [{ name: "Submit Note", expectedVersion: 1 }]
    });
    const cancelled = await executor.bulkCancel({
      actor: owner,
      doctype: "Note",
      documents: [{ name: "Cancel Note", expectedVersion: 2 }]
    });
    const transitioned = await executor.bulkTransition({
      actor: owner,
      doctype: "Note",
      action: "close",
      documents: [{ name: "Transition Note", expectedVersion: 1 }]
    });

    expect(names).toEqual([
      "acme:Note:Selected Note",
      "acme:Note:Stale Note",
      "acme:Note:Submit Note",
      "acme:Note:Cancel Note",
      "acme:Note:Transition Note"
    ]);
    expect(calls).toMatchObject([
      { kind: "delete", name: "Selected Note", expectedVersion: 1 },
      { kind: "delete", name: "Stale Note", expectedVersion: 99 },
      { kind: "submit", name: "Submit Note", expectedVersion: 1 },
      { kind: "cancel", name: "Cancel Note", expectedVersion: 2 },
      { kind: "transition", name: "Transition Note", expectedVersion: 1, action: "close" }
    ]);
    expect(result).toMatchObject({
      deleted: [{ name: "Selected Note", snapshot: { docstatus: "deleted", version: 2 } }],
      failed: [
        {
          name: "Stale Note",
          code: "DOCUMENT_CONFLICT",
          message: "Expected version 99, found 1",
          status: 409
        }
      ]
    });
    expect(submitted).toMatchObject({ succeeded: [{ name: "Submit Note", snapshot: { version: 2 } }], failed: [] });
    expect(cancelled).toMatchObject({ succeeded: [{ name: "Cancel Note", snapshot: { version: 2 } }], failed: [] });
    expect(transitioned).toMatchObject({
      succeeded: [{ name: "Transition Note", snapshot: { version: 2 } }],
      failed: []
    });
  });
});

function fakeNamespace(names: string[], calls: unknown[]): RpcDurableObjectNamespace<any> {
  return {
    idFromName(name: string) {
      names.push(name);
      return name as unknown as DurableObjectId;
    },
    get() {
      const transact = (command: unknown) => {
        calls.push(command);
        return Promise.resolve({
          tenantId: "acme",
          doctype: "Note",
          name: "My Note",
          version: 1,
          docstatus: "draft",
          data: { title: "My Note" },
          createdAt: "now",
          updatedAt: "now"
        });
      };
      return {
        transact,
        async tryTransact(command: unknown) {
          return { ok: true as const, snapshot: await transact(command) };
        }
      };
    }
  };
}
