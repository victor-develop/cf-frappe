import type { Actor, DocumentSnapshot, WorkflowDefinition, WorkflowTransition } from "./types";

export interface WorkflowTransitionContext {
  readonly actor: Actor;
  readonly document: DocumentSnapshot;
  readonly workflow: WorkflowDefinition;
}

export function currentWorkflowState(
  workflow: WorkflowDefinition,
  document: DocumentSnapshot
): string {
  const stateField = workflow.stateField ?? "workflow_state";
  return String(document.data[stateField] ?? workflow.initialState);
}

export function allowedWorkflowTransitions(
  context: WorkflowTransitionContext
): readonly WorkflowTransition[] {
  const currentState = currentWorkflowState(context.workflow, context.document);
  return context.workflow.transitions.filter(
    (transition) =>
      transition.from === currentState &&
      (transition.roles === undefined || transition.roles.some((role) => context.actor.roles.includes(role)))
  );
}

