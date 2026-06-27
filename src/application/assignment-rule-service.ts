import {
  assignmentRuleAssignmentsFromDomainEvent,
  type AssignmentRuleDocumentAssignment
} from "../core/assignment-rules.js";
import type { DocumentHooks, AfterCommitContext } from "../core/registry.js";
import type { Actor } from "../core/types.js";
import type { DocumentCommandExecutor } from "./document-service.js";

export type AssignmentRuleActorResolver = (
  context: AfterCommitContext
) => Actor | Promise<Actor>;

export interface DocumentAssignmentRuleHookOptions {
  readonly documents: Pick<DocumentCommandExecutor, "assign">;
  readonly actor: Actor | AssignmentRuleActorResolver;
  readonly onAssignmentError?: (
    error: unknown,
    context: AfterCommitContext,
    assignment: AssignmentRuleDocumentAssignment
  ) => void | Promise<void>;
}

export function createDocumentAssignmentRuleHooks(
  options: DocumentAssignmentRuleHookOptions
): DocumentHooks {
  return {
    async afterCommit(context) {
      const rules = context.doctype.assignmentRules ?? [];
      if (rules.length === 0) {
        return;
      }
      const assignments = assignmentRuleAssignmentsFromDomainEvent({
        event: context.event,
        snapshot: context.snapshot,
        rules
      });
      if (assignments.length === 0) {
        return;
      }
      const actor = await resolveAssignmentRuleActor(options.actor, context);
      for (const assignment of assignments) {
        try {
          await options.documents.assign({
            actor: { ...actor, tenantId: context.event.tenantId },
            tenantId: context.event.tenantId,
            doctype: context.event.doctype,
            name: context.event.documentName,
            assignee: assignment.assigneeId,
            metadata: {
              sourceEventId: context.event.id,
              sourcePayloadKind: context.event.payload.kind,
              assignmentRuleName: assignment.ruleName
            }
          });
        } catch (error) {
          if (options.onAssignmentError === undefined) {
            throw error;
          }
          await options.onAssignmentError(error, context, assignment);
        }
      }
    }
  };
}

function resolveAssignmentRuleActor(
  actor: Actor | AssignmentRuleActorResolver,
  context: AfterCommitContext
): Actor | Promise<Actor> {
  return typeof actor === "function" ? actor(context) : actor;
}
