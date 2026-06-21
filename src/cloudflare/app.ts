import { QueryService } from "../application/query-service";
import { D1ProjectionStore } from "../adapters/d1";
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
  return {
    fetch(request, env) {
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
      return app.fetch(request, env);
    }
  };
}
