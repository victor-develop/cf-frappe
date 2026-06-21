import { createCloudFrappeWorker, type AggregateCoordinatorRpc, type RpcDurableObjectNamespace } from "../../src";
import { createTestRegistry, owner } from "../helpers";

describe("CloudFrappe Worker routing", () => {
  it("routes only /desk and /desk/* to the Desk app", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const fetch = worker.fetch!;
    const desk = await fetch(cfRequest("http://localhost/desk"), env, fakeExecutionContext());
    const deskish = await fetch(cfRequest("http://localhost/deskish"), env, fakeExecutionContext());

    expect(desk.status).toBe(200);
    expect(desk.headers.get("content-type")).toContain("text/html");
    expect(deskish.status).toBe(404);
    expect(deskish.headers.get("content-type")).toContain("application/json");
  });
});

function fakeNamespace(): RpcDurableObjectNamespace<AggregateCoordinatorRpc> {
  return {
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get() {
      return {
        transact() {
          throw new Error("Command path should not be used in this test");
        }
      };
    }
  };
}

function cfRequest(url: string): Parameters<NonNullable<ReturnType<typeof createCloudFrappeWorker>["fetch"]>>[0] {
  return new Request(url) as unknown as Parameters<NonNullable<ReturnType<typeof createCloudFrappeWorker>["fetch"]>>[0];
}

function fakeD1(): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return this;
        },
        async all() {
          if (sql.includes("FROM cf_frappe_documents")) {
            return { results: [] };
          }
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
