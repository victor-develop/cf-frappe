import { AuditService } from "../application/audit-service.js";
import { AssignmentRuleService } from "../application/assignment-rule-service.js";
import { CalendarService } from "../application/calendar-service.js";
import { CustomFieldService } from "../application/custom-field-service.js";
import { DashboardService } from "../application/dashboard-service.js";
import {
  DATA_PATCH_APPLY_JOB_NAME,
  DATA_PATCH_ROLLBACK_JOB_NAME,
  DATA_PATCH_ROLLBACK_RETRY_JOB_NAME,
  DataPatchQueueService,
  type DataPatchQueuePort,
  type DataPatchRollbackQueuePort,
  type DataPatchRollbackRetryQueuePort
} from "../application/data-patch-jobs.js";
import { DataPatchService, type DataPatchAdminPort } from "../application/data-patch-service.js";
import { JobExecutionError } from "../application/job-errors.js";
import { JobDispatcher } from "../application/job-dispatcher.js";
import { JobExecutor } from "../application/job-executor.js";
import { JobHistoryService } from "../application/job-history-service.js";
import { JobRetryService } from "../application/job-retry-service.js";
import { JobScheduleService } from "../application/job-schedule-service.js";
import {
  createDocumentDeliveryOutboxDeliveryHandlers,
  DOCUMENT_DELIVERY_OUTBOX_DRAIN_JOB_NAME,
  DocumentDeliveryOutboxConsumer
} from "../application/document-delivery-outbox-consumer.js";
import { DocumentDeliveryOutboxService } from "../application/document-delivery-outbox-service.js";
import { KanbanService } from "../application/kanban-service.js";
import { DocumentHistoryService } from "../application/document-history-service.js";
import { DocumentShareService } from "../application/document-share-service.js";
import { FieldPropertyService } from "../application/field-property-service.js";
import { PrintSettingsService } from "../application/print-settings-service.js";
import { PrintService } from "../application/print-service.js";
import { QueryService } from "../application/query-service.js";
import { ReportService } from "../application/report-service.js";
import { RoleService } from "../application/role-service.js";
import { SavedListFilterService } from "../application/saved-list-filter-service.js";
import { SavedReportService } from "../application/saved-report-service.js";
import { NotificationRuleService } from "../application/notification-rule-service.js";
import type { EmailNotificationService } from "../application/email-notification-service.js";
import { UserAccountService } from "../application/user-account-service.js";
import { UserNotificationService } from "../application/user-notification-service.js";
import { UserProfileService } from "../application/user-profile-service.js";
import { UserPermissionService } from "../application/user-permission-service.js";
import { WebFormService } from "../application/web-form-service.js";
import { WebPageService } from "../application/web-page-service.js";
import { WebViewService } from "../application/web-view-service.js";
import { WebsiteSettingsService } from "../application/website-settings-service.js";
import { WebsiteThemeService } from "../application/website-theme-service.js";
import { WorkflowService } from "../application/workflow-service.js";
import { ModelBackedUserPermissionGrantValidator } from "../application/user-permission-grant-validator.js";
import { RoleCatalogUserRoleValidator } from "../application/user-role-validator.js";
import type { DocumentCommandExecutor } from "../application/document-service.js";
import { FileService } from "../application/file-service.js";
import { webCryptoPbkdf2PasswordHasher } from "../adapters/crypto/index.js";
import { D1DataPatchLog, D1EventStore, D1ProjectionStore } from "../adapters/d1/index.js";
import { createDeskApp } from "../adapters/desk/index.js";
import {
  cloudflareAccessAccountSyncActorResolver,
  createResourceApi,
  hasCloudflareAccessToken,
  hasOidcToken,
  oidcAccountSyncActorResolver,
  userAccountSessionActorResolver
} from "../adapters/http/index.js";
import type {
  ActorResolver,
  AuthSessionOptions,
  CloudflareAccessAccountSyncActorResolverOptions,
  OidcAccountSyncActorResolverOptions
} from "../adapters/http/index.js";
import { DEFAULT_TENANT_ID, SYSTEM_MANAGER_ROLE, type Actor, type DocTypeDefinition } from "../core/types.js";
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
import type { FileTransformer } from "../ports/file-transformer.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { JobExecutionLog } from "../ports/job-execution-log.js";
import type { JobMessage, JobQueue } from "../ports/job-queue.js";
import type { PasswordHasher } from "../ports/password-hasher.js";
import type { PrintPdfRenderer } from "../ports/print-pdf-renderer.js";
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
  readonly notificationRules: NotificationRuleService;
  readonly assignmentRules: AssignmentRuleService;
  readonly userProfiles?: UserProfileService;
  readonly userPermissions: UserPermissionService;
  readonly customFields: CustomFieldService;
  readonly fieldProperties: FieldPropertyService;
  readonly workflows: WorkflowService;
  readonly printSettings: PrintSettingsService;
  readonly prints: PrintService;
  readonly queries: QueryService;
  readonly reports: ReportService;
  readonly dashboards: DashboardService;
  readonly kanbans: KanbanService;
  readonly calendars: CalendarService;
  readonly webForms: WebFormService;
  readonly webPages: WebPageService;
  readonly webViews: WebViewService;
  readonly websiteSettings: WebsiteSettingsService;
  readonly websiteThemes: WebsiteThemeService;
  readonly roles: RoleService;
  readonly savedReports: SavedReportService;
  readonly dataPatches?: DataPatchAdminPort;
  readonly documentDeliveryOutbox?: DocumentDeliveryOutboxService;
  readonly documentDeliveryOutboxConsumer?: DocumentDeliveryOutboxConsumer;
  readonly files?: FileService;
  readonly realtime?: RealtimePublisher;
}

export interface CloudFrappeFileOptions<TEnv extends CloudFrappeEnv = CloudFrappeEnv> {
  readonly storage: (env: TEnv, services: Omit<CloudFrappeRuntimeServices, "files">) => FileStorage;
  readonly scanner?: (env: TEnv, services: Omit<CloudFrappeRuntimeServices, "files">) => FileScanner;
  readonly transformer?: (env: TEnv, services: Omit<CloudFrappeRuntimeServices, "files">) => FileTransformer;
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
  readonly cloudflareAccess?: CloudFrappeAccessAccountSyncOptions<TEnv>;
  readonly oidc?: CloudFrappeOidcAccountSyncOptions<TEnv> | readonly CloudFrappeOidcAccountSyncOptions<TEnv>[];
}

export interface CloudFrappeAccessAccountSyncOptions<TEnv extends CloudFrappeEnv = CloudFrappeEnv>
  extends Omit<
    CloudflareAccessAccountSyncActorResolverOptions,
    "teamDomain" | "audience" | "fallback" | "userAccounts" | "syncActorRoles"
  > {
  readonly teamDomain: string | ((env: TEnv) => string);
  readonly audience: string | readonly string[] | ((env: TEnv) => string | readonly string[]);
  readonly syncActorRoles?: readonly string[];
}

export interface CloudFrappeOidcAccountSyncOptions<TEnv extends CloudFrappeEnv = CloudFrappeEnv>
  extends Omit<
    OidcAccountSyncActorResolverOptions,
    "issuer" | "audience" | "jwksUrl" | "fallback" | "userAccounts" | "syncActorRoles"
  > {
  readonly issuer: string | ((env: TEnv) => string);
  readonly audience: string | readonly string[] | ((env: TEnv) => string | readonly string[]);
  readonly jwksUrl: string | ((env: TEnv) => string);
  readonly syncActorRoles?: readonly string[];
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

export interface CloudFrappeDocumentDeliveryOutboxOptions<TEnv extends CloudFrappeEnv = CloudFrappeEnv> {
  readonly emailNotifications?: (
    env: TEnv,
    services: { readonly events: D1EventStore; readonly notificationRules: NotificationRuleService }
  ) => EmailNotificationService;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly retry?: {
    readonly baseDelaySeconds?: number;
    readonly maxDelaySeconds?: number;
  };
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
  readonly documentDeliveryOutbox?: boolean | CloudFrappeDocumentDeliveryOutboxOptions<TEnv>;
  readonly jobs?: CloudFrappeJobOptions<TEnv, TJobResources>;
  readonly dataPatches?: CloudFrappeDataPatchOptions<TEnv, TDataPatchResources>;
  readonly printPdfRenderer?: (env: TEnv, services: CloudFrappeRuntimeServices) => PrintPdfRenderer;
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
  const userPermissions = new UserPermissionService({
    events,
    validator: new ModelBackedUserPermissionGrantValidator({ registry: options.registry, events })
  });
  const customFields = new CustomFieldService({
    registry: options.registry,
    events,
    ...(options.auth?.adminRoles === undefined ? {} : { adminRoles: options.auth.adminRoles })
  });
  const prePropertyDocType = (base: DocTypeDefinition, context: { readonly tenantId: string }) =>
    customFields.effectiveDocType(base.name, context.tenantId);
  const fieldProperties = new FieldPropertyService({
    registry: options.registry,
    events,
    ...(options.auth?.adminRoles === undefined ? {} : { adminRoles: options.auth.adminRoles }),
    prePropertyDocTypeResolver: prePropertyDocType
  });
  const preWorkflowDocType = (base: DocTypeDefinition, context: { readonly tenantId: string }) =>
    fieldProperties.effectiveDocType(base.name, context.tenantId);
  const workflows = new WorkflowService({
    registry: options.registry,
    events,
    ...(options.auth?.adminRoles === undefined ? {} : { adminRoles: options.auth.adminRoles }),
    preWorkflowDocTypeResolver: preWorkflowDocType
  });
  const effectiveDocType = (base: DocTypeDefinition, context: { readonly tenantId: string }) =>
    workflows.effectiveDocType(base.name, context.tenantId);
  const savedFilters = new SavedListFilterService({
    registry: options.registry,
    events,
    doctypeResolver: effectiveDocType
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
  const restrictedQueries = new QueryService({
    registry: options.registry,
    projections,
    doctypeResolver: effectiveDocType,
    userPermissions,
    documentShares
  });
  const restrictedHistory = new DocumentHistoryService({ events, queries: restrictedQueries });
  const printSettings = new PrintSettingsService({
    events,
    ...(options.auth?.adminRoles === undefined ? {} : { adminRoles: options.auth.adminRoles })
  });
  const prints = new PrintService({ registry: options.registry, queries: restrictedQueries, printSettings });
  const reports = new ReportService({ registry: options.registry, queries: restrictedQueries });
  const dashboards = new DashboardService({ registry: options.registry, queries: restrictedQueries, reports });
  const kanbans = new KanbanService({ registry: options.registry, queries: restrictedQueries });
  const calendars = new CalendarService({ registry: options.registry, queries: restrictedQueries });
  const webForms = new WebFormService({ registry: options.registry, documents, queries: restrictedQueries });
  const webPages = new WebPageService({ registry: options.registry });
  const webViews = new WebViewService({ registry: options.registry, queries: restrictedQueries });
  const websiteThemes = new WebsiteThemeService({ registry: options.registry });
  const websiteSettings = new WebsiteSettingsService({ registry: options.registry, webPages, webForms, webViews, websiteThemes });
  const roles = new RoleService({
    events,
    ...(options.auth?.adminRoles === undefined ? {} : { adminRoles: options.auth.adminRoles })
  });
  const notificationRules = new NotificationRuleService({
    registry: options.registry,
    events,
    ...(options.auth?.adminRoles === undefined ? {} : { adminRoles: options.auth.adminRoles }),
    preNotificationRuleDocTypeResolver: effectiveDocType
  });
  const assignmentRules = new AssignmentRuleService({
    registry: options.registry,
    events,
    ...(options.auth?.adminRoles === undefined ? {} : { adminRoles: options.auth.adminRoles }),
    preAssignmentRuleDocTypeResolver: effectiveDocType
  });
  const notifications = new UserNotificationService({
    events,
    notificationRules,
    ...(options.auth?.adminRoles === undefined ? {} : { adminRoles: options.auth.adminRoles })
  });
  const realtime = options.realtime
    ? new DurableObjectRealtimePublisher(options.realtime.namespace(env))
    : undefined;
  const deliveryOutboxOptions = documentDeliveryOutboxOptions(options);
  const documentDeliveryOutbox = deliveryOutboxOptions
    ? new DocumentDeliveryOutboxService({
        events,
        ...(deliveryOutboxOptions.clock === undefined ? {} : { clock: deliveryOutboxOptions.clock }),
        ...(deliveryOutboxOptions.ids === undefined ? {} : { ids: deliveryOutboxOptions.ids })
      })
    : undefined;
  const documentDeliveryOutboxEmailNotifications = deliveryOutboxOptions?.emailNotifications?.(env, {
    events,
    notificationRules
  });
  const documentDeliveryOutboxConsumer = documentDeliveryOutbox && deliveryOutboxOptions
    ? new DocumentDeliveryOutboxConsumer({
        outbox: documentDeliveryOutbox,
        deliveries: createDocumentDeliveryOutboxDeliveryHandlers({
          notifications,
          ...(realtime === undefined ? {} : { realtime }),
          ...(documentDeliveryOutboxEmailNotifications === undefined
            ? {}
            : { emailNotifications: documentDeliveryOutboxEmailNotifications })
        }),
        ...(deliveryOutboxOptions.clock === undefined ? {} : { clock: deliveryOutboxOptions.clock }),
        ...(deliveryOutboxOptions.retry === undefined ? {} : { retry: deliveryOutboxOptions.retry })
      })
    : undefined;
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
    notificationRules,
    assignmentRules,
    ...(userProfiles === undefined ? {} : { userProfiles }),
    userPermissions,
    customFields,
    fieldProperties,
    workflows,
    printSettings,
    prints,
    queries: restrictedQueries,
    reports,
    dashboards,
    kanbans,
    calendars,
    webForms,
    webPages,
    webViews,
    websiteSettings,
    websiteThemes,
    roles,
    savedReports,
    ...(documentDeliveryOutbox === undefined ? {} : { documentDeliveryOutbox }),
    ...(documentDeliveryOutboxConsumer === undefined ? {} : { documentDeliveryOutboxConsumer })
  };
  const files = options.files
    ? new FileService({
        registry: options.registry,
        documents,
        queries: restrictedQueries,
        storage: options.files.storage(env, baseServices),
        ...(options.files.scanner === undefined ? {} : { scanner: options.files.scanner(env, baseServices) }),
        ...(options.files.transformer === undefined ? {} : { transformer: options.files.transformer(env, baseServices) }),
        ...(options.files.clock === undefined ? {} : { clock: options.files.clock }),
        ...(options.files.ids === undefined ? {} : { ids: options.files.ids }),
        ...(options.files.maxFileBytes === undefined ? {} : { maxFileBytes: options.files.maxFileBytes }),
        ...(options.files.fileDoctype === undefined ? {} : { fileDoctype: options.files.fileDoctype })
      })
    : undefined;
  const services: CloudFrappeRuntimeServices = files ? { ...baseServices, files } : baseServices;
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
  const printPdfRenderer = options.printPdfRenderer?.(env, runtimeServices);
  const dataPatchApplyQueueEnabled = dataPatches !== undefined &&
    jobOptions !== undefined &&
    jobOptions.registry.has(DATA_PATCH_APPLY_JOB_NAME);
  const dataPatchRollbackQueueEnabled = dataPatches !== undefined &&
    jobOptions !== undefined &&
    jobOptions.registry.has(DATA_PATCH_ROLLBACK_JOB_NAME);
  const dataPatchRollbackRetryQueueEnabled = dataPatches !== undefined &&
    jobOptions !== undefined &&
    jobOptions.registry.has(DATA_PATCH_ROLLBACK_RETRY_JOB_NAME);
  const dataPatchJobQueueEnabled =
    dataPatchApplyQueueEnabled || dataPatchRollbackQueueEnabled || dataPatchRollbackRetryQueueEnabled;
  const documentDeliveryOutboxDrainQueueEnabled =
    documentDeliveryOutboxConsumer !== undefined &&
    jobOptions !== undefined &&
    jobOptions.registry.has(DOCUMENT_DELIVERY_OUTBOX_DRAIN_JOB_NAME);
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
        additionalJobResources<TJobResources>({
          ...(dataPatchJobQueueEnabled ? { dataPatches } : {}),
          ...(documentDeliveryOutboxDrainQueueEnabled ? { documentDeliveryOutboxConsumer } : {})
        })
      )
    : undefined;
  const dataPatchQueue:
    | (DataPatchQueuePort & DataPatchRollbackQueuePort & DataPatchRollbackRetryQueuePort)
    | undefined = dataPatchJobQueueEnabled && jobRuntime
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
    printSettings,
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
    fieldProperties,
    workflows,
    reports,
    dashboards,
    kanbans,
    calendars,
    webForms,
    webPages,
    webViews,
    websiteSettings,
    websiteThemes,
    roles,
    ...(printPdfRenderer === undefined ? {} : { printPdfRenderer }),
    actor,
    notificationRules,
    assignmentRules,
    ...(options.maxJsonBytes ? { maxJsonBytes: options.maxJsonBytes } : {}),
    ...(files === undefined ? {} : { files }),
    ...(dataPatches === undefined ? {} : { dataPatches }),
    ...(dataPatchQueue === undefined || !dataPatchApplyQueueEnabled ? {} : { dataPatchQueue }),
    ...(dataPatchQueue === undefined || !dataPatchRollbackQueueEnabled ? {} : { dataPatchRollbackQueue: dataPatchQueue }),
    ...(dataPatchQueue === undefined || !dataPatchRollbackRetryQueueEnabled
      ? {}
      : { dataPatchRollbackRetryQueue: dataPatchQueue }),
    ...(jobHistory === undefined ? {} : { jobs: jobHistory }),
    ...(jobRetry === undefined ? {} : { jobRetry }),
    ...(jobSchedules === undefined ? {} : { jobSchedules }),
    notifications
  });
  const desk = createDeskApp({
    registry: options.registry,
    documents,
    prints,
    printSettings,
    ...(files === undefined ? {} : { files }),
    queries: restrictedQueries,
    ...(options.auth?.adminRoles === undefined ? {} : { adminRoles: options.auth.adminRoles }),
    documentShares,
    timeline: restrictedHistory,
    savedFilters,
    savedReports,
    ...(userAccounts === undefined ? {} : { userAccounts }),
    ...(userProfiles === undefined ? {} : { userProfiles }),
    userPermissions,
    customFields,
    fieldProperties,
    workflows,
    reports,
    dashboards,
    kanbans,
    calendars,
    roles,
    notificationRules,
    assignmentRules,
    ...(printPdfRenderer === undefined ? {} : { printPdfRenderer }),
    ...(dataPatches === undefined ? {} : { dataPatches }),
    ...(dataPatchQueue === undefined || !dataPatchApplyQueueEnabled ? {} : { dataPatchQueue }),
    ...(dataPatchQueue === undefined || !dataPatchRollbackQueueEnabled ? {} : { dataPatchRollbackQueue: dataPatchQueue }),
    ...(dataPatchQueue === undefined || !dataPatchRollbackRetryQueueEnabled
      ? {}
      : { dataPatchRollbackRetryQueue: dataPatchQueue }),
    ...(jobHistory === undefined ? {} : { jobs: jobHistory }),
    ...(jobRetry === undefined ? {} : { jobRetry }),
    ...(jobSchedules === undefined ? {} : { jobSchedules }),
    notifications,
    ...(options.realtime === undefined ? {} : { realtime: { route: options.realtime.route ?? "/api/realtime" } }),
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

function documentDeliveryOutboxOptions<TEnv extends CloudFrappeEnv, TJobResources, TDataPatchResources>(
  options: CloudFrappeWorkerOptions<TEnv, TJobResources, TDataPatchResources>
): CloudFrappeDocumentDeliveryOutboxOptions<TEnv> | undefined {
  if (options.documentDeliveryOutbox === undefined || options.documentDeliveryOutbox === false) {
    return undefined;
  }
  return options.documentDeliveryOutbox === true ? {} : options.documentDeliveryOutbox;
}

function additionalJobResources<TResources>(resources: Record<string, unknown>): Partial<TResources> | undefined {
  return Object.keys(resources).length === 0
    ? undefined
    : resources as Partial<TResources>;
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
  const appActor = (request: Request) => options.actor(request, env);
  const sessionOrAppActor = userAccounts && options.auth?.revalidateSignedSessions
    ? userAccountSessionActorResolver({
        userAccounts,
        secret: options.auth.sessionSecret(env),
        ...(options.auth.cookieName === undefined ? {} : { cookieName: options.auth.cookieName }),
        fallback: appActor
      })
    : appActor;
  const auth = options.auth;
  if (!userAccounts || auth === undefined || (!auth.cloudflareAccess && !auth.oidc)) {
    return sessionOrAppActor;
  }
  const accessActor = auth.cloudflareAccess
    ? accessAccountSyncActorResolverForEnv(auth, auth.cloudflareAccess, env, userAccounts, sessionOrAppActor)
    : undefined;
  const oidcActors = oidcOptions(auth.oidc).map((oidc) => ({
    tokenSource: oidc.tokenSource,
    actor: oidcAccountSyncActorResolverForEnv(auth, env, userAccounts, sessionOrAppActor, oidc)
  }));
  return async (request) => {
    if (accessActor && hasCloudflareAccessToken(request)) {
      return accessActor(request);
    }
    let oidcError: unknown;
    for (const oidc of oidcActors) {
      if (!hasOidcToken(request, oidc.tokenSource)) {
        continue;
      }
      try {
        return await oidc.actor(request);
      } catch (error) {
        oidcError ??= error;
      }
    }
    if (oidcError !== undefined) {
      throw oidcError;
    }
    return sessionOrAppActor(request);
  };
}

function accessAccountSyncActorResolverForEnv<TEnv extends CloudFrappeEnv>(
  auth: CloudFrappeAuthOptions<TEnv>,
  access: CloudFrappeAccessAccountSyncOptions<TEnv>,
  env: TEnv,
  userAccounts: UserAccountService,
  fallback: ActorResolver
): ActorResolver {
  return cloudflareAccessAccountSyncActorResolver({
    ...access,
    teamDomain: valueForEnv(access.teamDomain, env),
    audience: valueForEnv(access.audience, env),
    userAccounts,
    syncActorRoles: access.syncActorRoles ?? auth.adminRoles ?? [SYSTEM_MANAGER_ROLE],
    fallback
  });
}

function oidcAccountSyncActorResolverForEnv<TEnv extends CloudFrappeEnv>(
  auth: CloudFrappeAuthOptions<TEnv>,
  env: TEnv,
  userAccounts: UserAccountService,
  fallback: ActorResolver,
  oidc: CloudFrappeOidcAccountSyncOptions<TEnv>
): ActorResolver {
  return oidcAccountSyncActorResolver({
    ...oidc,
    issuer: valueForEnv(oidc.issuer, env),
    audience: valueForEnv(oidc.audience, env),
    jwksUrl: valueForEnv(oidc.jwksUrl, env),
    userAccounts,
    syncActorRoles: oidc.syncActorRoles ?? auth.adminRoles ?? [SYSTEM_MANAGER_ROLE],
    fallback
  });
}

function oidcOptions<TEnv extends CloudFrappeEnv>(
  oidc: CloudFrappeAuthOptions<TEnv>["oidc"]
): readonly CloudFrappeOidcAccountSyncOptions<TEnv>[] {
  if (oidc === undefined) {
    return [];
  }
  return isOidcOptionList(oidc) ? oidc : [oidc];
}

function isOidcOptionList<TEnv extends CloudFrappeEnv>(
  oidc: NonNullable<CloudFrappeAuthOptions<TEnv>["oidc"]>
): oidc is readonly CloudFrappeOidcAccountSyncOptions<TEnv>[] {
  return Array.isArray(oidc);
}

function valueForEnv<TEnv, TValue>(value: TValue | ((env: TEnv) => TValue), env: TEnv): TValue {
  return typeof value === "function" ? (value as (env: TEnv) => TValue)(env) : value;
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
  return pathname === normalizedRealtimeRoute(route) || pathname === realtimePresenceRoute(route);
}

function isRealtimePresencePath(pathname: string, route = "/api/realtime"): boolean {
  return pathname === realtimePresenceRoute(route);
}

function normalizedRealtimeRoute(route = "/api/realtime"): string {
  const normalized = route.replace(/\/$/, "");
  if (normalized === "") {
    return "/";
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function realtimePresenceRoute(route = "/api/realtime"): string {
  const baseRoute = normalizedRealtimeRoute(route);
  return baseRoute === "/" ? "/presence" : `${baseRoute}/presence`;
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
