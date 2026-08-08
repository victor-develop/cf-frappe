/**
 * Compound filter builder hydration (list views + report builder filter expressions).
 *
 * Ports the legacy `hydrateCompoundFilterBuilders` slice of the string client:
 * visual rows/groups are kept in sync with the `filter_expression` JSON textarea,
 * operator options and value input types follow the selected field's metadata
 * (parsed from `data-filter-fields`), and dirty tracking decides on submit whether
 * the visual tree overwrites the JSON text (`visual`) or the hand-edited JSON wins
 * (`text`).
 */

import { registerHydrator } from "./boot.js";

export interface CompoundFilterOperatorOption {
  readonly operator: string;
  readonly label: string;
}

export interface CompoundFilterFieldMetadata {
  readonly field?: string;
  readonly inputType?: string;
  readonly operators?: readonly CompoundFilterOperatorOption[];
}

export interface CompoundFilterCondition {
  field: string;
  value: string | string[];
  operator?: string;
}

export interface ReportFilterCondition {
  filter: string;
  value: string;
}

export interface CompoundFilterGroupExpression {
  kind: "group";
  match: "all" | "any";
  filters: CompoundFilterExpression[];
}

export type CompoundFilterExpression =
  | CompoundFilterCondition
  | ReportFilterCondition
  | CompoundFilterGroupExpression;

type CompoundFilterSource = "text" | "visual";

interface CompoundFilterBuilderElement extends HTMLElement {
  __cfFrappeCompoundFilterHydrated?: boolean;
  __cfFrappeCompoundFilterSource?: CompoundFilterSource;
  __cfFrappeFilterFields?: CompoundFilterFieldMetadata[];
}

interface CompoundFilterGroupElement extends HTMLElement {
  __cfFrappeCompoundFilterGroupHydrated?: boolean;
}

interface CompoundFilterRowElement extends HTMLElement {
  __cfFrappeCompoundFilterRowHydrated?: boolean;
}

/**
 * Structural view of value-bearing form controls. `HTMLSelectElement` cannot be
 * referenced nominally here: the worker `tsconfig.json` merges Cloudflare's
 * HTMLRewriter `Element` into the DOM globals, which makes `HTMLSelectElement`
 * (with its own `remove(index): void`) incompatible with the merged `Element`.
 */
interface ValueControl {
  value: string;
}

function asValueControl(element: Element | null): ValueControl | null {
  return element as unknown as ValueControl | null;
}

export function hydrateCompoundFilterBuilders(): void {
  const builders = document.querySelectorAll<CompoundFilterBuilderElement>(
    "[data-cf-frappe-compound-filter-builder]"
  );
  builders.forEach((builder) => {
    hydrateCompoundFilterBuilder(builder);
  });
}

function hydrateCompoundFilterBuilder(builder: CompoundFilterBuilderElement): void {
  const form = builder.closest("form");
  if (!form || builder.__cfFrappeCompoundFilterHydrated) {
    return;
  }
  builder.__cfFrappeCompoundFilterHydrated = true;
  const expression = builder.querySelector('[name="filter_expression"]');
  if (expression) {
    expression.addEventListener("input", () => {
      builder.__cfFrappeCompoundFilterSource = "text";
    });
    expression.addEventListener("change", () => {
      builder.__cfFrappeCompoundFilterSource = "text";
    });
  }
  const root = builder.querySelector<CompoundFilterGroupElement>("[data-cf-frappe-filter-group]");
  if (root) {
    hydrateCompoundFilterGroup(builder, root);
  } else {
    builder.querySelectorAll<CompoundFilterRowElement>("[data-cf-frappe-filter-row]").forEach((row) => {
      hydrateCompoundFilterRow(builder, row);
    });
  }
  form.addEventListener("submit", () => {
    syncCompoundFilterExpression(builder);
  });
}

function hydrateCompoundFilterGroup(
  builder: CompoundFilterBuilderElement,
  group: CompoundFilterGroupElement
): void {
  if (group.__cfFrappeCompoundFilterGroupHydrated) {
    return;
  }
  group.__cfFrappeCompoundFilterGroupHydrated = true;
  const match = group.querySelector("[data-cf-frappe-filter-match]");
  if (match) {
    match.addEventListener("change", () => {
      markCompoundFilterVisualDirty(builder);
    });
  }
  const addButton = group.querySelector("[data-cf-frappe-add-filter]");
  if (addButton) {
    addButton.addEventListener("click", () => {
      addCompoundFilterRow(builder, group);
    });
  }
  const addGroupButton = group.querySelector("[data-cf-frappe-add-filter-group]");
  if (addGroupButton) {
    addGroupButton.addEventListener("click", () => {
      addCompoundFilterGroup(builder, group);
    });
  }
  const removeGroupButton = group.querySelector("[data-cf-frappe-remove-filter-group]");
  if (removeGroupButton) {
    removeGroupButton.addEventListener("click", () => {
      markCompoundFilterVisualDirty(builder);
      removeCompoundFilterGroup(builder, group);
    });
  }
  group.querySelectorAll<CompoundFilterRowElement>("[data-cf-frappe-filter-row]").forEach((row) => {
    hydrateCompoundFilterRow(builder, row);
  });
  group
    .querySelectorAll<CompoundFilterGroupElement>("[data-cf-frappe-filter-group]")
    .forEach((childGroup) => {
      hydrateCompoundFilterGroup(builder, childGroup);
    });
}

function hydrateCompoundFilterRow(
  builder: CompoundFilterBuilderElement,
  row: CompoundFilterRowElement
): void {
  if (row.__cfFrappeCompoundFilterRowHydrated) {
    return;
  }
  row.__cfFrappeCompoundFilterRowHydrated = true;
  const field = row.querySelector("[data-cf-frappe-filter-field]");
  const operator = row.querySelector("[data-cf-frappe-filter-operator]");
  const remove = row.querySelector("[data-cf-frappe-remove-filter]");
  if (field) {
    field.addEventListener("change", () => {
      markCompoundFilterVisualDirty(builder);
      refreshCompoundFilterOperatorOptions(builder, row);
      refreshCompoundFilterValueInputType(builder, row);
    });
  }
  if (operator) {
    operator.addEventListener("change", () => {
      markCompoundFilterVisualDirty(builder);
      refreshCompoundFilterValueInputType(builder, row);
    });
  }
  row.querySelectorAll("select, input").forEach((control) => {
    control.addEventListener("input", () => {
      markCompoundFilterVisualDirty(builder);
    });
    control.addEventListener("change", () => {
      markCompoundFilterVisualDirty(builder);
    });
  });
  if (remove) {
    remove.addEventListener("click", () => {
      markCompoundFilterVisualDirty(builder);
      removeCompoundFilterRow(builder, row);
    });
  }
}

function markCompoundFilterVisualDirty(builder: CompoundFilterBuilderElement): void {
  builder.__cfFrappeCompoundFilterSource = "visual";
}

function addCompoundFilterRow(
  builder: CompoundFilterBuilderElement,
  group: CompoundFilterGroupElement
): void {
  const container = compoundFilterItemsContainer(group);
  const row = cloneCompoundFilterTemplate(builder, "[data-cf-frappe-filter-row-template]");
  if (!container || !row) {
    return;
  }
  resetCompoundFilterRow(row);
  container.appendChild(row);
  refreshCompoundFilterOperatorOptions(builder, row);
  refreshCompoundFilterValueInputType(builder, row);
  markCompoundFilterVisualDirty(builder);
  hydrateCompoundFilterRow(builder, row as CompoundFilterRowElement);
}

function addCompoundFilterGroup(
  builder: CompoundFilterBuilderElement,
  group: CompoundFilterGroupElement
): void {
  const container = compoundFilterItemsContainer(group);
  const childGroup = cloneCompoundFilterTemplate(builder, "[data-cf-frappe-filter-group-template]");
  if (!container || !childGroup) {
    return;
  }
  resetCompoundFilterGroup(builder, childGroup);
  container.appendChild(childGroup);
  markCompoundFilterVisualDirty(builder);
  hydrateCompoundFilterGroup(builder, childGroup as CompoundFilterGroupElement);
}

function cloneCompoundFilterTemplate(
  builder: CompoundFilterBuilderElement,
  selector: string
): HTMLElement | null {
  const template = builder.querySelector<HTMLTemplateElement>(selector);
  const content = template && template.content;
  const element = content && content.firstElementChild;
  if (!element) {
    return null;
  }
  return element.cloneNode(true) as HTMLElement;
}

function resetCompoundFilterGroup(builder: CompoundFilterBuilderElement, group: HTMLElement): void {
  const match = asValueControl(group.querySelector("[data-cf-frappe-filter-match]"));
  if (match) {
    match.value = "all";
  }
  const container = compoundFilterItemsContainer(group);
  const row = cloneCompoundFilterTemplate(builder, "[data-cf-frappe-filter-row-template]");
  if (!container || !row) {
    return;
  }
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  resetCompoundFilterRow(row);
  container.appendChild(row);
}

function resetCompoundFilterRow(row: HTMLElement): void {
  row.querySelectorAll("select, input").forEach((control) => {
    (control as unknown as ValueControl).value = "";
  });
  const operator = asValueControl(row.querySelector("[data-cf-frappe-filter-operator]"));
  if (operator) {
    operator.value = "eq";
  }
}

function removeCompoundFilterRow(builder: CompoundFilterBuilderElement, row: HTMLElement): void {
  const group = compoundFilterClosestGroup(row);
  const container = compoundFilterItemsContainer(group);
  if (compoundFilterContainerChildren(container).length <= 1) {
    resetCompoundFilterRow(row);
    refreshCompoundFilterOperatorOptions(builder, row);
    refreshCompoundFilterValueInputType(builder, row);
    return;
  }
  row.remove();
}

function removeCompoundFilterGroup(
  builder: CompoundFilterBuilderElement,
  group: CompoundFilterGroupElement
): void {
  if (group === builder.querySelector("[data-cf-frappe-filter-group]")) {
    return;
  }
  const parent = compoundFilterParentGroup(group);
  group.remove();
  ensureCompoundFilterGroupHasItem(builder, parent);
}

function ensureCompoundFilterGroupHasItem(
  builder: CompoundFilterBuilderElement,
  group: HTMLElement | null
): void {
  const container = compoundFilterItemsContainer(group);
  if (!container || compoundFilterContainerChildren(container).length > 0) {
    return;
  }
  const row = cloneCompoundFilterTemplate(builder, "[data-cf-frappe-filter-row-template]");
  if (!row) {
    return;
  }
  resetCompoundFilterRow(row);
  container.appendChild(row);
  hydrateCompoundFilterRow(builder, row as CompoundFilterRowElement);
}

function syncCompoundFilterExpression(builder: CompoundFilterBuilderElement): void {
  const target = builder.querySelector<HTMLTextAreaElement>('[name="filter_expression"]');
  if (!target) {
    return;
  }
  if (builder.__cfFrappeCompoundFilterSource === "visual") {
    const expression = compoundFilterExpressionFromBuilder(builder);
    target.value = expression ? JSON.stringify(expression) : "";
  }
}

function compoundFilterExpressionFromBuilder(
  builder: CompoundFilterBuilderElement
): CompoundFilterExpression | undefined {
  const root = builder.querySelector<HTMLElement>("[data-cf-frappe-filter-group]");
  if (root) {
    return compoundFilterExpressionFromGroup(builder, root, true);
  }
  const filters: CompoundFilterExpression[] = [];
  builder.querySelectorAll<HTMLElement>("[data-cf-frappe-filter-row]").forEach((row) => {
    const filter = compoundFilterExpressionFromRow(builder, row);
    if (filter) {
      filters.push(filter);
    }
  });
  if (filters.length === 0) {
    return undefined;
  }
  if (filters.length === 1) {
    return filters[0];
  }
  const match =
    controlValue(builder.querySelector("[data-cf-frappe-filter-match]")) === "any" ? "any" : "all";
  return {
    kind: "group",
    match,
    filters
  };
}

function compoundFilterExpressionFromGroup(
  builder: CompoundFilterBuilderElement,
  group: HTMLElement,
  root: boolean
): CompoundFilterExpression | undefined {
  const filters: CompoundFilterExpression[] = [];
  const container = compoundFilterItemsContainer(group);
  compoundFilterContainerChildren(container).forEach((item) => {
    let filter: CompoundFilterExpression | undefined = undefined;
    if (item.matches("[data-cf-frappe-filter-row]")) {
      filter = compoundFilterExpressionFromRow(builder, item);
    } else if (item.matches("[data-cf-frappe-filter-group]")) {
      filter = compoundFilterExpressionFromGroup(builder, item, false);
    }
    if (filter) {
      filters.push(filter);
    }
  });
  if (filters.length === 0) {
    return undefined;
  }
  if (root && filters.length === 1) {
    return filters[0];
  }
  const match =
    controlValue(group.querySelector("[data-cf-frappe-filter-match]")) === "any" ? "any" : "all";
  return {
    kind: "group",
    match,
    filters
  };
}

function compoundFilterItemsContainer(group: HTMLElement | null): HTMLElement | null {
  return group
    ? group.querySelector<HTMLElement>("[data-cf-frappe-filter-items]") ||
        group.querySelector<HTMLElement>("[data-cf-frappe-filter-rows]")
    : null;
}

function compoundFilterContainerChildren(container: HTMLElement | null): HTMLElement[] {
  return container ? (Array.prototype.slice.call(container.children) as HTMLElement[]) : [];
}

function compoundFilterClosestGroup(element: HTMLElement): HTMLElement | null {
  return element.closest("[data-cf-frappe-filter-group]");
}

function compoundFilterParentGroup(group: HTMLElement): HTMLElement | null {
  const parent = group.parentElement;
  return parent ? parent.closest("[data-cf-frappe-filter-group]") : null;
}

function compoundFilterExpressionFromRow(
  builder: CompoundFilterBuilderElement,
  row: HTMLElement
): CompoundFilterExpression | undefined {
  const field = controlValue(row.querySelector("[data-cf-frappe-filter-field]"));
  const value = controlValue(row.querySelector("[data-cf-frappe-filter-value]"));
  if (!field || value === "") {
    return undefined;
  }
  if (compoundFilterExpressionKind(builder) === "report") {
    return {
      filter: field,
      value
    };
  }
  const operator = controlValue(row.querySelector("[data-cf-frappe-filter-operator]")) || "eq";
  return Object.assign(
    {
      field,
      value: compoundFilterValue(value, operator)
    },
    operator === "eq" ? {} : { operator }
  );
}

function compoundFilterValue(value: string, operator: string): string | string[] {
  if (operator === "in" || operator === "not_in" || operator === "between" || operator === "not_between") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  }
  return value;
}

function refreshCompoundFilterOperatorOptions(
  builder: CompoundFilterBuilderElement,
  row: HTMLElement
): void {
  const field = controlValue(row.querySelector("[data-cf-frappe-filter-field]"));
  const operator = row.querySelector("[data-cf-frappe-filter-operator]") as unknown as
    | (HTMLElement & ValueControl)
    | null;
  if (!operator) {
    return;
  }
  const options = compoundFilterFieldOptions(builder, field);
  const selected = operator.value;
  while (operator.firstChild) {
    operator.removeChild(operator.firstChild);
  }
  options.forEach((option) => {
    const element = document.createElement("option");
    element.value = option.operator;
    element.textContent = option.label;
    if (option.operator === selected) {
      element.selected = true;
    }
    operator.appendChild(element);
  });
  const first = options[0];
  if (!options.some((option) => option.operator === operator.value) && first) {
    operator.value = first.operator;
  }
}

function refreshCompoundFilterValueInputType(
  builder: CompoundFilterBuilderElement,
  row: HTMLElement
): void {
  const value = row.querySelector<HTMLInputElement>("[data-cf-frappe-filter-value]");
  if (!value) {
    return;
  }
  value.type = compoundFilterValueInputType(builder, row);
}

function compoundFilterValueInputType(
  builder: CompoundFilterBuilderElement,
  row: HTMLElement
): string {
  const operator = controlValue(row.querySelector("[data-cf-frappe-filter-operator]")) || "eq";
  if (operator === "in" || operator === "not_in" || operator === "between" || operator === "not_between") {
    return "text";
  }
  const field = controlValue(row.querySelector("[data-cf-frappe-filter-field]"));
  const metadata = compoundFilterMetadata(builder).filter((item) => item && item.field === field)[0];
  const inputType = metadata && metadata.inputType;
  return inputType === "number" || inputType === "date" || inputType === "datetime-local"
    ? inputType
    : "text";
}

function compoundFilterFieldOptions(
  builder: CompoundFilterBuilderElement,
  field: string
): CompoundFilterOperatorOption[] {
  const metadata = compoundFilterMetadata(builder);
  const selected = metadata.filter((item) => item && item.field === field)[0];
  if (selected && Array.isArray(selected.operators)) {
    return selected.operators.slice();
  }
  return metadata.reduce<CompoundFilterOperatorOption[]>((operators, item) => {
    (item && Array.isArray(item.operators) ? item.operators : []).forEach((operator) => {
      if (!operators.some((existing) => existing.operator === operator.operator)) {
        operators.push(operator);
      }
    });
    return operators;
  }, []);
}

function compoundFilterMetadata(builder: CompoundFilterBuilderElement): CompoundFilterFieldMetadata[] {
  if (builder.__cfFrappeFilterFields) {
    return builder.__cfFrappeFilterFields;
  }
  try {
    builder.__cfFrappeFilterFields = JSON.parse(
      (builder.dataset && builder.dataset.filterFields) || "[]"
    ) as CompoundFilterFieldMetadata[];
  } catch (_error) {
    builder.__cfFrappeFilterFields = [];
  }
  return builder.__cfFrappeFilterFields;
}

function compoundFilterExpressionKind(builder: CompoundFilterBuilderElement): "report" | "list" {
  return builder.dataset && builder.dataset.filterExpressionKind === "report" ? "report" : "list";
}

function controlValue(control: Element | null): string {
  const value = asValueControl(control)?.value;
  return value !== undefined ? String(value).trim() : "";
}

/**
 * Registers the compound-filter-builder hydrator with the boot registry.
 * Also invoked once at module import time so wiring the module into
 * `hydrators.ts` (the generated import list) is sufficient.
 */
export function registerCompoundFilterBuilderHydrator(): void {
  registerHydrator({ name: "compound-filter-builder", hydrate: hydrateCompoundFilterBuilders });
}

registerCompoundFilterBuilderHydrator();
