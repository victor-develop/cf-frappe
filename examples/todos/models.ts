import { createRegistry, defineDocType } from "../../src";

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
      label: "Workflow State",
      type: "select",
      options: ["Open", "Doing", "Done"],
      defaultValue: "Open"
    },
    {
      name: "created_by",
      label: "Created By",
      type: "text",
      readOnly: true,
      defaultValue: ({ actor }) => actor.id
    }
  ],
  workflow: {
    initialState: "Open",
    states: ["Open", "Doing", "Done"],
    transitions: [
      { action: "start", from: "Open", to: "Doing", roles: ["User", "Task Manager"] },
      { action: "finish", from: "Doing", to: "Done", roles: ["User", "Task Manager"] },
      { action: "reopen", from: "Done", to: "Open", roles: ["Task Manager"] }
    ]
  },
  permissions: [
    { roles: ["Guest"], actions: ["read"] },
    { roles: ["User"], actions: ["read", "create", "update", "transition"] },
    { roles: ["Task Manager"], actions: ["read", "create", "update", "delete", "transition"] }
  ],
  indexes: [["priority"], ["workflow_state", "priority"]]
});

export const todoRegistry = createRegistry({
  doctypes: [Task],
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
