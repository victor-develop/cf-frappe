import { DurableObject } from "cloudflare:workers";
import { DocumentService } from "../application/document-service";
import type {
  CreateDocumentCommand,
  DeleteDocumentCommand,
  TransitionDocumentCommand,
  UpdateDocumentCommand
} from "../application/document-service";
import type { ExecuteDomainCommand } from "../application/document-service";
import { D1DocumentStore } from "../adapters/d1";
import type { ModelRegistry } from "../core/registry";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";

export type AggregateCoordinatorCommand =
  | ({ readonly kind: "create" } & CreateDocumentCommand)
  | ({ readonly kind: "update" } & UpdateDocumentCommand)
  | ({ readonly kind: "delete" } & DeleteDocumentCommand)
  | ({ readonly kind: "transition" } & TransitionDocumentCommand)
  | ({ readonly kind: "execute" } & ExecuteDomainCommand);

export interface AggregateCoordinatorEnv {
  readonly DB: D1Database;
}

export interface AggregateCoordinatorOptions {
  readonly registry: ModelRegistry;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

export type AggregateCoordinatorClass = new (
  ctx: DurableObjectState,
  env: AggregateCoordinatorEnv
) => {
  transact(command: AggregateCoordinatorCommand): Promise<unknown>;
};

export function createAggregateCoordinatorClass(
  options: AggregateCoordinatorOptions
): AggregateCoordinatorClass {
  return class CloudFrappeAggregateCoordinator extends DurableObject<AggregateCoordinatorEnv> {
    private readonly service: DocumentService;

    constructor(_ctx: DurableObjectState, env: AggregateCoordinatorEnv) {
      super(_ctx, env);
      this.service = new DocumentService({
        registry: options.registry,
        store: new D1DocumentStore(env.DB),
        ...(options.clock ? { clock: options.clock } : {}),
        ...(options.ids ? { ids: options.ids } : {})
      });
    }

    async transact(command: AggregateCoordinatorCommand): Promise<unknown> {
      switch (command.kind) {
        case "create":
          return this.service.create(command);
        case "update":
          return this.service.update(command);
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
