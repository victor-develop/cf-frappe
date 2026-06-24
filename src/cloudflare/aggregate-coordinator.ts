import { DurableObject } from "cloudflare:workers";
import { CustomFieldService } from "../application/custom-field-service.js";
import { DocumentShareService } from "../application/document-share-service.js";
import { DocumentService, bulkDocumentFailure } from "../application/document-service.js";
import { FieldPropertyService } from "../application/field-property-service.js";
import { WorkflowService } from "../application/workflow-service.js";
import type { BulkDocumentCommandFailure } from "../application/document-service.js";
import { UserPermissionService } from "../application/user-permission-service.js";
import { ModelBackedUserPermissionGrantValidator } from "../application/user-permission-grant-validator.js";
import type { DocTypeDefinition, DomainEvent, DocumentSnapshot } from "../core/types.js";
import { createDocumentDeliveryHooks } from "../application/realtime.js";
import { UserNotificationService } from "../application/user-notification-service.js";
import type {
  AmendDocumentCommand,
  AssignDocumentCommand,
  CancelDocumentCommand,
  AddDocumentCommentCommand,
  CreateDocumentCommand,
  DeleteDocumentCommand,
  DuplicateDocumentCommand,
  FollowDocumentCommand,
  ShareDocumentCommand,
  RecordDocumentActivityCommand,
  SubmitDocumentCommand,
  TagDocumentCommand,
  TransitionDocumentCommand,
  UnassignDocumentCommand,
  UntagDocumentCommand,
  UnfollowDocumentCommand,
  RevokeDocumentShareCommand,
  UpdateDocumentCommand
} from "../application/document-service.js";
import type { ExecuteDomainCommand } from "../application/document-service.js";
import { D1DocumentStore, D1EventStore } from "../adapters/d1/index.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { RealtimePublisher } from "../ports/realtime.js";

export type AggregateCoordinatorCommand =
  | ({ readonly kind: "create" } & CreateDocumentCommand)
  | ({ readonly kind: "duplicate" } & DuplicateDocumentCommand)
  | ({ readonly kind: "amend" } & AmendDocumentCommand)
  | ({ readonly kind: "update" } & UpdateDocumentCommand)
  | ({ readonly kind: "submit" } & SubmitDocumentCommand)
  | ({ readonly kind: "cancel" } & CancelDocumentCommand)
  | ({ readonly kind: "delete" } & DeleteDocumentCommand)
  | ({ readonly kind: "transition" } & TransitionDocumentCommand)
  | ({ readonly kind: "execute" } & ExecuteDomainCommand)
  | ({ readonly kind: "comment" } & AddDocumentCommentCommand)
  | ({ readonly kind: "recordActivity" } & RecordDocumentActivityCommand)
  | ({ readonly kind: "assign" } & AssignDocumentCommand)
  | ({ readonly kind: "unassign" } & UnassignDocumentCommand)
  | ({ readonly kind: "tag" } & TagDocumentCommand)
  | ({ readonly kind: "untag" } & UntagDocumentCommand)
  | ({ readonly kind: "follow" } & FollowDocumentCommand)
  | ({ readonly kind: "unfollow" } & UnfollowDocumentCommand)
  | ({ readonly kind: "share" } & ShareDocumentCommand)
  | ({ readonly kind: "revokeShare" } & RevokeDocumentShareCommand);

export type AggregateCoordinatorTransactResult =
  | {
      readonly ok: true;
      readonly snapshot: DocumentSnapshot;
    }
  | {
      readonly ok: false;
      readonly failure: BulkDocumentCommandFailure;
    };

export interface AggregateCoordinatorEnv {
  readonly DB: D1Database;
}

export interface AggregateCoordinatorOptions<Env extends AggregateCoordinatorEnv = AggregateCoordinatorEnv> {
  readonly registry: ModelRegistry;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly realtime?: (env: Env) => RealtimePublisher;
  readonly notifications?: boolean;
  readonly onHookError?: (error: unknown, event: DomainEvent) => void | Promise<void>;
}

export type AggregateCoordinatorClass<Env extends AggregateCoordinatorEnv = AggregateCoordinatorEnv> = new (
  ctx: DurableObjectState,
  env: Env
) => {
  transact(command: AggregateCoordinatorCommand): Promise<DocumentSnapshot>;
  tryTransact(command: AggregateCoordinatorCommand): Promise<AggregateCoordinatorTransactResult>;
};

export function createAggregateCoordinatorClass<Env extends AggregateCoordinatorEnv = AggregateCoordinatorEnv>(
  options: AggregateCoordinatorOptions<Env>
): AggregateCoordinatorClass<Env> {
  return class CloudFrappeAggregateCoordinator extends DurableObject<Env> {
    private readonly service: DocumentService;

    constructor(_ctx: DurableObjectState, env: Env) {
      super(_ctx, env);
      const events = new D1EventStore(env.DB);
      const notifications = options.notifications === false
        ? undefined
        : new UserNotificationService({
            events,
            ...(options.clock ? { clock: options.clock } : {})
      });
      const customFields = new CustomFieldService({
        registry: options.registry,
        events
      });
      const prePropertyDocType = (base: DocTypeDefinition, context: { readonly tenantId: string }) =>
        customFields.effectiveDocType(base.name, context.tenantId);
      const fieldProperties = new FieldPropertyService({
        registry: options.registry,
        events,
        prePropertyDocTypeResolver: prePropertyDocType
      });
      const preWorkflowDocType = (base: DocTypeDefinition, context: { readonly tenantId: string }) =>
        fieldProperties.effectiveDocType(base.name, context.tenantId);
      const workflows = new WorkflowService({
        registry: options.registry,
        events,
        preWorkflowDocTypeResolver: preWorkflowDocType
      });
      const effectiveDocType = (base: DocTypeDefinition, context: { readonly tenantId: string }) =>
        workflows.effectiveDocType(base.name, context.tenantId);
      const deliveryHooks = createDocumentDeliveryHooks({
        ...(options.realtime ? { realtime: options.realtime(env) } : {}),
        ...(notifications ? { notifications } : {})
      });
      this.service = new DocumentService({
        registry: options.registry,
        store: new D1DocumentStore(env.DB),
        doctypeResolver: effectiveDocType,
        documentShares: new DocumentShareService({ events }),
        userPermissions: new UserPermissionService({
          events,
          validator: new ModelBackedUserPermissionGrantValidator({ registry: options.registry, events })
        }),
        ...(options.clock ? { clock: options.clock } : {}),
        ...(options.ids ? { ids: options.ids } : {}),
        ...(options.onHookError ? { onHookError: options.onHookError } : {}),
        ...(deliveryHooks.afterCommit ? { afterCommit: deliveryHooks.afterCommit } : {})
      });
    }

    async transact(command: AggregateCoordinatorCommand): Promise<DocumentSnapshot> {
      switch (command.kind) {
        case "create":
          return this.service.create(command);
        case "duplicate":
          return this.service.duplicate(command);
        case "amend":
          return this.service.amend(command);
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
        case "comment":
          return this.service.comment(command);
        case "recordActivity":
          return this.service.recordActivity(command);
        case "assign":
          return this.service.assign(command);
        case "unassign":
          return this.service.unassign(command);
        case "tag":
          return this.service.tag(command);
        case "untag":
          return this.service.untag(command);
        case "follow":
          return this.service.follow(command);
        case "unfollow":
          return this.service.unfollow(command);
        case "share":
          return this.service.share(command);
        case "revokeShare":
          return this.service.revokeShare(command);
      }
    }

    async tryTransact(command: AggregateCoordinatorCommand): Promise<AggregateCoordinatorTransactResult> {
      try {
        return { ok: true, snapshot: await this.transact(command) };
      } catch (error) {
        return { ok: false, failure: bulkDocumentFailure(documentNameForFailure(command), error) };
      }
    }
  };
}

function documentNameForFailure(command: AggregateCoordinatorCommand): string {
  return command.kind === "create" ? command.name ?? "_new" : command.name;
}
