import { JobExecutionError } from "../application/job-errors";
import { JobDispatcher } from "../application/job-dispatcher";
import { JobExecutor } from "../application/job-executor";
import { QueryService } from "../application/query-service";
import type { DocumentCommandExecutor } from "../application/document-service";
import { D1ProjectionStore } from "../adapters/d1";
import { createDeskApp } from "../adapters/desk";
import { createResourceApi } from "../adapters/http";
import type { ActorResolver } from "../adapters/http";
import { FrameworkError } from "../core/errors";
import type { JobRegistry, JobRetryPolicy } from "../core/jobs";
import type { ModelRegistry } from "../core/registry";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { JobExecutionLog } from "../ports/job-execution-log";
import type { JobMessage, JobQueue } from "../ports/job-queue";
import {
  DurableObjectCommandExecutor,
  type AggregateCoordinatorRpc,
  type RpcDurableObjectNamespace
} from "./durable-object-command-executor";
import { processCloudflareJobBatch } from "./job-consumer";
import { dispatchScheduledJobs, type ScheduledJobDefinition } from "./scheduled-jobs";

export interface CloudFrappeEnv {
  readonly DB: D1Database;
  readonly AGGREGATES: RpcDurableObjectNamespace<AggregateCoordinatorRpc>;
}

export interface CloudFrappeRuntimeServices {
  readonly registry: ModelRegistry;
  readonly documents: DocumentCommandExecutor;
  readonly queries: QueryService;
}

export interface CloudFrappeJobOptions<
  TEnv extends CloudFrappeEnv = CloudFrappeEnv,
  TResources = CloudFrappeRuntimeServices
> {
  readonly registry: JobRegistry<TResources>;
  readonly queue: (env: TEnv, services: CloudFrappeRuntimeServices) => JobQueue;
  readonly resources?: (env: TEnv, services: CloudFrappeRuntimeServices) => TResources;
  readonly executionLog?: (env: TEnv, services: CloudFrappeRuntimeServices) => JobExecutionLog;
  readonly schedules?: readonly ScheduledJobDefinition<TEnv>[];
  readonly retry?: JobRetryPolicy;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

export interface CloudFrappeWorkerOptions<
  TEnv extends CloudFrappeEnv = CloudFrappeEnv,
  TJobResources = CloudFrappeRuntimeServices
> {
  readonly registry: ModelRegistry;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
  readonly jobs?: CloudFrappeJobOptions<TEnv, TJobResources>;
}

export function createCloudFrappeWorker<
  TEnv extends CloudFrappeEnv = CloudFrappeEnv,
  TJobResources = CloudFrappeRuntimeServices
>(options: CloudFrappeWorkerOptions<TEnv, TJobResources>): ExportedHandler<TEnv, JobMessage> {
  const runtimeApps = new WeakMap<object, RuntimeApps>();
  const jobRuntimes = new WeakMap<object, JobRuntime<TJobResources>>();
  const handler: ExportedHandler<TEnv, JobMessage> = {
    fetch(request, env) {
      const { app, desk } = appsForEnv(runtimeApps, options, env);
      if (isDeskPath(new URL(request.url).pathname)) {
        return desk.fetch(request, env);
      }
      return app.fetch(request, env);
    }
  };
  const jobOptions = options.jobs;
  if (jobOptions) {
    handler.queue = (batch, env) => {
      const runtime = jobsForEnv(jobRuntimes, jobOptions, env, appsForEnv(runtimeApps, options, env).services);
      return processCloudflareJobBatch(batch, {
        executor: runtime.executor,
        ...(jobOptions.retry === undefined ? {} : { retry: jobOptions.retry })
      });
    };
    handler.scheduled = async (controller, env) => {
      const runtime = jobsForEnv(jobRuntimes, jobOptions, env, appsForEnv(runtimeApps, options, env).services);
      try {
        const messages = await dispatchScheduledJobs({
          controller,
          env,
          dispatcher: runtime.dispatcher,
          schedules: jobOptions.schedules ?? []
        });
        if (messages.length === 0) {
          controller.noRetry();
        }
      } catch (error) {
        if (isPermanentScheduledDispatchError(error)) {
          controller.noRetry();
          return;
        }
        throw error;
      }
    };
  }
  return handler;
}

interface RuntimeApps {
  readonly app: ReturnType<typeof createResourceApi>;
  readonly desk: ReturnType<typeof createDeskApp>;
  readonly services: CloudFrappeRuntimeServices;
}

interface JobRuntime<TResources> {
  readonly dispatcher: JobDispatcher<TResources>;
  readonly executor: JobExecutor<TResources>;
}

function appsForEnv<TEnv extends CloudFrappeEnv, TJobResources>(
  cache: WeakMap<object, RuntimeApps>,
  options: CloudFrappeWorkerOptions<TEnv, TJobResources>,
  env: TEnv
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
  const services: CloudFrappeRuntimeServices = {
    registry: options.registry,
    documents,
    queries
  };
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
  const runtimeApps = { app, desk, services };
  cache.set(env, runtimeApps);
  return runtimeApps;
}

function jobsForEnv<TEnv extends CloudFrappeEnv, TResources>(
  cache: WeakMap<object, JobRuntime<TResources>>,
  options: CloudFrappeJobOptions<TEnv, TResources>,
  env: TEnv,
  services: CloudFrappeRuntimeServices
): JobRuntime<TResources> {
  const cached = cache.get(env);
  if (cached) {
    return cached;
  }

  const queue = options.queue(env, services);
  const resources = options.resources?.(env, services) ?? (services as TResources);
  const executionLog = options.executionLog?.(env, services);
  const dispatcher = new JobDispatcher({
    registry: options.registry,
    queue,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.ids === undefined ? {} : { ids: options.ids })
  });
  const executor = new JobExecutor({
    registry: options.registry,
    resources,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(executionLog === undefined ? {} : { executionLog })
  });
  const runtime = { dispatcher, executor };
  cache.set(env, runtime);
  return runtime;
}

function isDeskPath(pathname: string): boolean {
  return pathname === "/desk" || pathname.startsWith("/desk/");
}

function isPermanentScheduledDispatchError(error: unknown): boolean {
  if (error instanceof JobExecutionError) {
    return error.kind === "permanent";
  }
  if (error instanceof FrameworkError) {
    return error.status < 500;
  }
  if (error instanceof Response) {
    return error.status !== 429 && error.status < 500;
  }
  return false;
}
