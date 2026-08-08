import { hydratorRegistry, resetRegistries } from "../../src/adapters/desk/client-src/boot";
import {
  hydrateCompoundFilterBuilders,
  registerCompoundFilterBuilderHydrator
} from "../../src/adapters/desk/client-src/filter-builder";

interface FilterField {
  field: string;
  inputType?: string;
  operators?: Array<{ operator: string; label: string }>;
}

const FIELDS: FilterField[] = [
  {
    field: "status",
    inputType: "text",
    operators: [
      { operator: "eq", label: "Equals" },
      { operator: "in", label: "In" }
    ]
  },
  {
    field: "qty",
    inputType: "number",
    operators: [
      { operator: "eq", label: "Equals" },
      { operator: "gt", label: "Greater than" },
      { operator: "between", label: "Between" }
    ]
  },
  {
    field: "due",
    inputType: "date",
    operators: [{ operator: "eq", label: "Equals" }]
  }
];

function fieldOptionsHtml(): string {
  return (
    `<option value=""></option>` +
    FIELDS.map((field) => `<option value="${field.field}">${field.field}</option>`).join("")
  );
}

function operatorOptionsHtml(): string {
  return [
    { operator: "eq", label: "Equals" },
    { operator: "in", label: "In" },
    { operator: "gt", label: "Greater than" },
    { operator: "between", label: "Between" }
  ]
    .map((option) => `<option value="${option.operator}">${option.label}</option>`)
    .join("");
}

function rowHtml(): string {
  return `<div class="compound-filter-row" data-cf-frappe-filter-row>
    <label class="field compact"><span>Field</span><select data-cf-frappe-filter-field>${fieldOptionsHtml()}</select></label>
    <label class="field compact"><span>Operator</span><select data-cf-frappe-filter-operator>${operatorOptionsHtml()}</select></label>
    <label class="field grow"><span>Value</span><input data-cf-frappe-filter-value type="text" value=""></label>
    <button class="button" type="button" data-cf-frappe-remove-filter>Remove</button>
  </div>`;
}

function groupHtml(root: boolean, inner: string): string {
  return `<div class="compound-filter-group${root ? " compound-filter-root" : ""}" data-cf-frappe-filter-group>
    <div class="compound-filter-group-head">
      <label class="field compact"><span>Match</span><select data-cf-frappe-filter-match><option value="all">All</option><option value="any">Any</option></select></label>
      <div class="compound-filter-group-actions">
        <button class="button" type="button" data-cf-frappe-add-filter>Add condition</button>
        <button class="button" type="button" data-cf-frappe-add-filter-group>Add group</button>
        ${root ? "" : `<button class="button" type="button" data-cf-frappe-remove-filter-group>Remove group</button>`}
      </div>
    </div>
    <div class="compound-filter-items compound-filter-rows" data-cf-frappe-filter-items data-cf-frappe-filter-rows>${inner}</div>
  </div>`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

interface BuilderOptions {
  fieldsJson?: string | null;
  kind?: string;
  visual?: string;
  templates?: boolean;
  rowTemplate?: boolean;
  textarea?: boolean;
  form?: boolean;
}

function installBuilder(options: BuilderOptions = {}): HTMLElement {
  const fieldsJson = options.fieldsJson === undefined ? JSON.stringify(FIELDS) : options.fieldsJson;
  const visual = options.visual ?? groupHtml(true, rowHtml());
  const templates =
    options.templates === false
      ? ""
      : `${options.rowTemplate === false ? "" : `<template data-cf-frappe-filter-row-template>${rowHtml()}</template>`}
         <template data-cf-frappe-filter-group-template>${groupHtml(false, rowHtml())}</template>`;
  const textarea =
    options.textarea === false
      ? ""
      : `<label class="field wide"><span>Advanced JSON</span><textarea name="filter_expression" rows="5"></textarea></label>`;
  const kind = options.kind ? ` data-filter-expression-kind="${options.kind}"` : "";
  const fields = fieldsJson === null ? "" : ` data-filter-fields="${escapeAttribute(fieldsJson)}"`;
  const builderHtml = `<fieldset class="compound-filter-builder" data-cf-frappe-compound-filter-builder${fields}${kind}>
      <legend>Compound filters</legend>
      <div class="compound-filter-visual">${visual}</div>
      ${templates}
      ${textarea}
    </fieldset>`;
  document.body.innerHTML = options.form === false ? builderHtml : `<form>${builderHtml}</form>`;
  return document.querySelector("[data-cf-frappe-compound-filter-builder]") as HTMLElement;
}

type SelectEl = HTMLElement & { value: string; options: HTMLOptionsCollection };

/**
 * The worker tsconfig merges Cloudflare's HTMLRewriter Element into the DOM
 * globals, which poisons direct casts to HTMLSelectElement (it declares its own
 * remove(index): void). Query select controls through a structural type instead.
 */
function qSelect(root: HTMLElement | Document, selector: string): SelectEl {
  return root.querySelector(selector) as unknown as SelectEl;
}

function dispatch(element: HTMLElement | SelectEl, type: string): void {
  (element as unknown as HTMLElement).dispatchEvent(new Event(type, { bubbles: true }));
}

function submit(builder: HTMLElement): string {
  const form = builder.closest("form") as HTMLFormElement;
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  return textareaValue(builder);
}

function textareaValue(builder: HTMLElement): string {
  return (builder.querySelector('[name="filter_expression"]') as HTMLTextAreaElement).value;
}

function row(builder: HTMLElement, index = 0): HTMLElement {
  return builder.querySelectorAll<HTMLElement>("[data-cf-frappe-filter-row]")[index] as HTMLElement;
}

function setRow(target: HTMLElement, field: string, operator: string, value: string): void {
  const fieldSelect = qSelect(target, "[data-cf-frappe-filter-field]");
  fieldSelect.value = field;
  dispatch(fieldSelect, "change");
  const operatorSelect = qSelect(target, "[data-cf-frappe-filter-operator]");
  operatorSelect.value = operator;
  dispatch(operatorSelect, "change");
  const valueInput = target.querySelector("[data-cf-frappe-filter-value]") as HTMLInputElement;
  valueInput.value = value;
  dispatch(valueInput, "input");
}

describe("client-src filter-builder", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("registers a hydrator registration for the boot sequence", () => {
    resetRegistries();
    registerCompoundFilterBuilderHydrator();
    const names = hydratorRegistry.list().map((registration) => registration.name);
    expect(names).toContain("compound-filter-builder");
    expect(hydratorRegistry.list()[0]?.hydrate).toBe(hydrateCompoundFilterBuilders);
  });

  it("does nothing when no builders exist", () => {
    expect(() => hydrateCompoundFilterBuilders()).not.toThrow();
  });

  it("skips builders that are not inside a form", () => {
    const builder = installBuilder({ form: false });
    hydrateCompoundFilterBuilders();
    setRow(row(builder), "status", "eq", "Open");
    expect(
      (builder as HTMLElement & { __cfFrappeCompoundFilterSource?: string }).__cfFrappeCompoundFilterSource
    ).toBeUndefined();
  });

  it("serializes a single visual row without group wrapper or eq operator", () => {
    const builder = installBuilder();
    hydrateCompoundFilterBuilders();
    setRow(row(builder), "status", "eq", " Open ");
    expect(JSON.parse(submit(builder))).toEqual({ field: "status", value: "Open" });
  });

  it("keeps the textarea untouched when the visual tree was never edited", () => {
    const builder = installBuilder();
    hydrateCompoundFilterBuilders();
    const textarea = builder.querySelector('[name="filter_expression"]') as HTMLTextAreaElement;
    textarea.value = "{}";
    expect(submit(builder)).toBe("{}");
  });

  it("prefers hand-edited JSON after textarea input and change events", () => {
    const builder = installBuilder();
    hydrateCompoundFilterBuilders();
    setRow(row(builder), "status", "eq", "Open");
    const textarea = builder.querySelector('[name="filter_expression"]') as HTMLTextAreaElement;
    textarea.value = `{"field":"custom"}`;
    dispatch(textarea, "input");
    expect(submit(builder)).toBe(`{"field":"custom"}`);
    dispatch(textarea, "change");
    expect(submit(builder)).toBe(`{"field":"custom"}`);
  });

  it("splits list operator values on commas and keeps the operator", () => {
    const builder = installBuilder();
    hydrateCompoundFilterBuilders();
    setRow(row(builder), "status", "in", " Open , Closed ,, ");
    expect(JSON.parse(submit(builder))).toEqual({
      field: "status",
      value: ["Open", "Closed"],
      operator: "in"
    });
  });

  it("emits an empty expression when no row is complete", () => {
    const builder = installBuilder();
    hydrateCompoundFilterBuilders();
    const first = row(builder);
    setRow(first, "status", "eq", "Open");
    setRow(first, "", "eq", "Open");
    expect(submit(builder)).toBe("");
    setRow(first, "status", "eq", "");
    expect(submit(builder)).toBe("");
  });

  it("wraps multiple rows in a group honoring the match selector", () => {
    const builder = installBuilder();
    hydrateCompoundFilterBuilders();
    setRow(row(builder), "status", "eq", "Open");
    const addButton = builder.querySelector("[data-cf-frappe-add-filter]") as HTMLButtonElement;
    addButton.click();
    setRow(row(builder, 1), "qty", "gt", "5");
    const match = qSelect(builder, "[data-cf-frappe-filter-match]");
    match.value = "any";
    dispatch(match, "change");
    expect(JSON.parse(submit(builder))).toEqual({
      kind: "group",
      match: "any",
      filters: [
        { field: "status", value: "Open" },
        { field: "qty", value: "5", operator: "gt" }
      ]
    });
  });

  it("adds nested groups from the template and serializes them recursively", () => {
    const builder = installBuilder();
    hydrateCompoundFilterBuilders();
    setRow(row(builder), "status", "eq", "Open");
    (builder.querySelector("[data-cf-frappe-add-filter-group]") as HTMLButtonElement).click();
    const nested = builder.querySelectorAll<HTMLElement>("[data-cf-frappe-filter-group]")[1] as HTMLElement;
    const nestedMatch = qSelect(nested, "[data-cf-frappe-filter-match]");
    expect(nestedMatch.value).toBe("all");
    nestedMatch.value = "any";
    dispatch(nestedMatch, "change");
    setRow(nested.querySelector("[data-cf-frappe-filter-row]") as HTMLElement, "qty", "gt", "3");
    (nested.querySelector("[data-cf-frappe-add-filter]") as HTMLButtonElement).click();
    setRow(nested.querySelectorAll<HTMLElement>("[data-cf-frappe-filter-row]")[1] as HTMLElement, "due", "eq", "2026-08-09");
    expect(JSON.parse(submit(builder))).toEqual({
      kind: "group",
      match: "all",
      filters: [
        { field: "status", value: "Open" },
        {
          kind: "group",
          match: "any",
          filters: [
            { field: "qty", value: "3", operator: "gt" },
            { field: "due", value: "2026-08-09" }
          ]
        }
      ]
    });
  });

  it("resets the last row on remove instead of deleting it", () => {
    const builder = installBuilder();
    hydrateCompoundFilterBuilders();
    const only = row(builder);
    setRow(only, "qty", "gt", "5");
    (only.querySelector("[data-cf-frappe-remove-filter]") as HTMLButtonElement).click();
    expect(builder.querySelectorAll("[data-cf-frappe-filter-row]")).toHaveLength(1);
    expect((only.querySelector("[data-cf-frappe-filter-value]") as HTMLInputElement).value).toBe("");
    expect((qSelect(only, "[data-cf-frappe-filter-operator]")).value).toBe("eq");
    expect(submit(builder)).toBe("");
  });

  it("removes extra rows when more than one exists", () => {
    const builder = installBuilder();
    hydrateCompoundFilterBuilders();
    (builder.querySelector("[data-cf-frappe-add-filter]") as HTMLButtonElement).click();
    expect(builder.querySelectorAll("[data-cf-frappe-filter-row]")).toHaveLength(2);
    const second = row(builder, 1);
    (second.querySelector("[data-cf-frappe-remove-filter]") as HTMLButtonElement).click();
    expect(builder.querySelectorAll("[data-cf-frappe-filter-row]")).toHaveLength(1);
  });

  it("never removes the root group", () => {
    const builder = installBuilder({
      visual: groupHtml(true, rowHtml()).replace(
        `<button class="button" type="button" data-cf-frappe-add-filter-group>Add group</button>`,
        `<button class="button" type="button" data-cf-frappe-add-filter-group>Add group</button><button class="button" type="button" data-cf-frappe-remove-filter-group>Remove root</button>`
      )
    });
    hydrateCompoundFilterBuilders();
    (builder.querySelector("[data-cf-frappe-remove-filter-group]") as HTMLButtonElement).click();
    expect(builder.querySelectorAll("[data-cf-frappe-filter-group]")).toHaveLength(1);
  });

  it("removes nested groups and refills an emptied parent container with a row", () => {
    const builder = installBuilder({ visual: groupHtml(true, groupHtml(false, rowHtml())) });
    hydrateCompoundFilterBuilders();
    const nested = builder.querySelectorAll<HTMLElement>("[data-cf-frappe-filter-group]")[1] as HTMLElement;
    (nested.querySelector("[data-cf-frappe-remove-filter-group]") as HTMLButtonElement).click();
    const groups = builder.querySelectorAll("[data-cf-frappe-filter-group]");
    expect(groups).toHaveLength(1);
    const replacement = builder.querySelector("[data-cf-frappe-filter-row]") as HTMLElement;
    expect(replacement).not.toBeNull();
    setRow(replacement, "status", "eq", "Open");
    expect(JSON.parse(submit(builder))).toEqual({ field: "status", value: "Open" });
  });

  it("keeps sibling rows when a nested group is removed", () => {
    const builder = installBuilder({ visual: groupHtml(true, rowHtml() + groupHtml(false, rowHtml())) });
    hydrateCompoundFilterBuilders();
    const nested = builder.querySelectorAll<HTMLElement>("[data-cf-frappe-filter-group]")[1] as HTMLElement;
    (nested.querySelector("[data-cf-frappe-remove-filter-group]") as HTMLButtonElement).click();
    expect(builder.querySelectorAll("[data-cf-frappe-filter-group]")).toHaveLength(1);
    expect(builder.querySelectorAll("[data-cf-frappe-filter-row]")).toHaveLength(1);
  });

  it("ignores template-driven actions when templates are missing", () => {
    const builder = installBuilder({ templates: false });
    hydrateCompoundFilterBuilders();
    (builder.querySelector("[data-cf-frappe-add-filter]") as HTMLButtonElement).click();
    (builder.querySelector("[data-cf-frappe-add-filter-group]") as HTMLButtonElement).click();
    expect(builder.querySelectorAll("[data-cf-frappe-filter-row]")).toHaveLength(1);
    expect(builder.querySelectorAll("[data-cf-frappe-filter-group]")).toHaveLength(1);
  });

  it("tolerates a missing textarea on submit", () => {
    const builder = installBuilder({ textarea: false });
    hydrateCompoundFilterBuilders();
    setRow(row(builder), "status", "eq", "Open");
    const form = builder.closest("form") as HTMLFormElement;
    expect(() =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    ).not.toThrow();
  });

  it("refreshes operator options for the selected field and preserves the selection", () => {
    const builder = installBuilder();
    hydrateCompoundFilterBuilders();
    const target = row(builder);
    const operatorSelect = qSelect(target, "[data-cf-frappe-filter-operator]");
    const fieldSelect = qSelect(target, "[data-cf-frappe-filter-field]");
    fieldSelect.value = "qty";
    dispatch(fieldSelect, "change");
    expect(Array.from(operatorSelect.options).map((option) => option.value)).toEqual([
      "eq",
      "gt",
      "between"
    ]);
    operatorSelect.value = "gt";
    dispatch(operatorSelect, "change");
    fieldSelect.value = "status";
    dispatch(fieldSelect, "change");
    expect(Array.from(operatorSelect.options).map((option) => option.value)).toEqual(["eq", "in"]);
    expect(operatorSelect.value).toBe("eq");
  });

  it("falls back to the union of operators for unknown fields", () => {
    const builder = installBuilder();
    hydrateCompoundFilterBuilders();
    const target = row(builder);
    const fieldSelect = qSelect(target, "[data-cf-frappe-filter-field]");
    fieldSelect.value = "";
    dispatch(fieldSelect, "change");
    const operatorSelect = qSelect(target, "[data-cf-frappe-filter-operator]");
    expect(Array.from(operatorSelect.options).map((option) => option.value)).toEqual([
      "eq",
      "in",
      "gt",
      "between"
    ]);
  });

  it("switches the value input type to the field metadata input type", () => {
    const builder = installBuilder();
    hydrateCompoundFilterBuilders();
    const target = row(builder);
    const valueInput = target.querySelector("[data-cf-frappe-filter-value]") as HTMLInputElement;
    const fieldSelect = qSelect(target, "[data-cf-frappe-filter-field]");
    fieldSelect.value = "qty";
    dispatch(fieldSelect, "change");
    expect(valueInput.type).toBe("number");
    fieldSelect.value = "due";
    dispatch(fieldSelect, "change");
    expect(valueInput.type).toBe("date");
    const operatorSelect = qSelect(target, "[data-cf-frappe-filter-operator]");
    operatorSelect.value = "eq";
    fieldSelect.value = "qty";
    dispatch(fieldSelect, "change");
    operatorSelect.value = "between";
    dispatch(operatorSelect, "change");
    expect(valueInput.type).toBe("text");
    fieldSelect.value = "status";
    dispatch(fieldSelect, "change");
    expect(valueInput.type).toBe("text");
  });

  it("treats invalid data-filter-fields JSON as an empty metadata list", () => {
    const builder = installBuilder({ fieldsJson: "{not json" });
    hydrateCompoundFilterBuilders();
    const target = row(builder);
    const fieldSelect = qSelect(target, "[data-cf-frappe-filter-field]");
    fieldSelect.value = "status";
    dispatch(fieldSelect, "change");
    const operatorSelect = qSelect(target, "[data-cf-frappe-filter-operator]");
    expect(operatorSelect.options).toHaveLength(0);
    const valueInput = target.querySelector("[data-cf-frappe-filter-value]") as HTMLInputElement;
    expect(valueInput.type).toBe("text");
  });

  it("supports metadata entries without operators arrays", () => {
    const builder = installBuilder({
      fieldsJson: JSON.stringify([{ field: "status" }, ...FIELDS.slice(1)])
    });
    hydrateCompoundFilterBuilders();
    const target = row(builder);
    const fieldSelect = qSelect(target, "[data-cf-frappe-filter-field]");
    fieldSelect.value = "qty";
    dispatch(fieldSelect, "change");
    const operatorSelect = qSelect(target, "[data-cf-frappe-filter-operator]");
    expect(Array.from(operatorSelect.options).map((option) => option.value)).toEqual([
      "eq",
      "gt",
      "between"
    ]);
  });

  it("serializes report-kind builders as {filter, value} conditions", () => {
    const builder = installBuilder({ kind: "report" });
    hydrateCompoundFilterBuilders();
    setRow(row(builder), "status", "gt", "Open");
    expect(JSON.parse(submit(builder))).toEqual({ filter: "status", value: "Open" });
  });

  it("hydrates flat builders without a root group", () => {
    const builder = installBuilder({ visual: rowHtml() + rowHtml() });
    hydrateCompoundFilterBuilders();
    setRow(row(builder), "status", "eq", "Open");
    setRow(row(builder, 1), "qty", "gt", "2");
    expect(JSON.parse(submit(builder))).toEqual({
      kind: "group",
      match: "all",
      filters: [
        { field: "status", value: "Open" },
        { field: "qty", value: "2", operator: "gt" }
      ]
    });
  });

  it("unwraps a single filter in flat builders and empties when none", () => {
    const builder = installBuilder({ visual: rowHtml() });
    hydrateCompoundFilterBuilders();
    setRow(row(builder), "status", "eq", "Open");
    expect(JSON.parse(submit(builder))).toEqual({ field: "status", value: "Open" });
    setRow(row(builder), "status", "eq", "");
    expect(submit(builder)).toBe("");
  });

  it("ignores stray non-row non-group children inside the items container", () => {
    const builder = installBuilder({ visual: groupHtml(true, `<div class="stray"></div>${rowHtml()}`) });
    hydrateCompoundFilterBuilders();
    setRow(row(builder), "status", "eq", "Open");
    expect(JSON.parse(submit(builder))).toEqual({ field: "status", value: "Open" });
  });

  it("hydrates each builder only once", () => {
    const builder = installBuilder();
    hydrateCompoundFilterBuilders();
    hydrateCompoundFilterBuilders();
    (builder.querySelector("[data-cf-frappe-add-filter]") as HTMLButtonElement).click();
    expect(builder.querySelectorAll("[data-cf-frappe-filter-row]")).toHaveLength(2);
  });

  it("hydrates deeply nested groups once and serializes them", () => {
    const builder = installBuilder({
      visual: groupHtml(true, rowHtml() + groupHtml(false, groupHtml(false, rowHtml())))
    });
    hydrateCompoundFilterBuilders();
    const rows = builder.querySelectorAll<HTMLElement>("[data-cf-frappe-filter-row]");
    setRow(rows[0] as HTMLElement, "status", "eq", "Open");
    setRow(rows[1] as HTMLElement, "qty", "gt", "1");
    expect(JSON.parse(submit(builder))).toEqual({
      kind: "group",
      match: "all",
      filters: [
        { field: "status", value: "Open" },
        {
          kind: "group",
          match: "all",
          filters: [
            {
              kind: "group",
              match: "all",
              filters: [{ field: "qty", value: "1", operator: "gt" }]
            }
          ]
        }
      ]
    });
    const grandchild = builder.querySelectorAll<HTMLElement>("[data-cf-frappe-filter-group]")[2] as HTMLElement;
    (grandchild.querySelector("[data-cf-frappe-add-filter]") as HTMLButtonElement).click();
    expect(grandchild.querySelectorAll("[data-cf-frappe-filter-row]")).toHaveLength(2);
  });

  it("tolerates groups and rows without optional controls", () => {
    const builder = installBuilder({
      visual: `<div data-cf-frappe-filter-group><div data-cf-frappe-filter-items><div data-cf-frappe-filter-row><input data-cf-frappe-filter-value value="x"></div></div></div>`
    });
    expect(() => hydrateCompoundFilterBuilders()).not.toThrow();
    const valueInput = builder.querySelector("[data-cf-frappe-filter-value]") as HTMLInputElement;
    dispatch(valueInput, "input");
    expect(submit(builder)).toBe("");
  });

  it("serializes rows without an operator select using the eq default", () => {
    const builder = installBuilder({
      visual: `<div data-cf-frappe-filter-group><div data-cf-frappe-filter-items><div data-cf-frappe-filter-row><select data-cf-frappe-filter-field>${fieldOptionsHtml()}</select><input data-cf-frappe-filter-value value=""></div></div></div>`
    });
    hydrateCompoundFilterBuilders();
    const target = row(builder);
    const fieldSelect = qSelect(target, "[data-cf-frappe-filter-field]");
    fieldSelect.value = "qty";
    dispatch(fieldSelect, "change");
    const valueInput = target.querySelector("[data-cf-frappe-filter-value]") as HTMLInputElement;
    expect(valueInput.type).toBe("number");
    valueInput.value = "5";
    dispatch(valueInput, "input");
    expect(JSON.parse(submit(builder))).toEqual({ field: "qty", value: "5" });
  });

  it("tolerates rows without a value input", () => {
    const builder = installBuilder({
      visual: `<div data-cf-frappe-filter-group><div data-cf-frappe-filter-items><div data-cf-frappe-filter-row><select data-cf-frappe-filter-field>${fieldOptionsHtml()}</select><select data-cf-frappe-filter-operator>${operatorOptionsHtml()}</select></div></div></div>`
    });
    hydrateCompoundFilterBuilders();
    const target = row(builder);
    const fieldSelect = qSelect(target, "[data-cf-frappe-filter-field]");
    fieldSelect.value = "status";
    dispatch(fieldSelect, "change");
    expect(submit(builder)).toBe("");
  });

  it("appends the group template unreset when the row template is missing", () => {
    const builder = installBuilder({ rowTemplate: false });
    hydrateCompoundFilterBuilders();
    (builder.querySelector("[data-cf-frappe-add-filter]") as HTMLButtonElement).click();
    expect(builder.querySelectorAll("[data-cf-frappe-filter-row]")).toHaveLength(1);
    (builder.querySelector("[data-cf-frappe-add-filter-group]") as HTMLButtonElement).click();
    const groups = builder.querySelectorAll<HTMLElement>("[data-cf-frappe-filter-group]");
    expect(groups).toHaveLength(2);
    const nested = groups[1] as HTMLElement;
    (nested.querySelector("[data-cf-frappe-remove-filter-group]") as HTMLButtonElement).click();
    expect(builder.querySelectorAll("[data-cf-frappe-filter-group]")).toHaveLength(1);
    expect(builder.querySelectorAll("[data-cf-frappe-filter-row]")).toHaveLength(1);
  });

  it("leaves an emptied parent container empty when the row template is missing", () => {
    const builder = installBuilder({
      rowTemplate: false,
      visual: groupHtml(true, groupHtml(false, rowHtml()))
    });
    hydrateCompoundFilterBuilders();
    const nested = builder.querySelectorAll<HTMLElement>("[data-cf-frappe-filter-group]")[1] as HTMLElement;
    (nested.querySelector("[data-cf-frappe-remove-filter-group]") as HTMLButtonElement).click();
    expect(builder.querySelectorAll("[data-cf-frappe-filter-group]")).toHaveLength(1);
    expect(builder.querySelectorAll("[data-cf-frappe-filter-row]")).toHaveLength(0);
  });

  it("supports containers marked only with data-cf-frappe-filter-rows", () => {
    const builder = installBuilder({
      visual: `<div data-cf-frappe-filter-group>
        <select data-cf-frappe-filter-match><option value="all">All</option><option value="any">Any</option></select>
        <button type="button" data-cf-frappe-add-filter>Add</button>
        <div data-cf-frappe-filter-rows>${rowHtml()}</div>
      </div>`
    });
    hydrateCompoundFilterBuilders();
    (builder.querySelector("[data-cf-frappe-add-filter]") as HTMLButtonElement).click();
    expect(builder.querySelectorAll("[data-cf-frappe-filter-row]")).toHaveLength(2);
    setRow(row(builder), "status", "eq", "Open");
    expect(JSON.parse(submit(builder))).toEqual({ field: "status", value: "Open" });
  });

  it("uses the builder-level match selector for flat builders", () => {
    const builder = installBuilder({
      visual: `<select data-cf-frappe-filter-match><option value="all">All</option><option value="any" selected>Any</option></select>${rowHtml()}${rowHtml()}`
    });
    hydrateCompoundFilterBuilders();
    setRow(row(builder), "status", "eq", "Open");
    setRow(row(builder, 1), "qty", "gt", "2");
    expect(JSON.parse(submit(builder))).toEqual({
      kind: "group",
      match: "any",
      filters: [
        { field: "status", value: "Open" },
        { field: "qty", value: "2", operator: "gt" }
      ]
    });
  });

  it("resets flat rows outside any group on remove", () => {
    const builder = installBuilder({ visual: rowHtml() });
    hydrateCompoundFilterBuilders();
    const only = row(builder);
    setRow(only, "status", "eq", "Open");
    (only.querySelector("[data-cf-frappe-remove-filter]") as HTMLButtonElement).click();
    expect(builder.querySelectorAll("[data-cf-frappe-filter-row]")).toHaveLength(1);
    expect((only.querySelector("[data-cf-frappe-filter-value]") as HTMLInputElement).value).toBe("");
    expect(submit(builder)).toBe("");
  });

  it("defaults to empty metadata when data-filter-fields is absent", () => {
    const builder = installBuilder({ fieldsJson: null });
    hydrateCompoundFilterBuilders();
    const target = row(builder);
    const fieldSelect = qSelect(target, "[data-cf-frappe-filter-field]");
    fieldSelect.value = "status";
    dispatch(fieldSelect, "change");
    expect((qSelect(target, "[data-cf-frappe-filter-operator]")).options).toHaveLength(0);
  });

  it("skips null metadata entries when unioning operators", () => {
    const builder = installBuilder({
      fieldsJson: JSON.stringify([null, { field: "plain" }, FIELDS[0]])
    });
    hydrateCompoundFilterBuilders();
    const target = row(builder);
    const fieldSelect = qSelect(target, "[data-cf-frappe-filter-field]");
    fieldSelect.value = "";
    dispatch(fieldSelect, "change");
    const operatorSelect = qSelect(target, "[data-cf-frappe-filter-operator]");
    expect(Array.from(operatorSelect.options).map((option) => option.value)).toEqual(["eq", "in"]);
  });
});
