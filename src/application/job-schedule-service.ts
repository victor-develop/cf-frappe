import { badRequest, notFound, permissionDenied } from "../core/errors.js";
import type { JobRetryPolicy } from "../core/jobs.js";
import { jobScheduleDefinitionsStream, jobScheduleOverridesStream } from "../core/streams.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type TenantId
} from "../core/types.js";
import {
  createJobScheduleDeletedEvent,
  createJobScheduleOverrideClearedEvent,
  createJobScheduleOverrideSetEvent,
  createJobSchedulePausedEvent,
  createJobScheduleSavedEvent,
  foldJobScheduleDefinitions,
  foldJobScheduleOverrides,
  JOB_SCHEDULE_DEFINITION_PAYLOAD_KINDS,
  JOB_SCHEDULE_OVERRIDE_PAYLOAD_KINDS,
  requireSavedRuntimeJobSchedule,
  runtimeJobScheduleForTenant,
  runtimeJobScheduleIndex,
  runtimeJobSchedules,
  type JobScheduleDefinitionState,
  type JobScheduleOverrideState,
  type RuntimeJobScheduleRecord
} from "./job-schedule-events.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";
import { type JobMessage } from "../ports/job-queue.js";
import {
  canInspectJobSchedule,
  mergePreservedJobScheduleRuntimeFields,
  normalizeJobScheduleId,
  normalizeJobScheduleRuntimeDefinition,
  normalizeJobScheduleText,
  planJobScheduleAccess,
  planJobScheduleDefinitionDelete,
  planJobScheduleDefinitionSave,
  planJobScheduleDispatch,
  planJobScheduleEnabledOverride,
  planJobScheduleOverride,
  planJobScheduleOverrideClear,
  planJobSchedulePauseOverride,
  planJobScheduleSummary,
  type JobScheduleSummary
} from "./job-schedule-policy.js";

export type { JobScheduleEventPayload } from "./job-schedule-events.js";
export type { JobScheduleSummary } from "./job-schedule-policy.js";

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
      : new Set(options.runtimeCronTriggers.map((cron) => normalizeJobScheduleText(cron, "cron")));
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
      : runtimeJobScheduleForTenant(state, tenantId, normalizeJobScheduleId(command.id));
    const normalized = normalizeJobScheduleRuntimeDefinition({
      command,
      tenantId,
      generatedId: command.id ?? this.ids.next("schedule_")
    });
    const schedule = mergePreservedJobScheduleRuntimeFields({
      schedule: normalized,
      ...(existing === undefined ? {} : { existing }),
      preserve: {
        ...(command.preserveExistingFields === undefined ? {} : { preserveExistingFields: command.preserveExistingFields }),
        payloadProvided: command.payload !== undefined,
        metadataProvided: command.metadata !== undefined,
        idempotencyKeyProvided: command.idempotencyKey !== undefined
      }
    });
    this.ensureRuntimeCronTrigger(schedule.cron);
    const saveDecision = planJobScheduleDefinitionSave({
      scheduleId: schedule.id,
      jobName: schedule.jobName,
      configured: configuredScheduleIds(this.schedules).has(schedule.id),
      registered: this.registry.has(schedule.jobName)
    });
    if (saveDecision.status === "reject") {
      throw badRequest(saveDecision.message);
    }
    const stream = jobScheduleDefinitionsStream();
    const event = createJobScheduleSavedEvent({
      id: this.ids.next("evt_"),
      tenantId,
      actorId: actor.id,
      occurredAt: this.clock.now(),
      metadata: command.eventMetadata ?? {},
      schedule
    });
    await events.append(stream, state.version, [event]);
    const updated = await this.definitionState();
    const saved = requireSavedRuntimeJobSchedule(updated, tenantId, schedule.id);
    return {
      schedule: this.summaryFor(saved, runtimeJobScheduleIndex(updated, tenantId, saved.id), await this.overrideState(tenantId), "runtime")
    };
  }

  async delete(
    actor: Actor,
    scheduleId: string,
    command: DeleteJobScheduleDefinitionCommand = {}
  ): Promise<JobScheduleDefinitionResult> {
    const tenantId = this.authorize(actor, command.tenantId);
    const events = this.requireDefinitions();
    const state = await this.definitionState();
    const current = runtimeJobScheduleForTenant(state, tenantId, scheduleId);
    const deleteDecision = planJobScheduleDefinitionDelete({
      scheduleId,
      configured: configuredScheduleIds(this.schedules).has(scheduleId),
      exists: current !== undefined
    });
    if (deleteDecision.status === "reject") {
      throw badRequest(deleteDecision.message);
    }
    if (deleteDecision.status === "not-found") {
      throw notFound(deleteDecision.message, "JOB_SCHEDULE_NOT_FOUND");
    }
    if (current === undefined) {
      throw new Error(`Runtime job schedule '${scheduleId}' passed delete policy but was not loaded`);
    }
    const stream = jobScheduleDefinitionsStream();
    const event = createJobScheduleDeletedEvent({
      id: this.ids.next("evt_"),
      tenantId,
      actorId: actor.id,
      occurredAt: this.clock.now(),
      scheduleId,
      metadata: command.metadata ?? {}
    });
    await events.append(stream, state.version, [event]);
    const schedule = this.summaryFor(current, runtimeJobScheduleIndex(state, tenantId, current.id), await this.overrideState(tenantId), "runtime");
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
    const decision = planJobScheduleOverrideClear({ hasOverride: state.overrides.has(summary.id) });
    if (decision.status === "noop") {
      return { schedule: this.summaryFor(schedule, index, state) };
    }
    const stream = jobScheduleOverridesStream(tenantId);
    const event = createJobScheduleOverrideClearedEvent({
      id: this.ids.next("evt_"),
      tenantId,
      actorId: actor.id,
      occurredAt: this.clock.now(),
      scheduleId: summary.id,
      metadata: command.metadata ?? {}
    });
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
    const now = this.clock.now();
    const pausedUntil = normalizePauseUntil(command.pausedUntil, now);
    const current = state.overrides.get(summary.id);
    const decision = planJobSchedulePauseOverride({
      ...(current?.pausedUntil === undefined ? {} : { currentPausedUntil: current.pausedUntil }),
      pausedUntil,
      now
    });
    if (decision.status === "noop") {
      return { schedule: this.summaryFor(schedule, index, state) };
    }
    const stream = jobScheduleOverridesStream(tenantId);
    const event = createJobSchedulePausedEvent({
      id: this.ids.next("evt_"),
      tenantId,
      actorId: actor.id,
      occurredAt: this.clock.now(),
      scheduleId: summary.id,
      pausedUntil,
      metadata: command.metadata ?? {}
    });
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
    for (const [runtimeIndex, schedule] of runtimeJobSchedules(await this.definitionState()).entries()) {
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
    const decision = planJobScheduleEnabledOverride({
      ...(current?.enabled === undefined ? {} : { currentEnabled: current.enabled }),
      configuredEnabled: summary.configuredEnabled,
      targetEnabled: command.enabled
    });
    if (decision.status === "noop") {
      return { schedule: this.summaryFor(schedule, index, state) };
    }
    const stream = jobScheduleOverridesStream(tenantId);
    const event = createJobScheduleOverrideSetEvent({
      id: this.ids.next("evt_"),
      tenantId,
      actorId: command.actor.id,
      occurredAt: this.clock.now(),
      scheduleId: summary.id,
      enabled: command.enabled,
      metadata: command.metadata ?? {}
    });
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
      const runtime = runtimeJobScheduleForTenant(definitions, tenantId, scheduleId);
      if (!runtime) {
        throw notFound(`Job schedule '${scheduleId}' was not found`, "JOB_SCHEDULE_NOT_FOUND");
      }
      const runtimeIndex = runtimeJobScheduleIndex(definitions, tenantId, runtime.id);
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
      ...runtimeJobSchedules(definitions).map((schedule, index) =>
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
    const override = tenantId === overrides.tenantId ? overrides.overrides.get(id) : undefined;
    return planJobScheduleSummary({
      id,
      cron: schedule.cron,
      jobName: schedule.jobName,
      source,
      hasScheduleId: schedule.id !== undefined,
      configuredEnabled: schedule.enabled !== false,
      canOverride: this.canOverride(),
      canDispatch: this.canDispatch(),
      registered,
      now: this.clock.now(),
      dynamic,
      ...(job === undefined ? {} : { job }),
      ...(override === undefined ? {} : { override }),
      ...(schedule.delaySeconds === undefined ? {} : { delaySeconds: schedule.delaySeconds }),
      ...(tenantId === undefined ? {} : { tenantId }),
    });
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
    return foldJobScheduleOverrides(
      tenantId,
      await this.events.readStream(jobScheduleOverridesStream(tenantId), {
        payloadKinds: JOB_SCHEDULE_OVERRIDE_PAYLOAD_KINDS
      })
    );
  }

  private async definitionState(): Promise<JobScheduleDefinitionState> {
    if (!this.events) {
      return { version: 0, schedules: new Map() };
    }
    return foldJobScheduleDefinitions(
      await this.events.readStream(jobScheduleDefinitionsStream(), {
        payloadKinds: JOB_SCHEDULE_DEFINITION_PAYLOAD_KINDS
      })
    );
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

function normalizePauseUntil(value: string, now: string): string {
  const normalized = normalizeJobScheduleText(value, "pauseUntil");
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw badRequest("Job schedule pauseUntil must be a valid timestamp");
  }
  if (timestamp <= Date.parse(now)) {
    throw badRequest("Job schedule pauseUntil must be in the future");
  }
  return new Date(timestamp).toISOString();
}
