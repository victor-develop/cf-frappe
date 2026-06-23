import { AuditService } from "../application/audit-service.js";
import { CustomFieldService } from "../application/custom-field-service.js";
import {
  DATA_PATCH_APPLY_JOB_NAME,
  DataPatchQueueService,
  type DataPatchQueuePort
} from "../application/data-patch-jobs.js";
import { DataPatchService, type DataPatchAdminPort } from "../application/data-patch-service.js";
import { JobExecutionError } from "../application/job-errors.js";
import { JobDispatcher } from "../application/job-dispatcher.js";
import { JobExecutor } from "../application/job-executor.js";
import { JobHistoryService } from "../application/job-history-service.js";
import { JobRetryService } from "../application/job-retry-service.js";
import { JobScheduleService } from "../application/job-schedule-service.js";
import { DocumentHistoryService } from "../application/document-history-service.js";
import { DocumentShareService } from "../application/document-share-service.js";
import { PrintService } from "../application/print-service.js";
import { QueryService } from "../application/query-service.js";
import { ReportService } from "../application/report-service.js";
import { RoleService } from "../application/role-service.js";
import { SavedListFilterService } from "../application/saved-list-filter-service.js";
import { SavedReportService } from "../application/saved-report-service.js";
import { UserAccountService } from "../application/user-account-service.js";
import { UserNotificationService } from "../application/user-notification-service.js";
import { UserProfileService } from "../application/user-profile-service.js";
import { UserPermissionService } from "../application/user-permission-service.js";
import { ModelBackedUserPermissionGrantValidator } from "../application/user-permission-grant-validator.js";
import { RoleCatalogUserRoleValidator } from "../application/user-role-validator.js";
import type { DocumentCommandExecutor } from "../application/document-service.js";
import { FileService } from "../application/file-service.js";
import { webCryptoPbkdf2PasswordHasher } from "../adapters/crypto/index.js";
import { D1DataPatchLog, D1EventStore, D1ProjectionStore } from "../adapters/d1/index.js";
import { createDeskApp } from "../adapters/desk/index.js";
import { createResourceApi, userAccountSessionActorResolver } from "../adapters/http/index.js";
import type { ActorResolver, AuthSessionOptions } from "../adapters/http/index.js";
import { DEFAULT_TENANT_ID, type Actor } from "../core/types.js";
import { FrameworkError } from "../core/errors.js";
import type { JobRegistry, JobRetryPolicy } from "../core/jobs.js";
import type { DataPatchDefinition } from "../core/data-patch.js";
import { canSubscribeToRealtimeTopic, parseRealtimeTopic, realtimeTopicFromScope } from "../core/realtime.js";
import type { ModelRegistry } from "../core/registry.js";
import type { AccountRecoveryNotifier } from "../ports/account-recovery.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { DataPatchLog } from "../ports/data-patch-log.js";
import type { FileScanner } from "../ports/file-scanner.js";
import type { FileStorage } from "../ports/file-storage.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { JobExecutionLog } from "../ports/job-execution-log.js";
import type { JobMessage, JobQueue } from "../ports/job-queue.js";
import type { PasswordHasher } from "../ports/password-hasher.js";
import type { RealtimePublisher } from "../ports/realtime.js";
import {
  DurableObjectCommandExecutor,
  type AggregateCoordinatorRpc,
  type RpcDurableObjectNamespace
} from "./durable-object-command-executor.js";
import { processCloudflareJobBatch } from "./job-consumer.js";
import { DurableObjectRealtimePublisher, type RealtimeHubNamespace } from "./realtime-hub.js";
import {
  dispatchScheduledJob,
  dispatchScheduledJobs,
  type ScheduledJobDefinition
} from "./scheduled-jobs.js";
import { toErrorResponse } from "../adapters/http/index.js";

export interface CloudFrappeEnv {
  readonly DB: D1Database;
  readonly AGGREGATES: RpcDurableObjectNamespace<AggregateCoordinatorRpc>;
}

export interface CloudFrappeRuntimeServices {
  readonly registry: ModelRegistry;
  readonly documents: DocumentCommandExecutor;
  readonly audit: AuditService;
  readonly documentShares: DocumentShareService;
  readonly history: DocumentHistoryService;
  readonly savedFilters: SavedListFilterService;
  readonly userAccounts?: UserAccountService;
  readonly notifications: UserNotificationService;
  readonly userProfiles?: UserProfileService;
  readonly userPermissions: UserPermissionService;
  readonly customFields: CustomFieldService;
  readonly prints: PrintService;
  readonly queries: QueryService;
  readonly reports: ReportService;
  readonly roles: RoleService;
  readonly savedReports: SavedReportService;
  readonly dataPatches?: DataPatchAdminPort;
  readonly files?: FileService;
  readonly realtime?: RealtimePublisher;
}

export interface CloudFrappeFileOptions<TEnv extends CloudFrappeEnv = CloudFrappeEnv> {
  readonly storage: (env: TEnv, services: Omit<CloudFrappeRuntimeServices, "files">) => FileStorage;
  readonly scanner?: (env: TEnv, services: Omit<CloudFrappeRuntimeServices, "files">) => FileScanner;
  readonly maxFileBytes?: number;
  readonly fileDoctype?: string;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

export interface CloudFrappeRealtimeOptions<TEnv extends CloudFrappeEnv = CloudFrappeEnv> {
  readonly namespace: (env: TEnv) => RealtimeHubNamespace;
  readonly route?: string;
}

export interface CloudFrappeAuthOptions<TEnv extends CloudFrappeEnv = CloudFrappeEnv> {
  readonly sessionSecret: (env: TEnv) => string;
  readonly sessionMaxAgeSeconds?: number;
  readonly revalidateSignedSessions?: boolean;
  readonly cookieName?: string;
  readonly cookiePath?: string;
  readonly sameSite?: "Lax" | "Strict" | "None";
  readonly secure?: boolean;
  readonly passwords?: PasswordHasher;
  readonly tokenSecrets?: PasswordHasher;
  readonly recovery?: AccountRecoveryNotifier;
  readonly recoveryTokens?: IdGenerator;
  readonly passwordResetExpiresInSeconds?: number;
  readonly emailVerificationExpiresInSeconds?: number;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly adminRoles?: readonly string[];
  readonly validateRolesWithCatalog?: boolean;
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
  readonly cronTriggers?: readonly string[];
  readonly retry?: JobRetryPolicy;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

export interface CloudFrappeDataPatchOptions<
  TEnv extends CloudFrappeEnv = CloudFrappeEnv,
  TResources = CloudFrappeRuntimeServices
> {
  readonly resources?: (env: TEnv, services: CloudFrappeRuntimeServices) => TResources;
  readonly log?: (env: TEnv, services: CloudFrappeRuntimeServices) => DataPatchLog;
  readonly adminRoles?: readonly string[];
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

export interface CloudFrappeWorkerOptions<
  TEnv extends CloudFrappeEnv = CloudFrappeEnv,
  TJobResources = CloudFrappeRuntimeServices,
  TDataPatchResources = CloudFrappeRuntimeServices
> {
  readonly registry: ModelRegistry;
  readonly actor: CloudFrappeActorResolver<TEnv>;
  readonly maxJsonBytes?: number;
  readonly auth?: CloudFrappeAuthOptions<TEnv>;
  readonly files?: CloudFrappeFileOptions<TEnv>;
  readonly realtime?: CloudFrappeRealtimeOptions<TEnv>;
  readonly jobs?: CloudFrappeJobOptions<TEnv, TJobResources>;
  readonly dataPatches?: CloudFrappeDataPatchOptions<TEnv, TDataPatchResources>;
}

export type CloudFrappeActorResolver<TEnv extends CloudFrappeEnv = CloudFrappeEnv> = (
  request: Request,
  env: TEnv
) => Actor | Promise<Actor>;

export function createCloudFrappeWorker<
  TEnv extends CloudFrappeEnv = CloudFrappeEnv,
  TJobResources = CloudFrappeRuntimeServices,
  TDataPatchResources = CloudFrappeRuntimeServices
>(options: CloudFrappeWorkerOptions<TEnv, TJobResources, TDataPatchResources>): ExportedHandler<TEnv, JobMessage> {
  const runtimeApps = new WeakMap<object, RuntimeApps>();
  const jobRuntimes = new WeakMap<object, JobRuntime<TJobResources>>();
  const handler: ExportedHandler<TEnv, JobMessage> = {
    fetch(request, env) {
      if (options.realtime && isRealtimePath(new URL(request.url).pathname, options.realtime.route)) {
        return handleRealtimeRequest(runtimeApps, jobRuntimes, request, env, options);
      }
      const { app, desk } = appsForEnv(runtimeApps, jobRuntimes, options, env);
      if (isDeskPath(new URL(request.url).pathname)) {
        return desk.fetch(request, env);
      }
      return app.fetch(request, env);
    }
  };
  const jobOptions = options.jobs;
  if (jobOptions) {
    handler.queue = (batch, env) => {
      const apps = appsForEnv(runtimeApps, jobRuntimes, options, env);
      const runtime = jobsForEnv(jobRuntimes, jobOptions, env, apps.services, apps.jobExecutionLog);
      return processCloudflareJobBatch(batch, {
        executor: runtime.executor,
        ...(jobOptions.retry === undefined ? {} : { retry: jobOptions.retry })
      });
    };
    handler.scheduled = async (controller, env) => {
      const apps = appsForEnv(runtimeApps, jobRuntimes, options, env);
      const runtime = jobsForEnv(jobRuntimes, jobOptions, env, apps.services, apps.jobExecutionLog);
      try {
        const messages = await dispatchScheduledJobs({
          controller,
          env,
          dispatcher: runtime.dispatcher,
          schedules: apps.jobSchedules
            ? await apps.jobSchedules.schedulesForCron(controller.cron)
            : jobOptions.schedules ?? []
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
  readonly jobSchedules?: JobScheduleService<ScheduledJobDefinition<any>>;
  readonly jobExecutionLog?: JobExecutionLog;
}

interface JobRuntime<TResources> {
  readonly dispatcher: JobDispatcher<TResources>;
  readonly executor: JobExecutor<TResources>;
}

function appsForEnv<TEnv extends CloudFrappeEnv, TJobResources, TDataPatchResources>(
  cache: WeakMap<object, RuntimeApps>,
  jobRuntimeCache: WeakMap<object, JobRuntime<TJobResources>>,
  options: CloudFrappeWorkerOptions<TEnv, TJobResources, TDataPatchResources>,
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
  const audit = new AuditService({ events });
  const savedFilters = new SavedListFilterService({ registry: options.registry, events });
  const userPermissions = new UserPermissionService({
    events,
    validator: new ModelBackedUserPermissionGrantValidator({ registry: options.registry, events })
  });
  const customFields = new CustomFieldService({
    registry: options.registry,
    events,
    ...(options.auth?.adminRoles === undefined ? {} : { adminRoles: options.auth.adminRoles })
  });
  const documentShares = new DocumentShareService({ events });
  const roleValidator = options.auth?.validateRolesWithCatalog
    ? new RoleCatalogUserRoleValidator({ events })
    : undefined;
  const userAccounts = options.auth
    ? new UserAccountService({
        events,
        passwords: options.auth.passwords ?? webCryptoPbkdf2PasswordHasher(),
        ...(options.auth.tokenSecrets === undefined ? {} : { tokenSecrets: options.auth.tokenSecrets }),
        ...(options.auth.recovery === undefined ? {} : { recovery: options.auth.recovery }),
        ...(options.auth.recoveryTokens === undefined ? {} : { recoveryTokens: options.auth.recoveryTokens }),
        ...(options.auth.passwordResetExpiresInSeconds === undefined
          ? {}
          : { passwordResetExpiresInSeconds: options.auth.passwordResetExpiresInSeconds }),
        ...(options.auth.emailVerificationExpiresInSeconds === undefined
          ? {}
          : { emailVerificationExpiresInSeconds: options.auth.emailVerificationExpiresInSeconds }),
        ...(options.auth.clock === undefined ? {} : { clock: options.auth.clock }),
        ...(options.auth.ids === undefined ? {} : { ids: options.auth.ids }),
        ...(options.auth.adminRoles === undefined ? {} : { adminRoles: options.auth.adminRoles }),
        ...(roleValidator === undefined ? {} : { roleValidator })
      })
    : undefined;
  const userProfiles = options.auth
    ? new UserProfileService({
        events,
        ...(options.auth.clock === undefined ? {} : { clock: options.auth.clock }),
        ...(options.auth.ids === undefined ? {} : { ids: options.auth.ids }),
        ...(options.auth.adminRoles === undefined ? {} : { adminRoles: options.auth.adminRoles })
      })
    : undefined;
  const restrictedQueries = new QueryService({ registry: options.registry, projections, userPermissions, documentShares });
  const restrictedHistory = new DocumentHistoryService({ events, queries: restrictedQueries });
  const prints = new PrintService({ registry: options.registry, queries: restrictedQueries });
  const reports = new ReportService({ registry: options.registry, queries: restrictedQueries });
  const roles = new RoleService({
    events,
    ...(options.auth?.adminRoles === undefined ? {} : { adminRoles: options.auth.adminRoles })
  });
  const notifications = new UserNotificationService({
    events,
    ...(options.auth?.adminRoles === undefined ? {} : { adminRoles: options.auth.adminRoles })
  });
  const savedReports = new SavedReportService({ registry: options.registry, events, reports });
  const baseServices: Omit<CloudFrappeRuntimeServices, "files"> = {
    registry: options.registry,
    documents,
    audit,
    documentShares,
    history: restrictedHistory,
    savedFilters,
    ...(userAccounts === undefined ? {} : { userAccounts }),
    notifications,
    ...(userProfiles === undefined ? {} : { userProfiles }),
    userPermissions,
    customFields,
    prints,
    queries: restrictedQueries,
    reports,
    roles,
    savedReports
  };
  const files = options.files
    ? new FileService({
        registry: options.registry,
        documents,
        queries: restrictedQueries,
        storage: options.files.storage(env, baseServices),
        ...(options.files.scanner === undefined ? {} : { scanner: options.files.scanner(env, baseServices) }),
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
  const dataPatches = dataPatchesForEnv(options, env, servicesWithRealtime);
  const runtimeServices: CloudFrappeRuntimeServices = dataPatches === undefined
    ? servicesWithRealtime
    : { ...servicesWithRealtime, dataPatches };
  const jobOptions = options.jobs;
  const schedules = jobOptions?.schedules ?? [];
  const jobExecutionLog = jobOptions?.executionLog?.(env, runtimeServices);
  const dataPatchQueueEnabled = dataPatches !== undefined &&
    jobOptions !== undefined &&
    jobOptions.registry.has(DATA_PATCH_APPLY_JOB_NAME);
  const jobHistory = jobExecutionLog && jobOptions
    ? new JobHistoryService({ registry: jobOptions.registry, executionLog: jobExecutionLog })
    : undefined;
  const jobRuntime = jobOptions
    ? jobsForEnv(
        jobRuntimeCache,
        jobOptions,
        env,
        runtimeServices,
        jobExecutionLog,
        dataPatchQueueEnabled ? ({ dataPatches } as unknown as Partial<TJobResources>) : undefined
      )
    : undefined;
  const dataPatchQueue: DataPatchQueuePort | undefined = dataPatchQueueEnabled && jobRuntime
    ? new DataPatchQueueService({ dataPatches, dispatcher: jobRuntime.dispatcher })
    : undefined;
  const jobRetry = jobExecutionLog && jobOptions && jobRuntime
    ? new JobRetryService({
        executionLog: jobExecutionLog,
        dispatcher: jobRuntime.dispatcher,
        ...(jobOptions.clock === undefined ? {} : { clock: jobOptions.clock })
      })
    : undefined;
  const jobSchedules = jobOptions && jobRuntime
    ? new JobScheduleService({
        registry: jobOptions.registry,
        schedules,
        runtimeCronTriggers: runtimeCronTriggersFor(jobOptions),
        events,
        ...(jobOptions.clock === undefined ? {} : { clock: jobOptions.clock }),
        ...(jobOptions.ids === undefined ? {} : { ids: jobOptions.ids }),
        runner: {
          async run(schedule, actor) {
            const clock = jobOptions.clock ?? systemClock;
            const dispatchedAt = clock.now();
            return await dispatchScheduledJob({
              cron: schedule.cron,
              scheduledTime: Date.parse(dispatchedAt),
              env,
              dispatcher: jobRuntime.dispatcher,
              schedule: schedule as unknown as ScheduledJobDefinition<TEnv>,
              idempotencyPrefix: "manual",
              metadata: {
                dispatchSource: "manual",
                dispatchedBy: actor.id,
                dispatchedAt
              }
            });
          }
        }
      })
    : undefined;
  const actor = actorResolverForEnv(options, env, userAccounts);
  const app = createResourceApi({
    registry: options.registry,
    documents,
    documentShares,
    prints,
    queries: restrictedQueries,
    timeline: restrictedHistory,
    audit,
    savedFilters,
    savedReports,
    ...(userAccounts === undefined ? {} : { userAccounts }),
    ...(userProfiles === undefined ? {} : { userProfiles }),
    ...(userAccounts === undefined || options.auth === undefined ? {} : { auth: authSessionOptions(options.auth, env) }),
    userPermissions,
    customFields,
    reports,
    roles,
    actor,
    ...(options.maxJsonBytes ? { maxJsonBytes: options.maxJsonBytes } : {}),
    ...(files === undefined ? {} : { files }),
    ...(dataPatches === undefined ? {} : { dataPatches }),
    ...(dataPatchQueue === undefined ? {} : { dataPatchQueue }),
    ...(jobHistory === undefined ? {} : { jobs: jobHistory }),
    ...(jobRetry === undefined ? {} : { jobRetry }),
    ...(jobSchedules === undefined ? {} : { jobSchedules }),
    notifications,
    ...(options.files?.maxFileBytes === undefined ? {} : { maxFileBytes: options.files.maxFileBytes })
  });
  const desk = createDeskApp({
    registry: options.registry,
    documents,
    prints,
    ...(files === undefined ? {} : { files }),
    queries: restrictedQueries,
    documentShares,
    timeline: restrictedHistory,
    savedFilters,
    savedReports,
    ...(userAccounts === undefined ? {} : { userAccounts }),
    ...(userProfiles === undefined ? {} : { userProfiles }),
    userPermissions,
    customFields,
    reports,
    roles,
    ...(dataPatches === undefined ? {} : { dataPatches }),
    ...(jobHistory === undefined ? {} : { jobs: jobHistory }),
    ...(jobRetry === undefined ? {} : { jobRetry }),
    ...(jobSchedules === undefined ? {} : { jobSchedules }),
    notifications,
    ...(options.realtime === undefined ? {} : { realtime: { route: options.realtime.route ?? "/api/realtime" } }),
    ...(options.files?.maxFileBytes === undefined ? {} : { maxFileBytes: options.files.maxFileBytes }),
    actor
  });
  const runtimeApps = {
    app,
    desk,
    services: runtimeServices,
    ...(jobSchedules === undefined ? {} : { jobSchedules }),
    ...(jobExecutionLog === undefined ? {} : { jobExecutionLog })
  };
  cache.set(env, runtimeApps);
  return runtimeApps;
}

function runtimeCronTriggersFor<TEnv extends CloudFrappeEnv, TResources>(
  options: CloudFrappeJobOptions<TEnv, TResources>
): readonly string[] {
  return [
    ...new Set([
      ...(options.cronTriggers ?? []),
      ...(options.schedules ?? []).map((schedule) => schedule.cron)
    ])
  ];
}

function dataPatchesForEnv<TEnv extends CloudFrappeEnv, TResources>(
  options: {
    readonly registry: ModelRegistry;
    readonly dataPatches?: CloudFrappeDataPatchOptions<TEnv, TResources>;
  },
  env: TEnv,
  services: CloudFrappeRuntimeServices
): DataPatchService<TResources> | undefined {
  const patches = options.registry.listDataPatches() as readonly DataPatchDefinition<TResources>[];
  if (patches.length === 0 && !options.dataPatches) {
    return undefined;
  }
  const patchOptions = options.dataPatches;
  const resources = patchOptions?.resources?.(env, services) ?? (services as unknown as TResources);
  const log = patchOptions?.log?.(env, services) ?? new D1DataPatchLog(env.DB);
  return new DataPatchService({
    patches,
    log,
    resources,
    ...(patchOptions?.adminRoles === undefined ? {} : { adminRoles: patchOptions.adminRoles }),
    ...(patchOptions?.clock === undefined ? {} : { clock: patchOptions.clock }),
    ...(patchOptions?.ids === undefined ? {} : { ids: patchOptions.ids })
  });
}

function jobsForEnv<TEnv extends CloudFrappeEnv, TResources>(
  cache: WeakMap<object, JobRuntime<TResources>>,
  options: CloudFrappeJobOptions<TEnv, TResources>,
  env: TEnv,
  services: CloudFrappeRuntimeServices,
  sharedExecutionLog?: JobExecutionLog,
  additionalResources?: Partial<TResources>
): JobRuntime<TResources> {
  const cached = cache.get(env);
  if (cached) {
    return cached;
  }

  const queue = options.queue(env, services);
  const resources = withAdditionalJobResources(
    options.resources?.(env, services) ?? (services as TResources),
    additionalResources
  );
  const executionLog = sharedExecutionLog ?? options.executionLog?.(env, services);
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

function withAdditionalJobResources<TResources>(
  resources: TResources,
  additionalResources: Partial<TResources> | undefined
): TResources {
  if (additionalResources === undefined) {
    return resources;
  }
  if (typeof resources !== "object" || resources === null) {
    throw new FrameworkError("JOB_RESOURCE_INVALID", "CloudFrappe job resources must be an object", { status: 500 });
  }
  Object.assign(resources as object, additionalResources);
  return resources;
}

function authSessionOptions<TEnv extends CloudFrappeEnv>(
  options: CloudFrappeAuthOptions<TEnv>,
  env: TEnv
): AuthSessionOptions {
  return {
    secret: options.sessionSecret(env),
    maxAgeSeconds: options.sessionMaxAgeSeconds ?? 28_800,
    ...(options.cookieName === undefined ? {} : { cookieName: options.cookieName }),
    ...(options.cookiePath === undefined ? {} : { path: options.cookiePath }),
    ...(options.sameSite === undefined ? {} : { sameSite: options.sameSite }),
    ...(options.secure === undefined ? {} : { secure: options.secure })
  };
}

function actorResolverForEnv<TEnv extends CloudFrappeEnv, TJobResources, TDataPatchResources>(
  options: CloudFrappeWorkerOptions<TEnv, TJobResources, TDataPatchResources>,
  env: TEnv,
  userAccounts: UserAccountService | undefined
): ActorResolver {
  const fallbackActor = (request: Request) => options.actor(request, env);
  if (!userAccounts || !options.auth?.revalidateSignedSessions) {
    return fallbackActor;
  }
  return userAccountSessionActorResolver({
    userAccounts,
    secret: options.auth.sessionSecret(env),
    ...(options.auth.cookieName === undefined ? {} : { cookieName: options.auth.cookieName }),
    fallback: fallbackActor
  });
}

function isDeskPath(pathname: string): boolean {
  return pathname === "/desk" || pathname.startsWith("/desk/");
}

async function handleRealtimeRequest<TEnv extends CloudFrappeEnv, TJobResources, TDataPatchResources>(
  cache: WeakMap<object, RuntimeApps>,
  jobRuntimeCache: WeakMap<object, JobRuntime<TJobResources>>,
  request: Request,
  env: TEnv,
  options: CloudFrappeWorkerOptions<TEnv, TJobResources, TDataPatchResources>
): Promise<Response> {
  const realtime = options.realtime;
  if (!realtime) {
    return new Response("Realtime is not enabled", { status: 404 });
  }
  const url = new URL(request.url);
  const isPresenceRequest = isRealtimePresencePath(url.pathname, realtime.route);
  if (isPresenceRequest && request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET" } });
  }
  if (!isPresenceRequest && request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }
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
  const { services } = appsForEnv(cache, jobRuntimeCache, options, env);
  let actor;
  try {
    actor = await actorResolverForEnv(options, env, services.userAccounts)(request);
  } catch (error) {
    return jsonErrorResponse(error);
  }
  if (!canSubscribeToRealtimeTopic(actor, topic)) {
    return Response.json({ error: { code: "PERMISSION_DENIED", message: "Permission denied" } }, { status: 403 });
  }
  try {
    if (parsedTopic.kind === "document") {
      await services.queries.getDocument(actor, parsedTopic.doctype, parsedTopic.name, parsedTopic.tenantId);
    }
    if (parsedTopic.kind === "doctype") {
      services.queries.getMeta(actor, parsedTopic.doctype);
    }
  } catch (error) {
    return jsonErrorResponse(error);
  }
  const namespace = realtime.namespace(env);
  const stub = namespace.get(namespace.idFromName(topic));
  if (isPresenceRequest) {
    const presence = await stub.presence();
    return Response.json({
      data: {
        topic,
        connections: presence.connections
      }
    });
  }
  return stub.fetch(requestWithRealtimeTopic(request, topic, actor));
}

function isRealtimePath(pathname: string, route = "/api/realtime"): boolean {
  return pathname === route || isRealtimePresencePath(pathname, route);
}

function isRealtimePresencePath(pathname: string, route = "/api/realtime"): boolean {
  return pathname === `${route.replace(/\/$/, "")}/presence`;
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

function requestWithRealtimeTopic(request: Request, topic: string, actor: Actor): Request {
  const url = new URL(request.url);
  url.searchParams.set("topic", topic);
  url.searchParams.set("tenantId", actor.tenantId ?? DEFAULT_TENANT_ID);
  url.searchParams.set("userId", actor.id);
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
