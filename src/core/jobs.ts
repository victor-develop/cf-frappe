import { FrameworkError } from "./errors.js";
import type { DocumentData, JsonValue } from "./types.js";

type JobMaybePromise<T> = T | Promise<T>;
export type JobName = string;
export type JobPayload = DocumentData;
export type JobHandlerResult = JsonValue | void;
export const DEFAULT_JOB_WORKER_POOL = "default";
export const MAX_JOB_RETRY_DELAY_SECONDS = 86_400;

export interface JobRetryPolicy {
  readonly maxAttempts?: number;
  readonly baseDelaySeconds?: number;
  readonly maxDelaySeconds?: number;
}

export interface JobWorkerPoolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly concurrency?: number;
  readonly retry?: JobRetryPolicy;
}

export interface ResolvedJobWorkerPool {
  readonly name: string;
  readonly description?: string;
  readonly concurrency: number;
  readonly retry?: JobRetryPolicy;
}

export interface JobHandlerContext<TPayload extends JobPayload = JobPayload, TResources = unknown> {
  readonly tenantId?: string;
  readonly jobName: JobName;
  readonly payload: TPayload;
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly enqueuedAt: string;
  readonly attempt: number;
  readonly metadata: DocumentData;
  readonly resources: TResources;
}

export type JobHandler<TPayload extends JobPayload = JobPayload, TResources = unknown> = (
  context: JobHandlerContext<TPayload, TResources>
) => JobMaybePromise<JobHandlerResult>;

export interface JobDefinition<TPayload extends JobPayload = JobPayload, TResources = unknown> {
  readonly name: JobName;
  readonly handler: JobHandler<TPayload, TResources>;
  readonly description?: string;
  readonly pool?: string;
  readonly retry?: JobRetryPolicy;
}

export interface JobRegistryOptions<TResources = unknown> {
  readonly jobs?: readonly JobDefinition<JobPayload, TResources>[];
  readonly workerPools?: readonly JobWorkerPoolDefinition[];
}

export class JobRegistry<TResources = unknown> {
  private readonly jobs = new Map<JobName, JobDefinition<JobPayload, TResources>>();
  private readonly workerPools = new Map<string, ResolvedJobWorkerPool>([
    [DEFAULT_JOB_WORKER_POOL, { name: DEFAULT_JOB_WORKER_POOL, concurrency: 1 }]
  ]);

  constructor(options: JobRegistryOptions<TResources> = {}) {
    const poolNames = new Set<string>();
    for (const pool of options.workerPools ?? []) {
      const normalized = normalizeWorkerPool(pool);
      if (poolNames.has(normalized.name)) {
        throw new FrameworkError("JOB_POOL_DUPLICATE", `Job worker pool '${normalized.name}' is already registered`, {
          status: 409
        });
      }
      poolNames.add(normalized.name);
      this.workerPools.set(normalized.name, normalized);
    }
    for (const job of options.jobs ?? []) {
      this.register(job);
    }
  }

  register<TPayload extends JobPayload>(definition: JobDefinition<TPayload, TResources>): void {
    if (this.jobs.has(definition.name)) {
      throw new FrameworkError("JOB_DUPLICATE", `Job '${definition.name}' is already registered`, {
        status: 409
      });
    }
    const poolName = normalizeJobPool(definition.pool);
    if (!this.workerPools.has(poolName)) {
      throw new FrameworkError("JOB_POOL_NOT_FOUND", `Job worker pool '${poolName}' is not registered`, {
        status: 404
      });
    }
    const retry = normalizeJobRetryPolicy(definition.retry, `Job '${definition.name}' retry`);
    this.jobs.set(definition.name, {
      ...definition,
      ...(poolName === DEFAULT_JOB_WORKER_POOL ? {} : { pool: poolName }),
      ...(retry === undefined ? {} : { retry })
    } as JobDefinition<JobPayload, TResources>);
  }

  get(name: JobName): JobDefinition<JobPayload, TResources> {
    const definition = this.jobs.get(name);
    if (!definition) {
      throw new FrameworkError("JOB_NOT_FOUND", `Job '${name}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  has(name: JobName): boolean {
    return this.jobs.has(name);
  }

  list(): readonly JobDefinition<JobPayload, TResources>[] {
    return [...this.jobs.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  workerPoolFor(jobName: JobName): ResolvedJobWorkerPool {
    const definition = this.get(jobName);
    return this.workerPools.get(definition.pool ?? DEFAULT_JOB_WORKER_POOL) ?? {
      name: DEFAULT_JOB_WORKER_POOL,
      concurrency: 1
    };
  }

  listWorkerPools(): readonly ResolvedJobWorkerPool[] {
    return [...this.workerPools.values()].sort((left, right) => left.name.localeCompare(right.name));
  }
}

export function createJobRegistry<TResources = unknown>(
  options: JobRegistryOptions<TResources> = {}
): JobRegistry<TResources> {
  return new JobRegistry(options);
}

export function normalizeJobRetryPolicy(
  policy: JobRetryPolicy | undefined,
  label = "Job retry policy"
): JobRetryPolicy | undefined {
  if (policy === undefined) {
    return undefined;
  }
  return {
    ...(policy.maxAttempts === undefined
      ? {}
      : { maxAttempts: normalizePositiveInteger(policy.maxAttempts, `${label} maxAttempts`) }),
    ...(policy.baseDelaySeconds === undefined
      ? {}
      : { baseDelaySeconds: normalizeJobRetryDelaySeconds(policy.baseDelaySeconds, `${label} baseDelaySeconds`) }),
    ...(policy.maxDelaySeconds === undefined
      ? {}
      : { maxDelaySeconds: normalizeJobRetryDelaySeconds(policy.maxDelaySeconds, `${label} maxDelaySeconds`) })
  };
}

export function normalizeJobRetryDelaySeconds(value: number, label = "Job retry delaySeconds"): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_JOB_RETRY_DELAY_SECONDS) {
    throw new FrameworkError(
      "JOB_RETRY_INVALID",
      `${label} must be an integer between 1 and ${MAX_JOB_RETRY_DELAY_SECONDS}`,
      { status: 400 }
    );
  }
  return value;
}

function normalizeWorkerPool(definition: JobWorkerPoolDefinition): ResolvedJobWorkerPool {
  const name = normalizeJobPool(definition.name);
  const concurrency = definition.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new FrameworkError("JOB_POOL_INVALID", `Job worker pool '${name}' concurrency must be a positive integer`, {
      status: 400
    });
  }
  const retry = normalizeJobRetryPolicy(definition.retry, `Job worker pool '${name}' retry`);
  return {
    name,
    concurrency,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    ...(retry === undefined ? {} : { retry })
  };
}

function normalizeJobPool(pool: string | undefined): string {
  const normalized = (pool ?? DEFAULT_JOB_WORKER_POOL).trim();
  if (normalized.length === 0) {
    throw new FrameworkError("JOB_POOL_INVALID", "Job worker pool name is required", {
      status: 400
    });
  }
  return normalized;
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new FrameworkError("JOB_RETRY_INVALID", `${label} must be a positive integer`, { status: 400 });
  }
  return value;
}
