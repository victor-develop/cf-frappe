import { createRegistryFromApps, defineApp, defineDocType, definePrintFormat, defineReport } from "../../src";

export const Task = defineDocType({
  name: "Task",
  module: "Desk",
  label: "Task",
  version: 1,
  naming: { kind: "field", field: "title" },
  fields: [
    {
      name: "title",
      label: "Title",
      type: "text",
      required: true,
      min: 3,
      max: 120
    },
    {
      name: "description",
      label: "Description",
      type: "longText"
    },
    {
      name: "priority",
      label: "Priority",
      type: "select",
      options: ["Low", "Medium", "High"],
      defaultValue: "Medium"
    },
    {
      name: "workflow_state",
      label: "Lifecycle State",
      type: "select",
      options: ["Open", "Doing", "Done"],
      defaultValue: "Open"
    },
    {
      name: "review_state",
      label: "Review State",
      type: "select",
      options: ["Pending", "Approved"],
      defaultValue: "Pending"
    },
    {
      name: "escalated",
      label: "Escalated",
      type: "boolean",
      defaultValue: false
    },
    {
      name: "created_by",
      label: "Created By",
      type: "text",
      readOnly: true,
      defaultValue: ({ actor }) => actor.id
    }
  ],
  workflows: [
    {
      name: "lifecycle",
      label: "Lifecycle",
      stateField: "workflow_state",
      initialState: "Open",
      states: ["Open", "Doing", "Done"],
      transitions: [
        { action: "start", from: "Open", to: "Doing", roles: ["User", "Task Manager"] },
        { action: "finish", from: "Doing", to: "Done", roles: ["User", "Task Manager"] },
        { action: "reopen", from: "Done", to: "Open", roles: ["Task Manager"] }
      ]
    },
    {
      name: "review",
      label: "Review",
      stateField: "review_state",
      initialState: "Pending",
      states: ["Pending", "Approved"],
      transitions: [{
        action: "approve",
        from: "Pending",
        to: "Approved",
        roles: ["Task Manager"],
        allowWhen: {
          kind: "compare",
          left: { kind: "field", scope: "before", field: "workflow_state" },
          operator: "eq",
          right: { kind: "literal", value: "Done" }
        }
      }]
    }
  ],
  commands: [{
    name: "finishAndApprove",
    eventType: "TaskFinishedAndApproved",
    roles: ["Task Manager"],
    buildPlan: () => ({
      patch: { workflow_state: "Done", review_state: "Approved" },
      transitions: [
        { workflow: "lifecycle", action: "finish" },
        { workflow: "review", action: "approve" }
      ]
    })
  }],
  automationRules: [{
    id: "mark-high-priority",
    name: "Mark high-priority tasks as escalated",
    trigger: {
      events: ["DocumentUpdated"],
      changes: [{ field: "priority", to: "High" }]
    },
    actions: [{
      id: "mark-escalated",
      kind: "updateDocument",
      target: { doctype: "Task", name: { kind: "documentName" } },
      patch: { escalated: { kind: "literal", value: true } }
    }]
  }],
  permissions: [
    { roles: ["Guest"], actions: ["read"] },
    { roles: ["User"], actions: ["read", "create", "update", "transition"] },
    { roles: ["Task Manager"], actions: ["read", "create", "update", "delete", "transition"] }
  ],
  indexes: [["priority"], ["workflow_state", "priority"]]
});

export const OpenTasks = defineReport({
  name: "Open Tasks",
  label: "Open Tasks",
  module: "Desk",
  description: "Open task queue by priority.",
  doctype: "Task",
  columns: [
    { name: "title", label: "Title", type: "text" },
    { name: "priority", label: "Priority", type: "select" },
    { name: "workflow_state", label: "State", type: "select" }
  ],
  filters: [
    { name: "priority", label: "Priority", field: "priority", type: "select" },
    { name: "workflow_state", label: "State", field: "workflow_state", type: "select", defaultValue: "Open" }
  ],
  roles: ["Guest", "User", "Task Manager"]
});

export const TaskPrint = definePrintFormat({
  name: "Task Standard",
  label: "Task Standard",
  module: "Desk",
  description: "Printable task summary.",
  doctype: "Task",
  sections: [
    {
      heading: "Task",
      fields: [
        { field: "title", label: "Title" },
        { field: "priority", label: "Priority" },
        { field: "workflow_state", label: "State" },
        { field: "description", label: "Description" }
      ]
    }
  ],
  roles: ["Guest", "User", "Task Manager"]
});

export const todoApp = defineApp({
  name: "todos",
  label: "Todos",
  version: "1.0.0",
  modules: ["Desk"],
  doctypes: [Task],
  printFormats: [TaskPrint],
  reports: [OpenTasks],
  hooks: {
    Task: [
      {
        beforeValidate: ({ data }) => ({
          title: typeof data.title === "string" ? data.title.trim() : data.title
        }),
        validate: ({ data }) =>
          data.priority === "High" && !data.description
            ? [
                {
                  field: "description",
                  code: "required_for_high_priority",
                  message: "High priority tasks need a description"
                }
              ]
            : []
      }
    ]
  }
});

export const todoRegistry = createRegistryFromApps([todoApp]);
