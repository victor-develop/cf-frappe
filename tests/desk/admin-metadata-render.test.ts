import { defineDocType } from "../../src/core/schema.js";
import { type CustomFieldState } from "../../src/core/custom-fields.js";
import { type FieldPropertyOverrideState } from "../../src/core/field-property-overrides.js";
import { type NamedWorkflowDefinitionState } from "../../src/core/workflow.js";
import {
  renderCustomFieldAdmin,
  renderFieldPropertyAdmin,
  renderNamingAdmin,
  renderWorkflowAdmin
} from "../../src/adapters/desk/views/admin-metadata.js";

const eqOpen = {
  kind: "compare",
  left: { kind: "field", scope: "after", field: "status" },
  operator: "eq",
  right: { kind: "literal", value: "Open" }
} as const;

const eqDone = {
  kind: "compare",
  left: { kind: "field", scope: "after", field: "status" },
  operator: "eq",
  right: { kind: "literal", value: "Done" }
} as const;

const Task = defineDocType({
  name: "Task",
  label: "Task Item",
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "status", type: "select", options: ["Open", "Done"] },
    { name: "assignee", type: "link", linkTo: "User" },
    { name: "serial", type: "text", readOnly: true, noCopy: true },
    { name: "meta", type: "json" },
    { name: "notes", type: "longText" }
  ]
});

const User = defineDocType({
  name: "User",
  fields: [
    { name: "email", type: "text" },
    { name: "secret", type: "text", hidden: true }
  ]
});

const Blob = defineDocType({
  name: "Blob",
  fields: [{ name: "payload", type: "json" }]
});

describe("Desk custom field admin", () => {
  it("renders a bare state with no persisted fields", () => {
    const html = renderCustomFieldAdmin({ doctypes: [Task, User], selectedDoctype: "Task" });
    expect(html).toContain("No custom fields configured.");
    expect(html).toContain('value="0"');
    expect(html).not.toContain('class="error"');
  });

  it("renders a rich draft, error, and enabled/disabled entries with detail branches", () => {
    const state: CustomFieldState = {
      tenantId: "tenant-a",
      doctype: "Task",
      version: 4,
      fields: [
        {
          tenantId: "tenant-a",
          doctype: "Task",
          field: {
            name: "rating",
            type: "integer",
            label: "Rating",
            description: "1 to 5",
            placeholder: "Pick",
            options: ["1", "2"],
            linkTo: "User",
            tableOf: "Blob",
            fetchFrom: "assignee.email",
            min: 1,
            max: 5,
            defaultValue: 3,
            mandatoryDependsOn: eqOpen,
            readOnlyDependsOn: eqDone,
            hiddenDependsOn: eqDone,
            required: true,
            readOnly: true,
            hidden: true,
            printHide: true,
            printHideIfNoValue: true,
            unique: true,
            noCopy: true,
            allowOnSubmit: true,
            fetchIfEmpty: true,
            inFormView: true,
            inListView: true,
            inListFilter: true
          },
          enabled: true,
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-02T00:00:00Z"
        },
        {
          tenantId: "tenant-a",
          doctype: "Task",
          field: { name: "legacy", type: "text" },
          enabled: false,
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-02T00:00:00Z"
        }
      ]
    };
    const html = renderCustomFieldAdmin({
      doctypes: [Task, User],
      selectedDoctype: "Task",
      doctype: Task,
      state,
      error: "Bad field",
      draftField: {
        name: "rating",
        type: "integer",
        label: "Rating",
        description: "1 to 5",
        placeholder: "Pick",
        options: ["1", "2"],
        linkTo: "User",
        tableOf: "Blob",
        fetchFrom: "assignee.email",
        min: 1,
        max: 5,
        defaultValue: 3,
        mandatoryDependsOn: eqOpen,
        readOnlyDependsOn: eqDone,
        hiddenDependsOn: eqDone,
        required: true,
        readOnly: true,
        hidden: true,
        printHide: true,
        printHideIfNoValue: true,
        unique: true,
        noCopy: true,
        allowOnSubmit: true,
        fetchIfEmpty: true,
        inFormView: true,
        inListView: true,
        inListFilter: true
      }
    });
    expect(html).toContain("Bad field");
    expect(html).toContain('value="rating"');
    expect(html).toContain("link: User");
    expect(html).toContain("table: Blob");
    expect(html).toContain("fetch from: assignee.email");
    expect(html).toContain("min: 1");
    expect(html).toContain("max: 5");
    expect(html).toContain("default: 3");
    expect(html).toContain("required, mandatory depends on, read only");
    expect(html).toContain("fetch if empty, form, list, filter");
    expect(html).toContain(">Disable</button>");
    expect(html).toContain(">disabled</td>");
  });
});

describe("Desk field property admin", () => {
  it("renders a bare state falling back to the first doctype field", () => {
    const html = renderFieldPropertyAdmin({ doctypes: [Task], selectedDoctype: "Task", selectedField: "" });
    expect(html).toContain("No field property overrides configured.");
    expect(html).toContain('value="title"');
    expect(html).not.toContain("Clear Override");
  });

  it("renders with an unknown doctype and empty field fallback", () => {
    const html = renderFieldPropertyAdmin({ doctypes: [], selectedDoctype: "Ghost", selectedField: "" });
    expect(html).toContain('name="fieldName" value=""');
  });

  it("renders full overrides with clear buttons and every summary segment", () => {
    const overrides = {
      label: "New Label",
      description: "Desc",
      placeholder: "Hint",
      required: true,
      mandatoryDependsOn: eqOpen,
      readOnly: false,
      readOnlyDependsOn: eqDone,
      hidden: false,
      hiddenDependsOn: eqDone,
      printHide: true,
      printHideIfNoValue: true,
      noCopy: true,
      allowOnSubmit: true,
      fetchFrom: "assignee.email",
      fetchIfEmpty: true,
      inFormView: true,
      inGlobalSearch: true,
      inListView: true,
      inListFilter: true,
      options: ["Open", "Blocked"],
      min: 0,
      max: 10,
      defaultValue: "Open"
    };
    const state: FieldPropertyOverrideState = {
      tenantId: "tenant-a",
      doctype: "Task",
      version: 7,
      fields: [
        { tenantId: "tenant-a", doctype: "Task", fieldName: "status", overrides, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-02T00:00:00Z" },
        { tenantId: "tenant-a", doctype: "Task", fieldName: "title", overrides: {}, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-02T00:00:00Z" }
      ]
    };
    const html = renderFieldPropertyAdmin({
      doctypes: [Task, User],
      selectedDoctype: "Task",
      selectedField: "status",
      doctype: Task,
      state,
      error: "Version conflict"
    });
    expect(html).toContain("Version conflict");
    expect(html).toContain("Clear Override");
    expect(html).toContain("label: New Label");
    expect(html).toContain("required: true");
    expect(html).toContain("read only: false");
    expect(html).toContain("fetch from: assignee.email");
    expect(html).toContain("options: Open, Blocked");
    expect(html).toContain("min: 0");
    expect(html).toContain("max: 10");
    expect(html).toContain("default: &quot;Open&quot;");
    expect(html).toContain('value="New Label"');
    expect(html).toContain('value="0"');
  });

  it("uses a draft override in preference to the stored entry", () => {
    const html = renderFieldPropertyAdmin({
      doctypes: [Task],
      selectedDoctype: "Task",
      selectedField: "title",
      draftOverrides: { label: "Draft Label", required: false }
    });
    expect(html).toContain('value="Draft Label"');
    expect(html).toContain('<option value="false" selected>False</option>');
  });
});

describe("Desk workflow admin", () => {
  it("renders a bare state with new-workflow heading and plain inputs", () => {
    const html = renderWorkflowAdmin({ doctypes: [Blob], selectedDoctype: "Blob" });
    expect(html).toContain("New Workflow");
    expect(html).toContain("No workflows configured.");
    expect(html).toContain('<input name="stateField" value=""/>');
    expect(html).toContain('<input name="initialState" value=""/>');
    expect(html).toContain('<input name="transitionFrom" value=""/>');
    expect(html).not.toContain("Clear Workflow");
  });

  it("renders a draft workflow with transitions, roles, and state selects", () => {
    const html = renderWorkflowAdmin({
      doctypes: [Task],
      selectedDoctype: "Task",
      selectedWorkflowName: "lifecycle",
      doctype: Task,
      roleSuggestions: ["System Manager"],
      draftWorkflow: {
        name: "lifecycle",
        label: "Lifecycle",
        stateField: "status",
        initialState: "Archived",
        states: ["Open", "Done", "Done"],
        transitions: [
          {
            action: "finish",
            from: "Open",
            to: "Done",
            roles: ["Reviewer"],
            allowWhen: eqOpen,
            eventType: "task.finished"
          },
          { action: "reopen", from: "Missing", to: "Open" }
        ]
      },
      error: "Invalid transition"
    });
    expect(html).toContain("Workflow Definition");
    expect(html).toContain("Invalid transition");
    expect(html).toContain("Clear Workflow");
    expect(html).toContain('value="Lifecycle"');
    expect(html).toContain('<option value="Archived" selected>Archived</option>');
    expect(html).toContain('<option value="Missing" selected>Missing</option>');
    expect(html).toContain("task.finished");
    expect(html).toContain("Reviewer");
    expect(html).toContain("workflow-role-suggestions-1");
  });

  it("renders stored workflow states with cleared, static, and runtime sources", () => {
    const entries: NamedWorkflowDefinitionState[] = [
      {
        tenantId: "tenant-a",
        doctypeName: "Task",
        workflowName: "lifecycle",
        version: 3,
        cleared: false,
        workflow: {
          name: "lifecycle",
          label: "Lifecycle",
          stateField: "status",
          initialState: "Open",
          states: ["Open", "Done"],
          transitions: [{ action: "finish", from: "Open", to: "Done" }]
        }
      },
      { tenantId: "tenant-a", doctypeName: "Task", workflowName: "review", version: 0, cleared: false },
      { tenantId: "tenant-a", doctypeName: "Task", workflowName: "retired", version: 5, cleared: true }
    ];
    const html = renderWorkflowAdmin({
      doctypes: [Task],
      selectedDoctype: "Task",
      selectedWorkflowName: "lifecycle",
      state: entries
    });
    expect(html).toContain(">runtime</td>");
    expect(html).toContain(">static</td>");
    expect(html).toContain(">cleared</td>");
    expect(html).toContain("workflow=lifecycle");
    expect(html).toContain("Workflow Definition");
  });

  it("falls back to the first defined workflow when the selected name is unknown", () => {
    const html = renderWorkflowAdmin({
      doctypes: [Task],
      selectedDoctype: "Task",
      selectedWorkflowName: "ghost",
      state: [
        {
          tenantId: "tenant-a",
          doctypeName: "Task",
          workflowName: "lifecycle",
          version: 2,
          cleared: false,
          workflow: {
            name: "lifecycle",
            stateField: "status",
            initialState: "Open",
            states: ["Open", "Done"],
            transitions: []
          }
        }
      ]
    });
    expect(html).toContain('value="lifecycle"');
    expect(html).toContain('<option value="Open" selected>Open</option>');
  });
});

describe("Desk naming admin", () => {
  it("renders defaults when nothing is configured", () => {
    const html = renderNamingAdmin({ doctypes: [], selectedDoctype: "" });
    expect(html).toContain('value="DOC-{sequence:6}"');
    expect(html).toContain('value="documents"');
    expect(html).toContain("No scalar fields are available.");
    expect(html).toContain("Counter not loaded");
    expect(html).toContain("Provide required token or scope data to preview this strategy.");
    expect(html).toContain("default v0");
    expect(html).not.toContain("Clear Runtime Strategy");
  });

  it("renders a configured runtime series strategy with preview candidates", () => {
    const html = renderNamingAdmin({
      doctypes: [Task],
      selectedDoctype: "Task",
      doctype: Task,
      state: {
        tenantId: "tenant-a",
        doctype: "Task",
        version: 3,
        source: "runtime",
        runtimeStrategy: {
          kind: "series",
          pattern: "TASK-{sequence:4}",
          targetField: "serial",
          counter: "tasks",
          padding: 4,
          start: 10,
          step: 2,
          reset: "year",
          scopeFields: ["status"],
          exclusions: [{ type: "exact", value: "TASK-0666" }],
          maxAttempts: 25
        }
      },
      preview: {
        tenantId: "tenant-a",
        doctype: "Task",
        counter: "tasks",
        scope: "status=Open",
        counterVersion: 6,
        current: 12,
        candidates: [
          { value: 14, name: "TASK-0014" },
          { value: 16, name: "TASK-0016" }
        ]
      },
      previewData: { status: "Open" },
      error: "Pattern invalid"
    });
    expect(html).toContain("Pattern invalid");
    expect(html).toContain('value="TASK-{sequence:4}"');
    expect(html).toContain("Clear Runtime Strategy");
    expect(html).toContain("tasks, scope status=Open, current 12, v6");
    expect(html).toContain("TASK-0014");
    expect(html).toContain('checked');
    expect(html).toContain("runtime v3");
    expect(html).toContain('value="12"');
  });

  it("falls back to a series default when the effective strategy is not a series", () => {
    const html = renderNamingAdmin({
      doctypes: [Task],
      selectedDoctype: "Task!!!",
      state: {
        tenantId: "tenant-a",
        doctype: "Task",
        version: 1,
        source: "static",
        effectiveStrategy: { kind: "uuid" }
      },
      preview: {
        tenantId: "tenant-a",
        doctype: "Task",
        counter: "task",
        scope: "",
        counterVersion: 0,
        candidates: []
      }
    });
    expect(html).toContain('value="Task!!!-{sequence:6}"');
    expect(html).toContain('value="task"');
    expect(html).toContain("task, current not started, v0");
  });

  it("normalizes a fully symbolic doctype name to the documents counter", () => {
    const html = renderNamingAdmin({ doctypes: [], selectedDoctype: "!!!" });
    expect(html).toContain('value="documents"');
  });

  it("prefers the draft strategy and marks the generated field selection", () => {
    const html = renderNamingAdmin({
      doctypes: [Task],
      selectedDoctype: "Task",
      doctype: Task,
      draftStrategy: { kind: "series", pattern: "T-{sequence:3}", targetField: "serial" }
    });
    expect(html).toContain('value="T-{sequence:3}"');
    expect(html).toContain('<option value="serial" selected>serial</option>');
  });
});
