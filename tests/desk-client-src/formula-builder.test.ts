import { hydratorRegistry, resetRegistries } from "../../src/adapters/desk/client-src/boot";
import {
  hydrateReportFormulaBuilders,
  registerReportFormulaBuilderHydrator
} from "../../src/adapters/desk/client-src/formula-builder";

const FIELDS = [
  { name: "qty", label: "Quantity" },
  { name: "rate", label: "Rate" }
];

interface OperandOptions {
  prefix?: string;
  label?: string;
  depth?: number | string;
  nestedContainer?: boolean;
  nestedOption?: boolean;
  datasetOverrides?: Record<string, string | null>;
}

function operandHtml(options: OperandOptions = {}): string {
  const prefix = options.prefix ?? "formulaLeft";
  const label = options.label ?? "Formula Left";
  const depth = options.depth ?? 2;
  const attributes = [
    `data-cf-frappe-formula-operand=""`,
    options.datasetOverrides?.formulaPrefix === null ? "" : `data-formula-prefix="${prefix}"`,
    options.datasetOverrides?.formulaLabel === null ? "" : `data-formula-label="${label}"`,
    options.datasetOverrides?.formulaDepth === null ? "" : `data-formula-depth="${depth}"`
  ]
    .filter((attribute) => attribute !== "")
    .join(" ");
  return `<div class="report-formula-operand" ${attributes}>
    <label class="field"><span>${label} Type</span>
      <select name="${prefix}Kind" data-cf-frappe-formula-kind="">
        <option value="field">Field</option>
        <option value="literal">Number</option>
        ${options.nestedOption === false ? "" : `<option value="nested">Nested formula</option>`}
      </select>
    </label>
    <label class="field"><span>${label}</span><select name="${prefix}"><option value=""></option>${FIELDS.map((field) => `<option value="${field.name}">${field.label}</option>`).join("")}</select></label>
    <label class="field"><span>${label} Number</span><input name="${prefix}Literal" type="number" step="any"></label>
    ${options.nestedContainer === false ? "" : `<div class="report-formula-nested" data-cf-frappe-formula-nested=""></div>`}
  </div>`;
}

interface BuilderOptions {
  maxDepth?: number | string;
  fieldsJson?: string;
  operands?: string;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function installBuilder(options: BuilderOptions = {}): HTMLElement {
  const fieldsJson = options.fieldsJson ?? JSON.stringify(FIELDS);
  const maxDepth = options.maxDepth === undefined ? "" : ` data-formula-max-depth="${options.maxDepth}"`;
  document.body.innerHTML = `<form>
    <div class="report-formula-builder" data-cf-frappe-report-formula-builder=""${maxDepth} data-formula-fields="${escapeAttribute(fieldsJson)}">
      <label class="field"><span>Formula Label</span><input name="formulaLabel"></label>
      ${options.operands ?? operandHtml()}
    </div>
  </form>`;
  return document.querySelector("[data-cf-frappe-report-formula-builder]") as HTMLElement;
}

type SelectEl = HTMLElement & { value: string; name: string; options: HTMLOptionsCollection };

/**
 * The worker tsconfig merges Cloudflare's HTMLRewriter Element into the DOM
 * globals, which poisons direct casts to HTMLSelectElement (it declares its own
 * remove(index): void). Query select controls through a structural type instead.
 */
function kindSelect(scope: Element): SelectEl {
  return scope.querySelector("[data-cf-frappe-formula-kind]") as unknown as SelectEl;
}

function selectKind(operand: Element, value: string): void {
  const select = kindSelect(operand);
  select.value = value;
  (select as unknown as HTMLElement).dispatchEvent(new Event("change", { bubbles: true }));
}

function nestedContainer(operand: Element): HTMLElement {
  return operand.querySelector("[data-cf-frappe-formula-nested]") as HTMLElement;
}

describe("client-src formula-builder", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("registers a hydrator registration for the boot sequence", () => {
    resetRegistries();
    registerReportFormulaBuilderHydrator();
    const names = hydratorRegistry.list().map((registration) => registration.name);
    expect(names).toContain("report-formula-builder");
    expect(hydratorRegistry.list()[0]?.hydrate).toBe(hydrateReportFormulaBuilders);
  });

  it("does nothing when no builders exist", () => {
    expect(() => hydrateReportFormulaBuilders()).not.toThrow();
  });

  it("builds a nested operator + Left/Right operand group when kind becomes nested", () => {
    const builder = installBuilder({ maxDepth: 16 });
    hydrateReportFormulaBuilders();
    const operand = builder.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    selectKind(operand, "nested");
    const group = nestedContainer(operand).firstElementChild as HTMLElement;
    expect(group.className).toBe("report-formula-nested-group");
    const operator = group.querySelector('select[name="formulaLeftOperator"]') as unknown as SelectEl;
    expect(Array.from(operator.options).map((option) => option.value)).toEqual([
      "",
      "add",
      "subtract",
      "multiply",
      "divide"
    ]);
    expect(Array.from(operator.options).map((option) => option.textContent)).toEqual([
      "",
      "Add",
      "Subtract",
      "Multiply",
      "Divide"
    ]);
    const operands = group.querySelectorAll<HTMLElement>("[data-cf-frappe-formula-operand]");
    expect(operands).toHaveLength(2);
    const left = operands[0] as HTMLElement;
    const right = operands[1] as HTMLElement;
    expect(left.dataset.formulaPrefix).toBe("formulaLeftLeft");
    expect(left.dataset.formulaLabel).toBe("Formula Left Left");
    expect(left.dataset.formulaDepth).toBe("3");
    expect(right.dataset.formulaPrefix).toBe("formulaLeftRight");
    expect(right.dataset.formulaLabel).toBe("Formula Left Right");
    expect(right.dataset.formulaDepth).toBe("3");
    const childKind = kindSelect(left);
    expect(childKind.name).toBe("formulaLeftLeftKind");
    expect(Array.from(childKind.options).map((option) => option.value)).toEqual([
      "field",
      "literal",
      "nested"
    ]);
    const childField = left.querySelector('select[name="formulaLeftLeft"]') as unknown as SelectEl;
    expect(Array.from(childField.options).map((option) => option.value)).toEqual(["", "qty", "rate"]);
    expect(Array.from(childField.options).map((option) => option.textContent)).toEqual([
      "",
      "Quantity",
      "Rate"
    ]);
    const literal = left.querySelector('input[name="formulaLeftLeftLiteral"]') as HTMLInputElement;
    expect(literal.type).toBe("number");
    expect(literal.step).toBe("any");
    const labels = Array.from(left.querySelectorAll("label.field > span")).map(
      (span) => span.textContent
    );
    expect(labels).toEqual(["Formula Left Left Type", "Formula Left Left", "Formula Left Left Number"]);
  });

  it("hydrates generated child operands so they can nest recursively", () => {
    const builder = installBuilder({ maxDepth: 16 });
    hydrateReportFormulaBuilders();
    const operand = builder.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    selectKind(operand, "nested");
    const child = nestedContainer(operand).querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    selectKind(child, "nested");
    const grandchild = nestedContainer(child).querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    expect(grandchild.dataset.formulaPrefix).toBe("formulaLeftLeftLeft");
    expect(grandchild.dataset.formulaDepth).toBe("4");
  });

  it("clears the nested group when the kind changes away from nested", () => {
    const builder = installBuilder();
    hydrateReportFormulaBuilders();
    const operand = builder.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    selectKind(operand, "nested");
    expect(nestedContainer(operand).children).toHaveLength(1);
    selectKind(operand, "field");
    expect(nestedContainer(operand).children).toHaveLength(0);
  });

  it("keeps the existing nested group when nested is selected again", () => {
    const builder = installBuilder();
    hydrateReportFormulaBuilders();
    const operand = builder.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    selectKind(operand, "nested");
    const group = nestedContainer(operand).firstElementChild;
    selectKind(operand, "nested");
    expect(nestedContainer(operand).firstElementChild).toBe(group);
  });

  it("omits the nested kind option for children beyond the max depth", () => {
    const builder = installBuilder({ maxDepth: 2 });
    hydrateReportFormulaBuilders();
    const operand = builder.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    selectKind(operand, "nested");
    const child = nestedContainer(operand).querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    expect(Array.from(kindSelect(child).options).map((option) => option.value)).toEqual([
      "field",
      "literal"
    ]);
  });

  it("refuses to build nested groups past the max depth", () => {
    const builder = installBuilder({ maxDepth: 1, operands: operandHtml({ depth: 2 }) });
    hydrateReportFormulaBuilders();
    const operand = builder.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    selectKind(operand, "nested");
    expect(nestedContainer(operand).children).toHaveLength(0);
  });

  it("defaults max depth to 16 when the attribute is missing or invalid", () => {
    for (const maxDepth of [undefined, "abc", "0", "-3"]) {
      const builder = installBuilder({
        ...(maxDepth === undefined ? {} : { maxDepth }),
        operands: operandHtml({ depth: 16 })
      });
      hydrateReportFormulaBuilders();
      const operand = builder.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
      selectKind(operand, "nested");
      expect(nestedContainer(operand).children).toHaveLength(1);
      const child = nestedContainer(operand).querySelector(
        "[data-cf-frappe-formula-operand]"
      ) as HTMLElement;
      expect(child.dataset.formulaDepth).toBe("17");
      expect(Array.from(kindSelect(child).options).map((option) => option.value)).toEqual([
        "field",
        "literal"
      ]);
    }
  });

  it("defaults the operand depth to 1 when the attribute is missing or invalid", () => {
    const builder = installBuilder({
      operands: operandHtml({ datasetOverrides: { formulaDepth: null } })
    });
    hydrateReportFormulaBuilders();
    const operand = builder.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    selectKind(operand, "nested");
    const child = nestedContainer(operand).querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    expect(child.dataset.formulaDepth).toBe("2");

    const invalid = installBuilder({ operands: operandHtml({ depth: "abc" }) });
    hydrateReportFormulaBuilders();
    const invalidOperand = invalid.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    selectKind(invalidOperand, "nested");
    const invalidChild = nestedContainer(invalidOperand).querySelector(
      "[data-cf-frappe-formula-operand]"
    ) as HTMLElement;
    expect(invalidChild.dataset.formulaDepth).toBe("2");
  });

  it("skips nested group creation when the operand prefix or label is missing", () => {
    for (const overrides of [{ formulaPrefix: null }, { formulaLabel: null }]) {
      const builder = installBuilder({ operands: operandHtml({ datasetOverrides: overrides }) });
      hydrateReportFormulaBuilders();
      const operand = builder.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
      selectKind(operand, "nested");
      expect(nestedContainer(operand).children).toHaveLength(0);
    }
  });

  it("ignores kind changes on operands without a nested container", () => {
    const builder = installBuilder({ operands: operandHtml({ nestedContainer: false }) });
    hydrateReportFormulaBuilders();
    const operand = builder.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    expect(() => selectKind(operand, "nested")).not.toThrow();
    expect(operand.querySelector(".report-formula-nested-group")).toBeNull();
  });

  it("treats invalid, non-array, or malformed formula fields as empty and caches the parse", () => {
    for (const fieldsJson of ["{oops", `{"name":"qty"}`]) {
      const builder = installBuilder({ fieldsJson });
      hydrateReportFormulaBuilders();
      const operand = builder.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
      selectKind(operand, "nested");
      const child = nestedContainer(operand).querySelector(
        "[data-cf-frappe-formula-operand]"
      ) as HTMLElement;
      const field = (child.querySelector("select:not([data-cf-frappe-formula-kind])") as unknown as SelectEl);
      expect(Array.from(field.options).map((option) => option.value)).toEqual([""]);
    }
  });

  it("filters malformed field entries and falls back to the name as label", () => {
    const builder = installBuilder({
      fieldsJson: JSON.stringify([
        null,
        { label: "No name" },
        { name: 7 },
        { name: "qty", label: 5 },
        { name: "rate", label: "Rate" }
      ])
    });
    hydrateReportFormulaBuilders();
    const operand = builder.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    selectKind(operand, "nested");
    const child = nestedContainer(operand).querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    const field = (child.querySelector("select:not([data-cf-frappe-formula-kind])") as unknown as SelectEl);
    expect(Array.from(field.options).map((option) => [option.value, option.textContent])).toEqual([
      ["", ""],
      ["qty", "qty"],
      ["rate", "Rate"]
    ]);
    // Second nested expansion reuses the cached parse.
    selectKind(child, "nested");
    const grandchild = nestedContainer(child).querySelector(
      "[data-cf-frappe-formula-operand]"
    ) as HTMLElement;
    const grandchildField = (grandchild.querySelector("select:not([data-cf-frappe-formula-kind])") as unknown as SelectEl);
    expect(Array.from(grandchildField.options).map((option) => option.value)).toEqual([
      "",
      "qty",
      "rate"
    ]);
  });

  it("hydrates builders and operands only once", () => {
    const builder = installBuilder();
    hydrateReportFormulaBuilders();
    hydrateReportFormulaBuilders();
    const operand = builder.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    selectKind(operand, "nested");
    expect(nestedContainer(operand).children).toHaveLength(1);
  });

  it("skips already-hydrated operands when a builder is re-hydrated", () => {
    const builder = installBuilder() as HTMLElement & { __cfFrappeReportFormulaHydrated?: boolean };
    hydrateReportFormulaBuilders();
    delete builder.__cfFrappeReportFormulaHydrated;
    hydrateReportFormulaBuilders();
    const operand = builder.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    selectKind(operand, "nested");
    expect(nestedContainer(operand).children).toHaveLength(1);
  });

  it("falls back to the field name when the label is empty", () => {
    const builder = installBuilder({
      fieldsJson: JSON.stringify([{ name: "qty", label: "" }])
    });
    hydrateReportFormulaBuilders();
    const operand = builder.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    selectKind(operand, "nested");
    const child = nestedContainer(operand).querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    const field = (child.querySelector("select:not([data-cf-frappe-formula-kind])") as unknown as SelectEl);
    expect(Array.from(field.options).map((option) => [option.value, option.textContent])).toEqual([
      ["", ""],
      ["qty", "qty"]
    ]);
  });

  it("defaults to no fields when data-formula-fields is absent", () => {
    document.body.innerHTML = `<form>
      <div class="report-formula-builder" data-cf-frappe-report-formula-builder="">${operandHtml()}</div>
    </form>`;
    hydrateReportFormulaBuilders();
    const operand = document.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    selectKind(operand, "nested");
    const child = nestedContainer(operand).querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    const field = (child.querySelector("select:not([data-cf-frappe-formula-kind])") as unknown as SelectEl);
    expect(Array.from(field.options).map((option) => option.value)).toEqual([""]);
  });

  it("clears the nested group when the kind select disappears before the change fires", () => {
    const builder = installBuilder();
    hydrateReportFormulaBuilders();
    const operand = builder.querySelector("[data-cf-frappe-formula-operand]") as HTMLElement;
    const select = kindSelect(operand);
    selectKind(operand, "nested");
    expect(nestedContainer(operand).children).toHaveLength(1);
    select.remove();
    (select as unknown as HTMLElement).dispatchEvent(new Event("change", { bubbles: true }));
    expect(nestedContainer(operand).children).toHaveLength(0);
  });

  it("tolerates operands without a kind select", () => {
    const builder = installBuilder({
      operands: `<div class="report-formula-operand" data-cf-frappe-formula-operand="" data-formula-prefix="p" data-formula-label="L" data-formula-depth="2"><div data-cf-frappe-formula-nested=""></div></div>`
    });
    expect(() => hydrateReportFormulaBuilders()).not.toThrow();
    expect(builder.querySelector(".report-formula-nested-group")).toBeNull();
  });
});
