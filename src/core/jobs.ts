import { FrameworkError } from "./errors.js";
import type { DocumentData, JsonValue } from "./types.js";

type JobMaybePromise<T> = T | Promise<T>;
export type JobName = string;
export type JobPayload = DocumentData;
export type JobHandlerResult = JsonValue | void;

export interface JobRetryPolicy {
  readonly maxAttempts?: number;
  readonly baseDelaySeconds?: number;
  readonly maxDelaySeconds?: number;
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
  readonly retry?: JobRetryPolicy;
}

export interface JobRegistryOptions<TResources = unknown> {
  readonly jobs?: readonly JobDefinition<JobPayload, TResources>[];
}

export class JobRegistry<TResources = unknown> {
  private readonly jobs = new Map<JobName, JobDefinition<JobPayload, TResources>>();

  constructor(options: JobRegistryOptions<TResources> = {}) {
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
    this.jobs.set(definition.name, definition as JobDefinition<JobPayload, TResources>);
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
}

export function createJobRegistry<TResources = unknown>(
  options: JobRegistryOptions<TResources> = {}
): JobRegistry<TResources> {
  return new JobRegistry(options);
}
