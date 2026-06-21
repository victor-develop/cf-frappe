import { DurableObject } from "cloudflare:workers";
import { DocumentService } from "../application/document-service";
import type { DomainEvent } from "../core/types";
import { createDocumentRealtimeHooks } from "../application/realtime";
import type {
  CancelDocumentCommand,
  CreateDocumentCommand,
  DeleteDocumentCommand,
  SubmitDocumentCommand,
  TransitionDocumentCommand,
  UpdateDocumentCommand
} from "../application/document-service";
import type { ExecuteDomainCommand } from "../application/document-service";
import { D1DocumentStore } from "../adapters/d1";
import type { ModelRegistry } from "../core/registry";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { RealtimePublisher } from "../ports/realtime";

export type AggregateCoordinatorCommand =
  | ({ readonly kind: "create" } & CreateDocumentCommand)
  | ({ readonly kind: "update" } & UpdateDocumentCommand)
  | ({ readonly kind: "submit" } & SubmitDocumentCommand)
  | ({ readonly kind: "cancel" } & CancelDocumentCommand)
  | ({ readonly kind: "delete" } & DeleteDocumentCommand)
  | ({ readonly kind: "transition" } & TransitionDocumentCommand)
  | ({ readonly kind: "execute" } & ExecuteDomainCommand);

export interface AggregateCoordinatorEnv {
  readonly DB: D1Database;
}

export interface AggregateCoordinatorOptions<Env extends AggregateCoordinatorEnv = AggregateCoordinatorEnv> {
  readonly registry: ModelRegistry;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly realtime?: (env: Env) => RealtimePublisher;
  readonly onHookError?: (error: unknown, event: DomainEvent) => void | Promise<void>;
}

export type AggregateCoordinatorClass<Env extends AggregateCoordinatorEnv = AggregateCoordinatorEnv> = new (
  ctx: DurableObjectState,
  env: Env
) => {
  transact(command: AggregateCoordinatorCommand): Promise<unknown>;
};

export function createAggregateCoordinatorClass<Env extends AggregateCoordinatorEnv = AggregateCoordinatorEnv>(
  options: AggregateCoordinatorOptions<Env>
): AggregateCoordinatorClass<Env> {
  return class CloudFrappeAggregateCoordinator extends DurableObject<Env> {
    private readonly service: DocumentService;

    constructor(_ctx: DurableObjectState, env: Env) {
      super(_ctx, env);
      this.service = new DocumentService({
        registry: options.registry,
        store: new D1DocumentStore(env.DB),
        ...(options.clock ? { clock: options.clock } : {}),
        ...(options.ids ? { ids: options.ids } : {}),
        ...(options.onHookError ? { onHookError: options.onHookError } : {}),
        ...(options.realtime ? { afterCommit: createDocumentRealtimeHooks(options.realtime(env)).afterCommit } : {})
      });
    }

    async transact(command: AggregateCoordinatorCommand): Promise<unknown> {
      switch (command.kind) {
        case "create":
          return this.service.create(command);
        case "update":
          return this.service.update(command);
        case "submit":
          return this.service.submit(command);
        case "cancel":
          return this.service.cancel(command);
        case "delete":
          return this.service.delete(command);
        case "transition":
          return this.service.transition(command);
        case "execute":
          return this.service.execute(command);
      }
    }
  };
}
