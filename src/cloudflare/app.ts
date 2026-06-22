import { JobExecutionError } from "../application/job-errors";
import { JobDispatcher } from "../application/job-dispatcher";
import { JobExecutor } from "../application/job-executor";
import { DocumentHistoryService } from "../application/document-history-service";
import { PrintService } from "../application/print-service";
import { QueryService } from "../application/query-service";
import { ReportService } from "../application/report-service";
import { SavedListFilterService } from "../application/saved-list-filter-service";
import type { DocumentCommandExecutor } from "../application/document-service";
import { FileService } from "../application/file-service";
import { D1EventStore, D1ProjectionStore } from "../adapters/d1";
import { createDeskApp } from "../adapters/desk";
import { createResourceApi } from "../adapters/http";
import type { ActorResolver } from "../adapters/http";
import { FrameworkError } from "../core/errors";
import type { JobRegistry, JobRetryPolicy } from "../core/jobs";
import { canSubscribeToRealtimeTopic, parseRealtimeTopic, realtimeTopicFromScope } from "../core/realtime";
import type { ModelRegistry } from "../core/registry";
import type { Clock } from "../ports/clock";
import type { FileStorage } from "../ports/file-storage";
import type { IdGenerator } from "../ports/id-generator";
import type { JobExecutionLog } from "../ports/job-execution-log";
import type { JobMessage, JobQueue } from "../ports/job-queue";
import type { RealtimePublisher } from "../ports/realtime";
import {
  DurableObjectCommandExecutor,
  type AggregateCoordinatorRpc,
  type RpcDurableObjectNamespace
} from "./durable-object-command-executor";
import { processCloudflareJobBatch } from "./job-consumer";
import { DurableObjectRealtimePublisher, type RealtimeHubNamespace } from "./realtime-hub";
import { dispatchScheduledJobs, type ScheduledJobDefinition } from "./scheduled-jobs";
import { toErrorResponse } from "../adapters/http";

export interface CloudFrappeEnv {
  readonly DB: D1Database;
  readonly AGGREGATES: RpcDurableObjectNamespace<AggregateCoordinatorRpc>;
}

export interface CloudFrappeRuntimeServices {
  readonly registry: ModelRegistry;
  readonly documents: DocumentCommandExecutor;
  readonly history: DocumentHistoryService;
  readonly savedFilters: SavedListFilterService;
  readonly prints: PrintService;
  readonly queries: QueryService;
  readonly reports: ReportService;
  readonly files?: FileService;
  readonly realtime?: RealtimePublisher;
}

export interface CloudFrappeFileOptions<TEnv extends CloudFrappeEnv = CloudFrappeEnv> {
  readonly storage: (env: TEnv, services: Omit<CloudFrappeRuntimeServices, "files">) => FileStorage;
  readonly maxFileBytes?: number;
  readonly fileDoctype?: string;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

export interface CloudFrappeRealtimeOptions<TEnv extends CloudFrappeEnv = CloudFrappeEnv> {
  readonly namespace: (env: TEnv) => RealtimeHubNamespace;
  readonly route?: string;
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
  readonly files?: CloudFrappeFileOptions<TEnv>;
  readonly realtime?: CloudFrappeRealtimeOptions<TEnv>;
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
      if (options.realtime && isRealtimePath(new URL(request.url).pathname, options.realtime.route)) {
        return handleRealtimeRequest(runtimeApps, request, env, options);
      }
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
  const events = new D1EventStore(env.DB);
  const documents = new DurableObjectCommandExecutor({
    registry: options.registry,
    namespace: env.AGGREGATES
  });
  const queries = new QueryService({ registry: options.registry, projections });
  const history = new DocumentHistoryService({ events, queries });
  const savedFilters = new SavedListFilterService({ registry: options.registry, events });
  const prints = new PrintService({ registry: options.registry, queries });
  const reports = new ReportService({ registry: options.registry, queries });
  const baseServices: Omit<CloudFrappeRuntimeServices, "files"> = {
    registry: options.registry,
    documents,
    history,
    savedFilters,
    prints,
    queries,
    reports
  };
  const files = options.files
    ? new FileService({
        registry: options.registry,
        documents,
        queries,
        storage: options.files.storage(env, baseServices),
        ...(options.files.clock === undefined ? {} : { clock: options.files.clock }),
        ...(options.files.ids === undefined ? {} : { ids: options.files.ids }),
        ...(options.files.maxFileBytes === undefined ? {} : { maxFileBytes: options.files.maxFileBytes }),
        ...(options.files.fileDoctype === undefined ? {} : { fileDoctype: options.files.fileDoctype })
      })
    : undefined;
  const services: CloudFrappeRuntimeServices = files ? { ...baseServices, files } : baseServices;
  const realtime = options.realtime
    ? new DurableObjectRealtimePublisher(options.realtime.namespace(env))
    : undefined;
  const servicesWithRealtime: CloudFrappeRuntimeServices = realtime
    ? { ...services, realtime }
    : services;
  const app = createResourceApi({
    registry: options.registry,
    documents,
    prints,
    queries,
    timeline: history,
    savedFilters,
    reports,
    actor: options.actor,
    ...(options.maxJsonBytes ? { maxJsonBytes: options.maxJsonBytes } : {}),
    ...(files === undefined ? {} : { files }),
    ...(options.files?.maxFileBytes === undefined ? {} : { maxFileBytes: options.files.maxFileBytes })
  });
  const desk = createDeskApp({
    registry: options.registry,
    documents,
    prints,
    queries,
    timeline: history,
    savedFilters,
    reports,
    actor: options.actor
  });
  const runtimeApps = { app, desk, services: servicesWithRealtime };
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

async function handleRealtimeRequest<TEnv extends CloudFrappeEnv, TJobResources>(
  cache: WeakMap<object, RuntimeApps>,
  request: Request,
  env: TEnv,
  options: CloudFrappeWorkerOptions<TEnv, TJobResources>
): Promise<Response> {
  const realtime = options.realtime;
  if (!realtime) {
    return new Response("Realtime is not enabled", { status: 404 });
  }
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }
  const url = new URL(request.url);
  const requestedTopics = [rawQueryValue(url, "topic"), url.searchParams.get("topic")].filter(
    (value): value is string => value !== undefined && value !== null && value !== ""
  );
  if (requestedTopics.length === 0) {
    return Response.json({ error: { code: "BAD_REQUEST", message: "topic is required" } }, { status: 400 });
  }
  const parsedTopic = parseFirstRealtimeTopic(requestedTopics);
  if (!parsedTopic) {
    return Response.json({ error: { code: "BAD_REQUEST", message: "topic is invalid" } }, { status: 400 });
  }
  const topic = realtimeTopicFromScope(parsedTopic);
  let actor;
  try {
    actor = await options.actor(request);
  } catch (error) {
    return jsonErrorResponse(error);
  }
  if (!canSubscribeToRealtimeTopic(actor, topic)) {
    return Response.json({ error: { code: "PERMISSION_DENIED", message: "Permission denied" } }, { status: 403 });
  }
  const { services } = appsForEnv(cache, options, env);
  if (parsedTopic.kind !== "document") {
    return Response.json({ error: { code: "BAD_REQUEST", message: "Only document realtime topics are subscribable" } }, { status: 400 });
  }
  try {
    await services.queries.getDocument(actor, parsedTopic.doctype, parsedTopic.name, parsedTopic.tenantId);
  } catch (error) {
    return jsonErrorResponse(error);
  }
  const namespace = realtime.namespace(env);
  const stub = namespace.get(namespace.idFromName(topic));
  return stub.fetch(requestWithRealtimeTopic(request, topic));
}

function isRealtimePath(pathname: string, route = "/api/realtime"): boolean {
  return pathname === route;
}

function rawQueryValue(url: URL, key: string): string | undefined {
  const prefix = `${encodeURIComponent(key)}=`;
  for (const part of url.search.slice(1).split("&")) {
    if (part.startsWith(prefix)) {
      return part.slice(prefix.length);
    }
  }
  return undefined;
}

function parseFirstRealtimeTopic(candidates: readonly string[]) {
  for (const candidate of candidates) {
    const parsed = parseRealtimeTopic(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function requestWithRealtimeTopic(request: Request, topic: string): Request {
  const url = new URL(request.url);
  url.searchParams.set("topic", topic);
  return new Request(url.toString(), request);
}

function jsonErrorResponse(error: unknown): Response {
  return toErrorResponse(error, {
    json(body: unknown, status: number) {
      return Response.json(body, { status });
    }
  } as any);
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
