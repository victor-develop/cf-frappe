import {
  createCloudFrappeWorker,
  createRegistry,
  deterministicIds,
  fileDocType,
  fixedClock,
  InMemoryFileStorage,
  type AggregateCoordinatorRpc,
  type RpcDurableObjectNamespace
} from "../../src";
import type { AggregateCoordinatorCommand } from "../../src";
import type { DocumentData } from "../../src";
import { now, owner } from "../helpers";

describe("CloudFrappe Worker files", () => {
  it("mounts file routes and creates File metadata through a named aggregate", async () => {
    const aggregateNames: string[] = [];
    const storage = new InMemoryFileStorage();
    const worker = createCloudFrappeWorker({
      registry: createRegistry({ doctypes: [fileDocType] }),
      actor: () => owner,
      files: {
        storage: () => storage,
        clock: fixedClock(now),
        ids: deterministicIds(["object"])
      }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/files?filename=hello.txt", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "hello"
      }),
      { DB: fakeD1(), AGGREGATES: fakeNamespace(aggregateNames) },
      fakeExecutionContext()
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        name: "file_object",
        data: {
          key: "acme/files/file_object-hello.txt",
          filename: "hello.txt"
        }
      }
    });
    expect(aggregateNames).toEqual(["acme:File:file_object"]);
    await expect(new Response((await storage.get("acme/files/file_object-hello.txt"))?.body).text()).resolves.toBe(
      "hello"
    );
  });
});

function fakeNamespace(names: string[]): RpcDurableObjectNamespace<AggregateCoordinatorRpc> {
  return {
    idFromName(name: string) {
      names.push(name);
      return name as unknown as DurableObjectId;
    },
    get() {
      return {
        transact(command: AggregateCoordinatorCommand) {
          if (command.kind !== "create") {
            throw new Error("Only create is expected");
          }
          return Promise.resolve({
            tenantId: command.tenantId ?? command.actor.tenantId ?? "default",
            doctype: command.doctype,
            name: command.name ?? "missing",
            version: 1,
            docstatus: "draft" as const,
            data: command.data as DocumentData,
            createdAt: now,
            updatedAt: now
          });
        }
      };
    }
  };
}

function cfRequest(url: string, init?: RequestInit): Parameters<NonNullable<ReturnType<typeof createCloudFrappeWorker>["fetch"]>>[0] {
  return new Request(url, init) as unknown as Parameters<NonNullable<ReturnType<typeof createCloudFrappeWorker>["fetch"]>>[0];
}

function fakeD1(): D1Database {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async all() {
          return { results: [] };
        },
        async first() {
          return null;
        },
        async run() {
          return { success: true };
        }
      };
    },
    async batch(statements: any[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    dump() {
      throw new Error("Not implemented");
    },
    exec() {
      throw new Error("Not implemented");
    },
    withSession() {
      throw new Error("Not implemented");
    }
  } as unknown as D1Database;
}

function fakeExecutionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {}
  } as unknown as ExecutionContext;
}
