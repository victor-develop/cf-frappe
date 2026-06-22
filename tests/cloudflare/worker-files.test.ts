import {
  createRegistry,
  deterministicIds,
  fileDocType,
  fixedClock,
  InMemoryFileStorage
} from "../../src";
import {
  createCloudFrappeWorker,
  type AggregateCoordinatorRpc,
  type AggregateCoordinatorCommand,
  type RpcDurableObjectNamespace
} from "../../src/cloudflare";
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

  it("exposes the Desk file manager when file support is configured", async () => {
    const worker = createCloudFrappeWorker({
      registry: createRegistry({ doctypes: [fileDocType] }),
      actor: () => owner,
      files: {
        storage: () => new InMemoryFileStorage(),
        clock: fixedClock(now),
        ids: deterministicIds(["object"])
      }
    });
    const env = { DB: fakeD1(), AGGREGATES: fakeNamespace([]) };

    const home = await worker.fetch!(
      cfRequest("http://localhost/desk"),
      env,
      fakeExecutionContext()
    );
    expect(home.status).toBe(200);
    await expect(home.text()).resolves.toContain('href="/desk/files"');

    const files = await worker.fetch!(
      cfRequest("http://localhost/desk/files"),
      env,
      fakeExecutionContext()
    );
    expect(files.status).toBe(200);
    await expect(files.text()).resolves.toContain("Upload File");
  });

  it("applies configured file upload limits to the Desk file manager", async () => {
    const storage = new InMemoryFileStorage();
    const worker = createCloudFrappeWorker({
      registry: createRegistry({ doctypes: [fileDocType] }),
      actor: () => owner,
      files: {
        storage: () => storage,
        maxFileBytes: 4,
        clock: fixedClock(now),
        ids: deterministicIds(["object"])
      }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/desk/files", {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=oversized",
          "content-length": "99"
        },
        body: "--oversized--"
      }),
      { DB: fakeD1(), AGGREGATES: fakeNamespace([]) },
      fakeExecutionContext()
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("File exceeds 4 bytes");
    expect(storage.has("acme/files/file_object-hello.txt")).toBe(false);
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
