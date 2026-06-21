import { QueryService } from "../application/query-service";
import { D1ProjectionStore } from "../adapters/d1";
import { createDeskApp } from "../adapters/desk";
import { createResourceApi } from "../adapters/http";
import type { ActorResolver } from "../adapters/http";
import type { ModelRegistry } from "../core/registry";
import {
  DurableObjectCommandExecutor,
  type AggregateCoordinatorRpc,
  type RpcDurableObjectNamespace
} from "./durable-object-command-executor";

export interface CloudFrappeEnv {
  readonly DB: D1Database;
  readonly AGGREGATES: RpcDurableObjectNamespace<AggregateCoordinatorRpc>;
}

export interface CloudFrappeWorkerOptions {
  readonly registry: ModelRegistry;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createCloudFrappeWorker(options: CloudFrappeWorkerOptions): ExportedHandler<CloudFrappeEnv> {
  const runtimeApps = new WeakMap<object, RuntimeApps>();
  return {
    fetch(request, env) {
      const { app, desk } = appsForEnv(runtimeApps, options, env);
      if (isDeskPath(new URL(request.url).pathname)) {
        return desk.fetch(request, env);
      }
      return app.fetch(request, env);
    }
  };
}

interface RuntimeApps {
  readonly app: ReturnType<typeof createResourceApi>;
  readonly desk: ReturnType<typeof createDeskApp>;
}

function appsForEnv(
  cache: WeakMap<object, RuntimeApps>,
  options: CloudFrappeWorkerOptions,
  env: CloudFrappeEnv
): RuntimeApps {
  const cached = cache.get(env);
  if (cached) {
    return cached;
  }
  const projections = new D1ProjectionStore(env.DB);
  const documents = new DurableObjectCommandExecutor({
    registry: options.registry,
    namespace: env.AGGREGATES
  });
  const queries = new QueryService({ registry: options.registry, projections });
  const app = createResourceApi({
    registry: options.registry,
    documents,
    queries,
    actor: options.actor,
    ...(options.maxJsonBytes ? { maxJsonBytes: options.maxJsonBytes } : {})
  });
  const desk = createDeskApp({
    registry: options.registry,
    documents,
    queries,
    actor: options.actor
  });
  const runtimeApps = { app, desk };
  cache.set(env, runtimeApps);
  return runtimeApps;
}

function isDeskPath(pathname: string): boolean {
  return pathname === "/desk" || pathname.startsWith("/desk/");
}
