/**
 * Report formula builder hydration.
 *
 * Ports the legacy `hydrateReportFormulaBuilders` slice of the string client:
 * each `[data-cf-frappe-formula-operand]` gets a kind select listener; choosing
 * "nested" materializes a nested operator + Left/Right operand group (recursively
 * hydrated, depth-limited via `data-formula-max-depth`), and switching away clears
 * the nested container. Field options come from `data-formula-fields`.
 */

import { registerHydrator } from "./boot.js";

export interface ReportFormulaFieldOption {
  readonly name: string;
  readonly label: string;
}

interface ReportFormulaBuilderElement extends HTMLElement {
  __cfFrappeReportFormulaHydrated?: boolean;
  __cfFrappeReportFormulaFields?: ReportFormulaFieldOption[];
}

interface ReportFormulaOperandElement extends HTMLElement {
  __cfFrappeReportFormulaOperandHydrated?: boolean;
}

/**
 * Structural view of the generated select controls. `HTMLSelectElement` cannot be
 * referenced nominally here: the worker `tsconfig.json` merges Cloudflare's
 * HTMLRewriter `Element` into the DOM globals, which makes `HTMLSelectElement`
 * (with its own `remove(index): void`) incompatible with the merged `Element`.
 */
type SelectControl = HTMLElement & { name: string; value: string };

function createSelectControl(): SelectControl {
  return document.createElement("select") as unknown as SelectControl;
}

export function hydrateReportFormulaBuilders(): void {
  const builders = document.querySelectorAll<ReportFormulaBuilderElement>(
    "[data-cf-frappe-report-formula-builder]"
  );
  builders.forEach((builder) => {
    hydrateReportFormulaBuilder(builder);
  });
}

function hydrateReportFormulaBuilder(builder: ReportFormulaBuilderElement): void {
  if (builder.__cfFrappeReportFormulaHydrated) {
    return;
  }
  builder.__cfFrappeReportFormulaHydrated = true;
  builder
    .querySelectorAll<ReportFormulaOperandElement>("[data-cf-frappe-formula-operand]")
    .forEach((operand) => {
      hydrateReportFormulaOperand(builder, operand);
    });
}

function hydrateReportFormulaOperand(
  builder: ReportFormulaBuilderElement,
  operand: ReportFormulaOperandElement
): void {
  if (operand.__cfFrappeReportFormulaOperandHydrated) {
    return;
  }
  operand.__cfFrappeReportFormulaOperandHydrated = true;
  const kind = operand.querySelector("[data-cf-frappe-formula-kind]");
  if (kind) {
    kind.addEventListener("change", () => {
      syncReportFormulaNestedOperand(builder, operand);
    });
  }
}

function syncReportFormulaNestedOperand(
  builder: ReportFormulaBuilderElement,
  operand: ReportFormulaOperandElement
): void {
  const nested = operand.querySelector<HTMLElement>("[data-cf-frappe-formula-nested]");
  if (!nested) {
    return;
  }
  const kind = controlValue(operand.querySelector("[data-cf-frappe-formula-kind]"));
  if (kind !== "nested") {
    clearReportFormulaNested(nested);
    return;
  }
  if (nested.firstChild) {
    return;
  }
  const group = createReportFormulaNestedGroup(builder, operand);
  if (!group) {
    return;
  }
  nested.appendChild(group);
  group
    .querySelectorAll<ReportFormulaOperandElement>("[data-cf-frappe-formula-operand]")
    .forEach((childOperand) => {
      hydrateReportFormulaOperand(builder, childOperand);
    });
}

function clearReportFormulaNested(nested: HTMLElement): void {
  while (nested.firstChild) {
    nested.removeChild(nested.firstChild);
  }
}

function createReportFormulaNestedGroup(
  builder: ReportFormulaBuilderElement,
  operand: ReportFormulaOperandElement
): HTMLElement | null {
  const prefix = reportFormulaOperandPrefix(operand);
  const label = reportFormulaOperandLabel(operand);
  const depth = reportFormulaOperandDepth(operand);
  if (!prefix || !label || depth > reportFormulaMaxDepth(builder)) {
    return null;
  }
  const group = document.createElement("div");
  group.className = "report-formula-nested-group";
  group.appendChild(createReportFormulaOperatorControl(prefix, label));
  group.appendChild(createReportFormulaOperand(builder, `${prefix}Left`, `${label} Left`, depth + 1));
  group.appendChild(createReportFormulaOperand(builder, `${prefix}Right`, `${label} Right`, depth + 1));
  return group;
}

function createReportFormulaOperand(
  builder: ReportFormulaBuilderElement,
  prefix: string,
  label: string,
  depth: number
): HTMLElement {
  const operand = document.createElement("div");
  operand.className = "report-formula-operand";
  operand.setAttribute("data-cf-frappe-formula-operand", "");
  operand.dataset.formulaPrefix = prefix;
  operand.dataset.formulaLabel = label;
  operand.dataset.formulaDepth = String(depth);
  operand.appendChild(createReportFormulaKindControl(builder, prefix, label, depth));
  operand.appendChild(createReportFormulaFieldControl(builder, prefix, label));
  operand.appendChild(createReportFormulaLiteralControl(prefix, label));
  const nested = document.createElement("div");
  nested.className = "report-formula-nested";
  nested.setAttribute("data-cf-frappe-formula-nested", "");
  operand.appendChild(nested);
  return operand;
}

function createReportFormulaKindControl(
  builder: ReportFormulaBuilderElement,
  prefix: string,
  label: string,
  depth: number
): HTMLElement {
  const select = createSelectControl();
  setReportFormulaControlName(select, `${prefix}Kind`);
  select.setAttribute("data-cf-frappe-formula-kind", "");
  appendReportFormulaOption(select, "field", "Field");
  appendReportFormulaOption(select, "literal", "Number");
  if (depth <= reportFormulaMaxDepth(builder)) {
    appendReportFormulaOption(select, "nested", "Nested formula");
  }
  return reportFormulaField(`${label} Type`, select);
}

function createReportFormulaFieldControl(
  builder: ReportFormulaBuilderElement,
  prefix: string,
  label: string
): HTMLElement {
  const select = createSelectControl();
  setReportFormulaControlName(select, prefix);
  appendReportFormulaOption(select, "", "");
  reportFormulaFields(builder).forEach((field) => {
    appendReportFormulaOption(select, field.name, field.label || field.name);
  });
  return reportFormulaField(label, select);
}

function createReportFormulaLiteralControl(prefix: string, label: string): HTMLElement {
  const input = document.createElement("input");
  setReportFormulaControlName(input, `${prefix}Literal`);
  input.type = "number";
  input.step = "any";
  return reportFormulaField(`${label} Number`, input);
}

function createReportFormulaOperatorControl(prefix: string, label: string): HTMLElement {
  const select = createSelectControl();
  setReportFormulaControlName(select, `${prefix}Operator`);
  appendReportFormulaOption(select, "", "");
  appendReportFormulaOption(select, "add", "Add");
  appendReportFormulaOption(select, "subtract", "Subtract");
  appendReportFormulaOption(select, "multiply", "Multiply");
  appendReportFormulaOption(select, "divide", "Divide");
  return reportFormulaField(`${label} Operator`, select);
}

function reportFormulaField(label: string, control: HTMLElement): HTMLElement {
  const field = document.createElement("label");
  field.className = "field";
  const span = document.createElement("span");
  span.textContent = label;
  field.appendChild(span);
  field.appendChild(control);
  return field;
}

function setReportFormulaControlName(
  control: HTMLInputElement | SelectControl,
  name: string
): void {
  control.name = name;
  control.setAttribute("name", name);
}

function appendReportFormulaOption(select: SelectControl, value: string, label: string): void {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

function reportFormulaFields(builder: ReportFormulaBuilderElement): ReportFormulaFieldOption[] {
  if (builder.__cfFrappeReportFormulaFields) {
    return builder.__cfFrappeReportFormulaFields;
  }
  try {
    const parsed: unknown = JSON.parse((builder.dataset && builder.dataset.formulaFields) || "[]");
    builder.__cfFrappeReportFormulaFields = Array.isArray(parsed)
      ? (parsed as Array<{ name?: unknown; label?: unknown } | null>)
          .filter(
            (field): field is { name: string; label?: unknown } =>
              !!field && typeof field.name === "string"
          )
          .map((field) => ({
            name: field.name,
            label: typeof field.label === "string" ? field.label : field.name
          }))
      : [];
  } catch (_error) {
    builder.__cfFrappeReportFormulaFields = [];
  }
  return builder.__cfFrappeReportFormulaFields;
}

function reportFormulaMaxDepth(builder: ReportFormulaBuilderElement): number {
  const value = Number(builder.dataset && builder.dataset.formulaMaxDepth);
  return Number.isFinite(value) && value > 0 ? value : 16;
}

function reportFormulaOperandPrefix(operand: ReportFormulaOperandElement): string {
  return operand.dataset && operand.dataset.formulaPrefix ? String(operand.dataset.formulaPrefix) : "";
}

function reportFormulaOperandLabel(operand: ReportFormulaOperandElement): string {
  return operand.dataset && operand.dataset.formulaLabel ? String(operand.dataset.formulaLabel) : "";
}

function reportFormulaOperandDepth(operand: ReportFormulaOperandElement): number {
  const value = Number(operand.dataset && operand.dataset.formulaDepth);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function controlValue(control: Element | null): string {
  const value = (control as unknown as { value?: unknown } | null)?.value;
  return value !== undefined ? String(value).trim() : "";
}

/**
 * Registers the report-formula-builder hydrator with the boot registry.
 * Also invoked once at module import time so wiring the module into
 * `hydrators.ts` (the generated import list) is sufficient.
 */
export function registerReportFormulaBuilderHydrator(): void {
  registerHydrator({ name: "report-formula-builder", hydrate: hydrateReportFormulaBuilders });
}

registerReportFormulaBuilderHydrator();
