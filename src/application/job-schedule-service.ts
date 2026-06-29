import { badRequest, notFound, permissionDenied } from "../core/errors.js";
import type { JobRetryPolicy } from "../core/jobs.js";
import { jobScheduleDefinitionsStream, jobScheduleOverridesStream } from "../core/streams.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type DomainEvent,
  type NewDomainEvent,
  type TenantId
} from "../core/types.js";
import type { JobScheduleEventPayload } from "./job-schedule-events.js";
import { normalizeJobDocumentData } from "./job-payload-policy.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";
import {
  MAX_JOB_QUEUE_DELAY_SECONDS,
  MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH,
  type JobMessage
} from "../ports/job-queue.js";
import {
  canInspectJobSchedule,
  planJobScheduleAccess,
  planJobScheduleDispatch,
  planJobScheduleOverride
} from "./job-schedule-policy.js";

export type { JobScheduleEventPayload } from "./job-schedule-events.js";

export type DynamicJobScheduleValue = (...args: never[]) => unknown;

export interface JobScheduleDefinitionForAdmin {
  readonly id?: string;
  readonly cron: string;
  readonly jobName: string;
  readonly enabled?: boolean | DynamicJobScheduleValue;
  readonly tenantId?: unknown;
  readonly payload?: unknown;
  readonly metadata?: unknown;
  readonly idempotencyKey?: unknown;
  readonly delaySeconds?: number;
}

export interface JobDefinitionForSchedule {
  readonly name: string;
  readonly description?: string;
  readonly retry?: JobRetryPolicy;
}

export interface JobScheduleRegistry {
  has(name: string): boolean;
  get(name: string): JobDefinitionForSchedule;
}

export interface JobScheduleRunner<TSchedule extends JobScheduleDefinitionForAdmin = JobScheduleDefinitionForAdmin> {
  run(schedule: TSchedule | JobScheduleDefinitionForAdmin, actor: Actor): Promise<JobMessage>;
}

export interface JobScheduleServiceOptions<TSchedule extends JobScheduleDefinitionForAdmin = JobScheduleDefinitionForAdmin> {
  readonly registry: JobScheduleRegistry;
  readonly schedules: readonly TSchedule[];
  readonly runner?: JobScheduleRunner<TSchedule>;
  readonly events?: EventStore;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly adminRoles?: readonly string[];
  readonly runtimeCronTriggers?: readonly string[];
}

export interface JobScheduleQuery {
  readonly cron?: string;
  readonly jobName?: string;
}

export interface JobScheduleSummary {
  readonly id: string;
  readonly cron: string;
  readonly jobName: string;
  readonly source: "configured" | "runtime";
  readonly editable: boolean;
  readonly deleted?: boolean;
  readonly enabled: boolean;
  readonly configuredEnabled: boolean;
  readonly overridden: boolean;
  readonly overrideEnabled?: boolean;
  readonly pausedUntil?: string;
  readonly overrideUpdatedAt?: string;
  readonly overrideUpdatedBy?: string;
  readonly overrideable: boolean;
  readonly registered: boolean;
  readonly dispatchable: boolean;
  readonly description?: string;
  readonly retry?: JobRetryPolicy;
  readonly delaySeconds?: number;
  readonly tenantId?: string;
  readonly dynamic: {
    readonly enabled: boolean;
    readonly tenantId: boolean;
    readonly payload: boolean;
    readonly metadata: boolean;
    readonly idempotencyKey: boolean;
  };
}

export interface JobScheduleDashboard {
  readonly schedules: readonly JobScheduleSummary[];
  readonly filters: {
    readonly cron?: string;
    readonly jobName?: string;
  };
}

export interface JobScheduleDispatchResult {
  readonly schedule: JobScheduleSummary;
  readonly message: JobMessage;
}

export interface JobScheduleOverrideResult {
  readonly schedule: JobScheduleSummary;
}

export interface JobScheduleDefinitionResult {
  readonly schedule: JobScheduleSummary;
}

export interface SetJobScheduleEnabledCommand {
  readonly actor: Actor;
  readonly scheduleId: string;
  readonly enabled: boolean;
  readonly tenantId?: TenantId;
  readonly metadata?: DocumentData;
}

export interface PauseJobScheduleCommand {
  readonly actor: Actor;
  readonly scheduleId: string;
  readonly pausedUntil: string;
  readonly tenantId?: TenantId;
  readonly metadata?: DocumentData;
}

export interface SaveJobScheduleDefinitionCommand {
  readonly id?: string;
  readonly cron: string;
  readonly jobName: string;
  readonly enabled?: boolean;
  readonly tenantId?: TenantId;
  readonly payload?: DocumentData;
  readonly metadata?: DocumentData;
  readonly idempotencyKey?: string;
  readonly delaySeconds?: number;
  readonly eventMetadata?: DocumentData;
  readonly preserveExistingFields?: boolean;
}

export interface DeleteJobScheduleDefinitionCommand {
  readonly tenantId?: TenantId;
  readonly metadata?: DocumentData;
}

interface JobScheduleOverrideRecord {
  readonly scheduleId: string;
  readonly enabled?: boolean;
  readonly pausedUntil?: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

interface JobScheduleOverrideState {
  readonly tenantId: TenantId;
  readonly version: number;
  readonly overrides: ReadonlyMap<string, JobScheduleOverrideRecord>;
}

interface RuntimeJobScheduleRecord extends JobScheduleDefinitionForAdmin {
  readonly id: string;
  readonly cron: string;
  readonly jobName: string;
  readonly tenantId: TenantId;
  readonly enabled: boolean;
  readonly payload?: DocumentData;
  readonly metadata?: DocumentData;
  readonly idempotencyKey?: string;
  readonly delaySeconds?: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

interface JobScheduleDefinitionState {
  readonly version: number;
  readonly schedules: ReadonlyMap<string, RuntimeJobScheduleRecord>;
}

export class JobScheduleService<TSchedule extends JobScheduleDefinitionForAdmin = JobScheduleDefinitionForAdmin> {
  private readonly registry: JobScheduleRegistry;
  private readonly schedules: readonly TSchedule[];
  private readonly runner: JobScheduleRunner<TSchedule> | undefined;
  private readonly events: EventStore | undefined;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];
  private readonly runtimeCronTriggers: ReadonlySet<string> | undefined;

  constructor(options: JobScheduleServiceOptions<TSchedule>) {
    this.registry = options.registry;
    this.schedules = options.schedules;
    this.runner = options.runner;
    this.events = options.events;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
    this.runtimeCronTriggers = options.runtimeCronTriggers === undefined
      ? undefined
      : new Set(options.runtimeCronTriggers.map((cron) => normalizeScheduleText(cron, "cron")));
    ensureUniqueScheduleIds(options.schedules);
  }

  canDispatch(): boolean {
    return this.runner !== undefined;
  }

  canOverride(): boolean {
    return this.events !== undefined;
  }

  canEditDefinitions(): boolean {
    return this.events !== undefined;
  }

  async dashboard(actor: Actor, query: JobScheduleQuery = {}): Promise<JobScheduleDashboard> {
    const tenantId = this.authorize(actor);
    const filters = normalizeQuery(query);
    const [overrides, definitions] = await Promise.all([
      this.overrideState(tenantId),
      this.definitionState()
    ]);
    return {
      schedules: this.summarizeSchedules(overrides, definitions)
        .filter((schedule) => canInspectJobSchedule(schedule, tenantId))
        .filter((schedule) => filters.cron === undefined || schedule.cron === filters.cron)
        .filter((schedule) => filters.jobName === undefined || schedule.jobName === filters.jobName),
      filters
    };
  }

  async dispatch(actor: Actor, scheduleId: string): Promise<JobScheduleDispatchResult> {
    const tenantId = this.authorize(actor);
    if (!this.runner) {
      throw notFound("Job schedule dispatch is not enabled", "JOB_SCHEDULE_NOT_FOUND");
    }
    const { schedule, summary } = await this.requireSchedule(scheduleId, tenantId);
    const decision = planJobScheduleDispatch({ scheduleId, tenantId, summary });
    if (decision.status === "not-found") {
      throw notFound(decision.message, "JOB_SCHEDULE_NOT_FOUND");
    }
    if (decision.status === "reject") {
      throw badRequest(decision.message);
    }
    const message = await this.runner.run(effectiveSchedule(schedule, summary) as TSchedule, actor);
    return { schedule: summary, message };
  }

  async save(
    actor: Actor,
    command: SaveJobScheduleDefinitionCommand
  ): Promise<JobScheduleDefinitionResult> {
    const tenantId = this.authorize(actor, command.tenantId);
    const events = this.requireDefinitions();
    const state = await this.definitionState();
    const existing = command.id === undefined
      ? undefined
      : runtimeScheduleForTenant(state, tenantId, normalizeScheduleId(command.id));
    const schedule = mergePreservedRuntimeFields(
      normalizeRuntimeSchedule(command, tenantId, command.id ?? this.ids.next("schedule_")),
      existing,
      command
    );
    if (configuredScheduleIds(this.schedules).has(schedule.id)) {
      throw badRequest(`Configured job schedule '${schedule.id}' cannot be edited at runtime`);
    }
    this.ensureRuntimeCronTrigger(schedule.cron);
    if (!this.registry.has(schedule.jobName)) {
      throw badRequest(`Scheduled job '${schedule.jobName}' is not registered`);
    }
    const stream = jobScheduleDefinitionsStream();
    const event: NewDomainEvent<JobScheduleEventPayload> = {
      id: this.ids.next("evt_"),
      tenantId,
      stream,
      type: "JobScheduleSaved",
      doctype: "__JobSchedules",
      documentName: "definitions",
      actorId: actor.id,
      occurredAt: this.clock.now(),
      payload: {
        kind: "JobScheduleSaved",
        scheduleId: schedule.id,
        cron: schedule.cron,
        jobName: schedule.jobName,
        tenantId,
        enabled: schedule.enabled,
        ...(schedule.payload === undefined ? {} : { payload: schedule.payload }),
        ...(schedule.metadata === undefined ? {} : { metadata: schedule.metadata }),
        ...(schedule.idempotencyKey === undefined ? {} : { idempotencyKey: schedule.idempotencyKey }),
        ...(schedule.delaySeconds === undefined ? {} : { delaySeconds: schedule.delaySeconds })
      },
      metadata: command.eventMetadata ?? {}
    };
    await events.append(stream, state.version, [event]);
    const updated = await this.definitionState();
    const saved = requireSavedRuntimeSchedule(updated, tenantId, schedule.id);
    return {
      schedule: this.summaryFor(saved, runtimeScheduleIndex(updated, tenantId, saved.id), await this.overrideState(tenantId), "runtime")
    };
  }

  async delete(
    actor: Actor,
    scheduleId: string,
    command: DeleteJobScheduleDefinitionCommand = {}
  ): Promise<JobScheduleDefinitionResult> {
    const tenantId = this.authorize(actor, command.tenantId);
    if (configuredScheduleIds(this.schedules).has(scheduleId)) {
      throw badRequest(`Configured job schedule '${scheduleId}' cannot be deleted at runtime`);
    }
    const events = this.requireDefinitions();
    const state = await this.definitionState();
    const current = runtimeScheduleForTenant(state, tenantId, scheduleId);
    if (!current) {
      throw notFound(`Job schedule '${scheduleId}' was not found`, "JOB_SCHEDULE_NOT_FOUND");
    }
    const stream = jobScheduleDefinitionsStream();
    const event: NewDomainEvent<JobScheduleEventPayload> = {
      id: this.ids.next("evt_"),
      tenantId,
      stream,
      type: "JobScheduleDeleted",
      doctype: "__JobSchedules",
      documentName: "definitions",
      actorId: actor.id,
      occurredAt: this.clock.now(),
      payload: {
        kind: "JobScheduleDeleted",
        scheduleId,
        tenantId
      },
      metadata: command.metadata ?? {}
    };
    await events.append(stream, state.version, [event]);
    const schedule = this.summaryFor(current, runtimeScheduleIndex(state, tenantId, current.id), await this.overrideState(tenantId), "runtime");
    return {
      schedule: {
        ...schedule,
        deleted: true,
        enabled: false,
        configuredEnabled: false,
        dispatchable: false
      }
    };
  }

  async enable(
    actor: Actor,
    scheduleId: string,
    command: Omit<SetJobScheduleEnabledCommand, "actor" | "scheduleId" | "enabled"> = {}
  ): Promise<JobScheduleOverrideResult> {
    return this.setEnabled({ actor, scheduleId, enabled: true, ...command });
  }

  async disable(
    actor: Actor,
    scheduleId: string,
    command: Omit<SetJobScheduleEnabledCommand, "actor" | "scheduleId" | "enabled"> = {}
  ): Promise<JobScheduleOverrideResult> {
    return this.setEnabled({ actor, scheduleId, enabled: false, ...command });
  }

  async clearOverride(
    actor: Actor,
    scheduleId: string,
    command: Omit<SetJobScheduleEnabledCommand, "actor" | "scheduleId" | "enabled"> = {}
  ): Promise<JobScheduleOverrideResult> {
    const { tenantId, events, schedule, index, summary, state } = await this.requireOverrideableSchedule(
      actor,
      scheduleId,
      command.tenantId
    );
    if (!state.overrides.has(summary.id)) {
      return { schedule: this.summaryFor(schedule, index, state) };
    }
    const stream = jobScheduleOverridesStream(tenantId);
    const event: NewDomainEvent<JobScheduleEventPayload> = {
      id: this.ids.next("evt_"),
      tenantId,
      stream,
      type: "JobScheduleOverrideCleared",
      doctype: "__JobSchedules",
      documentName: "overrides",
      actorId: actor.id,
      occurredAt: this.clock.now(),
      payload: {
        kind: "JobScheduleOverrideCleared",
        scheduleId: summary.id
      },
      metadata: command.metadata ?? {}
    };
    await events.append(stream, state.version, [event]);
    return {
      schedule: this.summaryFor(schedule, index, await this.overrideState(tenantId))
    };
  }

  async pause(
    actor: Actor,
    scheduleId: string,
    command: Omit<PauseJobScheduleCommand, "actor" | "scheduleId">
  ): Promise<JobScheduleOverrideResult> {
    const { tenantId, events, schedule, index, summary, state } = await this.requireOverrideableSchedule(
      actor,
      scheduleId,
      command.tenantId
    );
    const pausedUntil = normalizePauseUntil(command.pausedUntil, this.clock.now());
    const current = state.overrides.get(summary.id);
    if (current?.pausedUntil === pausedUntil && pauseIsActive(pausedUntil, this.clock.now())) {
      return { schedule: this.summaryFor(schedule, index, state) };
    }
    const stream = jobScheduleOverridesStream(tenantId);
    const event: NewDomainEvent<JobScheduleEventPayload> = {
      id: this.ids.next("evt_"),
      tenantId,
      stream,
      type: "JobSchedulePaused",
      doctype: "__JobSchedules",
      documentName: "overrides",
      actorId: actor.id,
      occurredAt: this.clock.now(),
      payload: {
        kind: "JobSchedulePaused",
        scheduleId: summary.id,
        pausedUntil
      },
      metadata: command.metadata ?? {}
    };
    await events.append(stream, state.version, [event]);
    return {
      schedule: this.summaryFor(schedule, index, await this.overrideState(tenantId))
    };
  }

  async schedulesForCron(cron: string): Promise<readonly TSchedule[]> {
    const states = new Map<TenantId, JobScheduleOverrideState>();
    const resolved: TSchedule[] = [];
    for (const [index, schedule] of this.schedules.entries()) {
      if (schedule.cron !== cron) {
        continue;
      }
      const tenantId = staticTenantId(schedule);
      if (tenantId === undefined) {
        resolved.push(schedule);
        continue;
      }
      const state = states.get(tenantId) ?? await this.overrideState(tenantId);
      states.set(tenantId, state);
      resolved.push(effectiveSchedule(schedule, this.summaryFor(schedule, index, state)) as TSchedule);
    }
    for (const [runtimeIndex, schedule] of runtimeSchedules(await this.definitionState()).entries()) {
      if (schedule.cron !== cron) {
        continue;
      }
      const state = states.get(schedule.tenantId) ?? await this.overrideState(schedule.tenantId);
      states.set(schedule.tenantId, state);
      resolved.push(
        effectiveSchedule(
          schedule,
          this.summaryFor(schedule, this.schedules.length + runtimeIndex, state, "runtime")
        ) as unknown as TSchedule
      );
    }
    return resolved;
  }

  private async setEnabled(command: SetJobScheduleEnabledCommand): Promise<JobScheduleOverrideResult> {
    const { tenantId, events, schedule, index, summary, state } = await this.requireOverrideableSchedule(
      command.actor,
      command.scheduleId,
      command.tenantId
    );
    const current = state.overrides.get(summary.id);
    if ((current?.enabled ?? summary.configuredEnabled) === command.enabled) {
      return { schedule: this.summaryFor(schedule, index, state) };
    }
    const stream = jobScheduleOverridesStream(tenantId);
    const event: NewDomainEvent<JobScheduleEventPayload> = {
      id: this.ids.next("evt_"),
      tenantId,
      stream,
      type: "JobScheduleOverrideSet",
      doctype: "__JobSchedules",
      documentName: "overrides",
      actorId: command.actor.id,
      occurredAt: this.clock.now(),
      payload: {
        kind: "JobScheduleOverrideSet",
        scheduleId: summary.id,
        enabled: command.enabled
      },
      metadata: command.metadata ?? {}
    };
    await events.append(stream, state.version, [event]);
    return {
      schedule: this.summaryFor(schedule, index, await this.overrideState(tenantId))
    };
  }

  private async requireOverrideableSchedule(
    actor: Actor,
    scheduleId: string,
    explicitTenantId?: TenantId
  ): Promise<{
    readonly tenantId: TenantId;
    readonly events: EventStore;
    readonly schedule: TSchedule;
    readonly index: number;
    readonly summary: JobScheduleSummary;
    readonly state: JobScheduleOverrideState;
  }> {
    const tenantId = this.authorize(actor, explicitTenantId);
    const events = this.requireOverrides();
    const { schedule, index, summary } = await this.requireSchedule(scheduleId, tenantId);
    const decision = planJobScheduleOverride({
      scheduleId,
      tenantId,
      summary,
      hasScheduleId: schedule.id !== undefined
    });
    if (decision.status === "not-found") {
      throw notFound(decision.message, "JOB_SCHEDULE_NOT_FOUND");
    }
    if (decision.status === "reject") {
      throw badRequest(decision.message);
    }
    return {
      tenantId,
      events,
      schedule: schedule as TSchedule,
      index,
      summary,
      state: await this.overrideState(tenantId)
    };
  }

  private authorize(actor: Actor, explicitTenantId?: TenantId): TenantId {
    const decision = planJobScheduleAccess({
      actor,
      adminRoles: this.adminRoles,
      ...(explicitTenantId === undefined ? {} : { explicitTenantId })
    });
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
    }
    return decision.tenantId;
  }

  private async requireSchedule(scheduleId: string, tenantId: TenantId): Promise<{
    readonly schedule: TSchedule | RuntimeJobScheduleRecord;
    readonly index: number;
    readonly summary: JobScheduleSummary;
  }> {
    const index = this.schedules.findIndex(
      (schedule, candidateIndex) => scheduleIdentity(schedule, candidateIndex) === scheduleId
    );
    if (index < 0) {
      const definitions = await this.definitionState();
      const runtime = runtimeScheduleForTenant(definitions, tenantId, scheduleId);
      if (!runtime) {
        throw notFound(`Job schedule '${scheduleId}' was not found`, "JOB_SCHEDULE_NOT_FOUND");
      }
      const runtimeIndex = runtimeScheduleIndex(definitions, tenantId, runtime.id);
      return {
        schedule: runtime,
        index: runtimeIndex,
        summary: this.summaryFor(runtime, runtimeIndex, await this.overrideState(tenantId), "runtime")
      };
    }
    const schedule = requireConfiguredSchedule(this.schedules, index, scheduleId);
    return { schedule, index, summary: this.summaryFor(schedule, index, await this.overrideState(tenantId)) };
  }

  private summarizeSchedules(
    overrides: JobScheduleOverrideState,
    definitions: JobScheduleDefinitionState
  ): readonly JobScheduleSummary[] {
    return [
      ...this.schedules.map((schedule, index) => this.summaryFor(schedule, index, overrides)),
      ...runtimeSchedules(definitions).map((schedule, index) =>
        this.summaryFor(schedule, this.schedules.length + index, overrides, "runtime")
      )
    ];
  }

  private summaryFor(
    schedule: TSchedule | RuntimeJobScheduleRecord,
    index: number,
    overrides: JobScheduleOverrideState,
    source: "configured" | "runtime" = "configured"
  ): JobScheduleSummary {
    const registered = this.registry.has(schedule.jobName);
    const job = registered ? this.registry.get(schedule.jobName) : undefined;
    const tenantId = staticTenantId(schedule);
    const id = scheduleIdentity(schedule, index);
    const dynamic = {
      enabled: isDynamic(schedule.enabled),
      tenantId: isDynamic(schedule.tenantId),
      payload: isDynamic(schedule.payload),
      metadata: isDynamic(schedule.metadata),
      idempotencyKey: isDynamic(schedule.idempotencyKey)
    };
    const overrideable =
      source === "configured" &&
      this.canOverride() &&
      schedule.id !== undefined &&
      !dynamic.tenantId &&
      !dynamic.enabled;
    const override = overrideable && tenantId === overrides.tenantId ? overrides.overrides.get(id) : undefined;
    const pausedUntil = override?.pausedUntil;
    const paused = pausedUntil !== undefined && pauseIsActive(pausedUntil, this.clock.now());
    const configuredEnabled = schedule.enabled !== false;
    const overrideEnabled = override?.enabled;
    const baseEnabled = overrideEnabled ?? configuredEnabled;
    const enabled = baseEnabled && !paused;
    const overridden = overrideEnabled !== undefined || paused;
    return {
      id,
      cron: schedule.cron,
      jobName: schedule.jobName,
      source,
      editable: source === "runtime",
      enabled,
      configuredEnabled,
      overridden,
      ...(overrideEnabled === undefined ? {} : { overrideEnabled }),
      ...(paused ? { pausedUntil } : {}),
      ...(override === undefined || !overridden
        ? {}
        : {
            overrideUpdatedAt: override.updatedAt,
            overrideUpdatedBy: override.updatedBy
          }),
      overrideable,
      registered,
      dispatchable:
        registered &&
        enabled &&
        this.canDispatch() &&
        !dynamic.tenantId &&
        !dynamic.enabled,
      ...(job?.description === undefined ? {} : { description: job.description }),
      ...(job?.retry === undefined ? {} : { retry: job.retry }),
      ...(schedule.delaySeconds === undefined ? {} : { delaySeconds: schedule.delaySeconds }),
      ...(tenantId === undefined ? {} : { tenantId }),
      dynamic
    };
  }

  private requireOverrides(): EventStore {
    if (!this.events) {
      throw notFound("Job schedule overrides are not enabled", "JOB_SCHEDULE_NOT_FOUND");
    }
    return this.events;
  }

  private requireDefinitions(): EventStore {
    if (!this.events) {
      throw notFound("Job schedule definitions are not enabled", "JOB_SCHEDULE_NOT_FOUND");
    }
    return this.events;
  }

  private async overrideState(tenantId: TenantId): Promise<JobScheduleOverrideState> {
    if (!this.events) {
      return { tenantId, version: 0, overrides: new Map() };
    }
    return foldJobScheduleOverrides(tenantId, await this.events.readStream(jobScheduleOverridesStream(tenantId)));
  }

  private async definitionState(): Promise<JobScheduleDefinitionState> {
    if (!this.events) {
      return { version: 0, schedules: new Map() };
    }
    return foldJobScheduleDefinitions(await this.events.readStream(jobScheduleDefinitionsStream()));
  }

  private ensureRuntimeCronTrigger(cron: string): void {
    if (this.runtimeCronTriggers === undefined || this.runtimeCronTriggers.has(cron)) {
      return;
    }
    throw badRequest(`Job schedule cron '${cron}' is not configured as a Worker Cron Trigger`);
  }
}

function normalizeQuery(query: JobScheduleQuery): JobScheduleDashboard["filters"] {
  return {
    ...(query.cron === undefined || query.cron === "" ? {} : { cron: query.cron }),
    ...(query.jobName === undefined || query.jobName === "" ? {} : { jobName: query.jobName })
  };
}

function isDynamic(value: unknown): boolean {
  return typeof value === "function";
}

function staticTenantId(schedule: JobScheduleDefinitionForAdmin): TenantId | undefined {
  if (isDynamic(schedule.tenantId)) {
    return undefined;
  }
  return typeof schedule.tenantId === "string" ? schedule.tenantId : DEFAULT_TENANT_ID;
}

function scheduleIdentity(schedule: JobScheduleDefinitionForAdmin, index: number): string {
  return schedule.id ?? String(index + 1);
}

function requireConfiguredSchedule<TSchedule extends JobScheduleDefinitionForAdmin>(
  schedules: readonly TSchedule[],
  index: number,
  scheduleId: string
): TSchedule {
  const schedule = schedules[index];
  if (schedule === undefined) {
    throw new Error(`Configured job schedule '${scheduleId}' was not found at resolved index ${index}`);
  }
  return schedule;
}

function ensureUniqueScheduleIds(schedules: readonly JobScheduleDefinitionForAdmin[]): void {
  const seen = new Set<string>();
  schedules.forEach((schedule, index) => {
    const id = scheduleIdentity(schedule, index);
    if (id.trim() === "") {
      throw badRequest("Job schedule id is required");
    }
    if (seen.has(id)) {
      throw badRequest(`Job schedule id '${id}' is duplicated`);
    }
    seen.add(id);
  });
}

function configuredScheduleIds(schedules: readonly JobScheduleDefinitionForAdmin[]): ReadonlySet<string> {
  return new Set(schedules.map((schedule, index) => scheduleIdentity(schedule, index)));
}

function runtimeSchedules(state: JobScheduleDefinitionState): readonly RuntimeJobScheduleRecord[] {
  return [...state.schedules.values()].sort(
    (left, right) => left.tenantId.localeCompare(right.tenantId) || left.id.localeCompare(right.id)
  );
}

function runtimeScheduleForTenant(
  state: JobScheduleDefinitionState,
  tenantId: TenantId,
  scheduleId: string
): RuntimeJobScheduleRecord | undefined {
  return state.schedules.get(runtimeScheduleKey(tenantId, scheduleId));
}

function requireSavedRuntimeSchedule(
  state: JobScheduleDefinitionState,
  tenantId: TenantId,
  scheduleId: string
): RuntimeJobScheduleRecord {
  const schedule = runtimeScheduleForTenant(state, tenantId, scheduleId);
  if (schedule === undefined) {
    throw new Error(`Saved job schedule '${scheduleId}' for tenant '${tenantId}' was not found after replay`);
  }
  return schedule;
}

function runtimeScheduleIndex(state: JobScheduleDefinitionState, tenantId: TenantId, scheduleId: string): number {
  const index = runtimeSchedules(state).findIndex((schedule) => schedule.tenantId === tenantId && schedule.id === scheduleId);
  return index < 0 ? 0 : index;
}

function runtimeScheduleKey(tenantId: TenantId, scheduleId: string): string {
  return JSON.stringify([tenantId, scheduleId]);
}

function effectiveSchedule<TSchedule extends JobScheduleDefinitionForAdmin>(
  schedule: TSchedule,
  summary: JobScheduleSummary
): TSchedule {
  if (!summary.overridden) {
    return schedule;
  }
  return {
    ...schedule,
    enabled: summary.enabled
  };
}

function normalizeRuntimeSchedule(
  command: SaveJobScheduleDefinitionCommand,
  tenantId: TenantId,
  generatedId: string
): RuntimeJobScheduleRecord {
  const id = normalizeScheduleId(generatedId);
  return {
    id,
    cron: normalizeScheduleText(command.cron, "cron"),
    jobName: normalizeScheduleText(command.jobName, "jobName"),
    tenantId,
    enabled: command.enabled ?? true,
    ...(command.payload === undefined ? {} : { payload: normalizeDocumentData(command.payload, "payload") }),
    ...(command.metadata === undefined ? {} : { metadata: normalizeDocumentData(command.metadata, "metadata") }),
    ...(command.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: normalizeScheduleIdempotencyKey(command.idempotencyKey) }),
    ...(command.delaySeconds === undefined ? {} : { delaySeconds: normalizeDelaySeconds(command.delaySeconds) }),
    updatedAt: "",
    updatedBy: ""
  };
}

function mergePreservedRuntimeFields(
  schedule: RuntimeJobScheduleRecord,
  existing: RuntimeJobScheduleRecord | undefined,
  command: SaveJobScheduleDefinitionCommand
): RuntimeJobScheduleRecord {
  if (!command.preserveExistingFields || existing === undefined) {
    return schedule;
  }
  return {
    ...schedule,
    ...(command.payload === undefined && existing.payload !== undefined ? { payload: existing.payload } : {}),
    ...(command.metadata === undefined && existing.metadata !== undefined ? { metadata: existing.metadata } : {}),
    ...(command.idempotencyKey === undefined && existing.idempotencyKey !== undefined
      ? { idempotencyKey: existing.idempotencyKey }
      : {})
  };
}

function normalizeScheduleId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw badRequest("Job schedule id is required");
  }
  return normalized;
}

function normalizeScheduleText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw badRequest(`Job schedule ${field} is required`);
  }
  return normalized;
}

function normalizeScheduleIdempotencyKey(value: string): string {
  const normalized = normalizeScheduleText(value, "idempotencyKey");
  if (normalized.length > MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH) {
    throw badRequest(`Job schedule idempotencyKey must be at most ${MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH} characters`);
  }
  return normalized;
}

function normalizeDelaySeconds(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_JOB_QUEUE_DELAY_SECONDS) {
    throw badRequest(`delaySeconds must be an integer between 0 and ${MAX_JOB_QUEUE_DELAY_SECONDS}`);
  }
  return value;
}

function normalizePauseUntil(value: string, now: string): string {
  const normalized = normalizeScheduleText(value, "pauseUntil");
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw badRequest("Job schedule pauseUntil must be a valid timestamp");
  }
  if (timestamp <= Date.parse(now)) {
    throw badRequest("Job schedule pauseUntil must be in the future");
  }
  return new Date(timestamp).toISOString();
}

function pauseIsActive(pausedUntil: string, now: string): boolean {
  return Date.parse(pausedUntil) > Date.parse(now);
}

function normalizeDocumentData(value: DocumentData, field: string): DocumentData {
  return normalizeJobDocumentData(value, `Job schedule ${field}`);
}

function foldJobScheduleOverrides(
  tenantId: TenantId,
  events: readonly DomainEvent[]
): JobScheduleOverrideState {
  const overrides = new Map<string, JobScheduleOverrideRecord>();
  for (const event of events) {
    if (event.payload.kind === "JobScheduleOverrideSet") {
      const current = overrides.get(event.payload.scheduleId);
      overrides.set(event.payload.scheduleId, {
        ...current,
        scheduleId: event.payload.scheduleId,
        enabled: event.payload.enabled,
        updatedAt: event.occurredAt,
        updatedBy: event.actorId
      });
      continue;
    }
    if (event.payload.kind === "JobSchedulePaused") {
      const current = overrides.get(event.payload.scheduleId);
      overrides.set(event.payload.scheduleId, {
        ...current,
        scheduleId: event.payload.scheduleId,
        pausedUntil: event.payload.pausedUntil,
        updatedAt: event.occurredAt,
        updatedBy: event.actorId
      });
      continue;
    }
    if (event.payload.kind === "JobScheduleOverrideCleared") {
      overrides.delete(event.payload.scheduleId);
    }
  }
  return {
    tenantId,
    version: events.at(-1)?.sequence ?? 0,
    overrides
  };
}

function foldJobScheduleDefinitions(events: readonly DomainEvent[]): JobScheduleDefinitionState {
  const schedules = new Map<string, RuntimeJobScheduleRecord>();
  for (const event of events) {
    if (event.payload.kind === "JobScheduleSaved") {
      schedules.set(runtimeScheduleKey(event.payload.tenantId, event.payload.scheduleId), {
        id: event.payload.scheduleId,
        cron: event.payload.cron,
        jobName: event.payload.jobName,
        tenantId: event.payload.tenantId,
        enabled: event.payload.enabled,
        ...(event.payload.payload === undefined ? {} : { payload: event.payload.payload }),
        ...(event.payload.metadata === undefined ? {} : { metadata: event.payload.metadata }),
        ...(event.payload.idempotencyKey === undefined ? {} : { idempotencyKey: event.payload.idempotencyKey }),
        ...(event.payload.delaySeconds === undefined ? {} : { delaySeconds: event.payload.delaySeconds }),
        updatedAt: event.occurredAt,
        updatedBy: event.actorId
      });
      continue;
    }
    if (event.payload.kind === "JobScheduleDeleted") {
      schedules.delete(runtimeScheduleKey(event.payload.tenantId, event.payload.scheduleId));
    }
  }
  return {
    version: events.at(-1)?.sequence ?? 0,
    schedules
  };
}
