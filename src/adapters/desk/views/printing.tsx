import type { FC } from "hono/jsx";
import { PRINT_PAGE_ORIENTATIONS, PRINT_PAGE_SIZE_NAMES, type PrintLayoutDefinition, type PrintLetterheadDefinition } from "../../../core/print-format.js";
import { type PrintFormatInspection, type PrintingWorkspaceOverview } from "../../../application/printing-workspace-service.js";
import { type PrintSettingsState } from "../../../core/print-settings.js";
import { ActionBar, Field, FormRow, Notice, Panel, SelectOptions, Toolbar, renderFragment, type SelectOptionSpec } from "../ui/primitives.js";

type PrintSettingsAdminOptions = {
  readonly error?: string | undefined;
  readonly action?: string | undefined;
  readonly editable?: boolean | undefined;
};

export function renderPrintSettingsAdmin(
  state: PrintSettingsState,
  options: {
    readonly error?: string;
    readonly action?: string;
    readonly editable?: boolean;
  } = {}
): string {
  return renderFragment(<PrintSettingsAdmin state={state} options={options} />);
}

const PrintSettingsAdmin: FC<{ state: PrintSettingsState; options: PrintSettingsAdminOptions }> = ({
  state,
  options
}) => {
  const layout = state.settings.defaultLayout;
  const error = options.error ? <Notice tone="error">{options.error}</Notice> : null;
  if (options.editable === false) {
    return (
      <>
        {error}
        <Panel
          id="default-layout"
          variant="printing-section"
          title="Default Print Layout"
          meta={`v${String(state.version)}`}
        >
          <PrintLayoutDetails
            layout={layout}
            empty="No tenant default is configured. Formats use their own layout or renderer defaults."
          />
        </Panel>
      </>
    );
  }
  return (
    <>
      {error}
      <form id="default-layout" class="panel form" method="post" action={options.action ?? "/desk/admin/print-settings"}>
        <input type="hidden" name="expectedVersion" value={String(state.version)} />
        <div class="form-head">
          <h2>Default Print Layout</h2>
          <p>v{String(state.version)}</p>
        </div>
        <FormRow>
          <Field label="Page Size">
            <select name="pageSize">
              <SelectOptions options={printPageSizeOptions(layout)} />
            </select>
          </Field>
          <Field label="Orientation">
            <select name="orientation">
              <SelectOptions options={printOrientationOptions(layout)} />
            </select>
          </Field>
          <Field label="Custom Width (mm)">
            <input name="customWidthMm" type="number" step="any" min="1" max="2000" value={printCustomPageSizeValue(layout, "widthMm")} />
          </Field>
          <Field label="Custom Height (mm)">
            <input name="customHeightMm" type="number" step="any" min="1" max="2000" value={printCustomPageSizeValue(layout, "heightMm")} />
          </Field>
          <Field label="Top Margin (mm)">
            <input name="topMm" type="number" step="any" min="0" max="100" value={printMarginValue(layout, "topMm")} />
          </Field>
          <Field label="Right Margin (mm)">
            <input name="rightMm" type="number" step="any" min="0" max="100" value={printMarginValue(layout, "rightMm")} />
          </Field>
          <Field label="Bottom Margin (mm)">
            <input name="bottomMm" type="number" step="any" min="0" max="100" value={printMarginValue(layout, "bottomMm")} />
          </Field>
          <Field label="Left Margin (mm)">
            <input name="leftMm" type="number" step="any" min="0" max="100" value={printMarginValue(layout, "leftMm")} />
          </Field>
          <Field label="Font Family">
            <input name="fontFamily" value={layout?.font?.family ?? ""} />
          </Field>
          <Field label="Font Size (pt)">
            <input name="fontSizePt" type="number" step="any" min="6" max="72" value={printNumberValue(layout?.font?.sizePt)} />
          </Field>
        </FormRow>
        <div class="choices">
          <label class="choice">
            <input type="checkbox" name="clearDefaultLayout" value="1" />
            <span>Clear Default Layout</span>
          </label>
        </div>
        <ActionBar>
          <button class="button primary" type="submit">
            Save Settings
          </button>
        </ActionBar>
      </form>
    </>
  );
};

export function renderPrintingWorkspace(
  overview: PrintingWorkspaceOverview,
  options: { readonly error?: string } = {}
): string {
  return renderFragment(<PrintingWorkspace overview={overview} options={options} />);
}

const PrintingWorkspace: FC<{
  overview: PrintingWorkspaceOverview;
  options: { readonly error?: string | undefined };
}> = ({ overview, options }) => {
  const groups = groupPrintFormatSummaries(overview.formats);
  return (
    <>
      <Toolbar>
        <div>
          <strong>Printing</strong>
          <p class="muted-copy">Inspect app-defined output and tenant layout defaults.</p>
        </div>
      </Toolbar>
      <Panel variant="printing-section" title="Print Formats" meta={String(overview.formats.length)}>
        {groups.length === 0 ? (
          <p class="empty">No Print Formats are visible for your roles.</p>
        ) : (
          groups.map(([group, formats]) => (
            <section class="printing-group">
              <h3>{group}</h3>
              <ul class="resource-row-list">
                {formats.map((format) => (
                  <li>
                    <a class="resource-row" href={`/desk/printing/formats/${encodeURIComponent(format.name)}`}>
                      <span>
                        <strong>{format.label}</strong>
                        <small>
                          {format.doctype}
                          {format.description === undefined ? "" : ` · ${format.description}`}
                        </small>
                      </span>
                      <span class="related-resource-kind">Print Format</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </Panel>
      <Panel variant="printing-section" title="Letterheads" meta={String(overview.letterheads.length)}>
        {overview.letterheads.length === 0 ? (
          <p class="empty">No Letterheads are visible for your roles.</p>
        ) : (
          <ul class="resource-row-list">
            {overview.letterheads.map((letterhead) => (
              <li>
                <a class="resource-row" href={`/desk/printing/letterheads/${encodeURIComponent(letterhead.name)}`}>
                  <span>
                    <strong>{letterhead.label}</strong>
                    <small>{letterhead.name}</small>
                  </span>
                  <span class="related-resource-kind">Letterhead</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <PrintSettingsAdmin
        state={overview.settings}
        options={{
          error: options.error,
          action: "/desk/printing/default-layout",
          editable: overview.canManageDefaultLayout
        }}
      />
    </>
  );
};

export function renderPrintFormatInspection(
  inspection: PrintFormatInspection,
  options: { readonly printPdfEnabled?: boolean } = {}
): string {
  return renderFragment(<PrintFormatInspectionView inspection={inspection} options={options} />);
}

const PrintFormatInspectionView: FC<{
  inspection: PrintFormatInspection;
  options: { readonly printPdfEnabled?: boolean | undefined };
}> = ({ inspection, options }) => {
  const format = inspection.format;
  const sections = format.sections ?? [];
  return (
    <>
      <Toolbar>
        <a class="button" href="/desk/printing">
          Back to Printing
        </a>
      </Toolbar>
      <Panel variant="printing-section" title={format.label ?? format.name} meta={format.doctype}>
        {format.description === undefined ? null : <p>{format.description}</p>}
        <dl class="definition-list">
          <div>
            <dt>Name</dt>
            <dd>{format.name}</dd>
          </div>
          <div>
            <dt>Module</dt>
            <dd>{format.module ?? "-"}</dd>
          </div>
          <div>
            <dt>Permission</dt>
            <dd>{format.permissionAction ?? "read"}</dd>
          </div>
          <div>
            <dt>Roles</dt>
            <dd>{(format.roles ?? []).join(", ") || "Any authorized role"}</dd>
          </div>
          <div>
            <dt>Letterhead</dt>
            <dd>
              {format.letterhead === undefined ? (
                "-"
              ) : (
                <a href={`/desk/printing/letterheads/${encodeURIComponent(format.letterhead)}`}>{format.letterhead}</a>
              )}
            </dd>
          </div>
        </dl>
      </Panel>
      {sections.length === 0 ? null : (
        <Panel variant="printing-section" title="Sections" meta={String(sections.length)}>
          {sections.map((section) => (
            <section class="print-format-section">
              <h3>{section.heading ?? "Fields"}</h3>
              <ul class="value-list">
                {section.fields.map((field) => (
                  <li>
                    <strong>{field.label ?? field.field}</strong>
                    <span>{field.field}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Panel>
      )}
      {format.template === undefined ? null : (
        <Panel variant="printing-section" title="Template Source" meta="Read only">
          <pre class="source-preview"><code>{format.template}</code></pre>
        </Panel>
      )}
      <Panel variant="printing-section" title="Layout" meta="Effective output">
        <div class="layout-comparison">
          <section>
            <h3>Tenant Default</h3>
            <PrintLayoutDetails layout={inspection.inheritedLayout} empty="Not configured" />
          </section>
          <section>
            <h3>Format Override</h3>
            <PrintLayoutDetails layout={format.layout} empty="No override" />
          </section>
          <section>
            <h3>Effective Layout</h3>
            <PrintLayoutDetails layout={inspection.effectiveLayout} empty="Renderer defaults" />
          </section>
        </div>
      </Panel>
      <Panel variant="printing-section" title="Preview Documents" meta={String(inspection.previewDocuments.length)}>
        {inspection.previewDocuments.length === 0 ? (
          <p class="empty">No readable documents are available for preview.</p>
        ) : (
          <ul class="resource-row-list">
            {inspection.previewDocuments.map((document) => {
              const base = `/desk/print/${encodeURIComponent(format.name)}/${encodeURIComponent(document.name)}`;
              return (
                <li>
                  <div class="resource-row">
                    <span>
                      <strong>{document.name}</strong>
                      <small>{format.doctype}</small>
                    </span>
                    <span class="related-resource-actions">
                      <a class="button" href={base}>
                        HTML
                      </a>
                      {options.printPdfEnabled ? (
                        <a class="button" href={`${base}/pdf`}>
                          PDF
                        </a>
                      ) : null}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
};

export function renderPrintLetterheadInspection(letterhead: PrintLetterheadDefinition): string {
  return renderFragment(<PrintLetterheadInspectionView letterhead={letterhead} />);
}

const PrintLetterheadInspectionView: FC<{ letterhead: PrintLetterheadDefinition }> = ({ letterhead }) => (
  <>
    <Toolbar>
      <a class="button" href="/desk/printing">
        Back to Printing
      </a>
    </Toolbar>
    <Panel variant="printing-section" title={letterhead.label ?? letterhead.name} meta="Read only">
      <dl class="definition-list">
        <div>
          <dt>Name</dt>
          <dd>{letterhead.name}</dd>
        </div>
        <div>
          <dt>Roles</dt>
          <dd>{(letterhead.roles ?? []).join(", ") || "Any authorized role"}</dd>
        </div>
      </dl>
    </Panel>
    <Panel variant="printing-section" title="Header HTML" meta="Escaped source">
      <pre class="source-preview"><code>{letterhead.headerHtml ?? ""}</code></pre>
    </Panel>
    <Panel variant="printing-section" title="Footer HTML" meta="Escaped source">
      <pre class="source-preview"><code>{letterhead.footerHtml ?? ""}</code></pre>
    </Panel>
  </>
);

function groupPrintFormatSummaries(
  formats: PrintingWorkspaceOverview["formats"]
): Array<readonly [string, PrintingWorkspaceOverview["formats"]]> {
  const groups = new Map<string, PrintingWorkspaceOverview["formats"][number][]>();
  for (const format of formats) {
    const group = `${format.module ?? "General"} · ${format.doctype}`;
    const entries = groups.get(group) ?? [];
    entries.push(format);
    groups.set(group, entries);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

const PrintLayoutDetails: FC<{ layout: PrintLayoutDefinition | undefined; empty: string }> = ({ layout, empty }) => {
  if (layout === undefined) {
    return <p class="empty">{empty}</p>;
  }
  const pageSize = typeof layout.pageSize === "string"
    ? layout.pageSize
    : layout.pageSize === undefined
      ? "Renderer default"
      : `${String(layout.pageSize.widthMm)} × ${String(layout.pageSize.heightMm)} mm`;
  const margins = layout.margins === undefined
    ? "Renderer default"
    : `T ${printLayoutValue(layout.margins.topMm)} · R ${printLayoutValue(layout.margins.rightMm)} · B ${printLayoutValue(layout.margins.bottomMm)} · L ${printLayoutValue(layout.margins.leftMm)} mm`;
  const font = layout.font === undefined
    ? "Renderer default"
    : `${layout.font.family ?? "Renderer default"}${layout.font.sizePt === undefined ? "" : ` · ${String(layout.font.sizePt)} pt`}`;
  return (
    <dl class="definition-list compact-definition-list">
      <div>
        <dt>Page</dt>
        <dd>{pageSize}</dd>
      </div>
      <div>
        <dt>Orientation</dt>
        <dd>{layout.orientation ?? "Renderer default"}</dd>
      </div>
      <div>
        <dt>Margins</dt>
        <dd>{margins}</dd>
      </div>
      <div>
        <dt>Font</dt>
        <dd>{font}</dd>
      </div>
    </dl>
  );
};

function printLayoutValue(value: number | undefined): string {
  return value === undefined ? "-" : String(value);
}

function printPageSizeOptions(layout: PrintLayoutDefinition | undefined): readonly SelectOptionSpec[] {
  const selected = typeof layout?.pageSize === "string" ? layout.pageSize : "";
  return [
    { value: "", selected: selected === "" },
    ...PRINT_PAGE_SIZE_NAMES.map((pageSize) => ({ value: pageSize, selected: pageSize === selected }))
  ];
}

function printOrientationOptions(layout: PrintLayoutDefinition | undefined): readonly SelectOptionSpec[] {
  const selected = layout?.orientation ?? "";
  return [
    { value: "", selected: selected === "" },
    ...PRINT_PAGE_ORIENTATIONS.map((orientation) => ({
      value: orientation,
      label: printOrientationLabel(orientation),
      selected: orientation === selected
    }))
  ];
}

function printOrientationLabel(orientation: (typeof PRINT_PAGE_ORIENTATIONS)[number]): string {
  return orientation === "landscape" ? "Landscape" : "Portrait";
}

function printMarginValue(
  layout: PrintLayoutDefinition | undefined,
  side: keyof NonNullable<PrintLayoutDefinition["margins"]>
): string {
  return printNumberValue(layout?.margins?.[side]);
}

function printCustomPageSizeValue(
  layout: PrintLayoutDefinition | undefined,
  dimension: "widthMm" | "heightMm"
): string {
  return layout?.pageSize === undefined || typeof layout.pageSize === "string"
    ? ""
    : printNumberValue(layout.pageSize[dimension]);
}

function printNumberValue(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}
