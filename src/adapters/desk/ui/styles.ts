/**
 * Desk stylesheet, served as a standalone cached asset.
 *
 * The CSS content previously lived inline in render.ts (deskCss) and is kept
 * byte-identical here. Pages reference it via <link rel="stylesheet"
 * href={DESK_STYLES_PATH}> emitted by the Desk layout.
 */

export const DESK_STYLES_PATH = "/desk/styles.css";

export function deskCss(): string {
  return `
:root {
  color-scheme: light;
  --bg: #f7f8fa;
  --surface: #ffffff;
  --surface-muted: #f1f4f8;
  --border: #d9dee7;
  --border-strong: #c4ccd8;
  --text: #1f2937;
  --muted: #5b6472;
  --primary: #185abc;
  --primary-dark: #123f83;
  --success: #137333;
  --warning: #b26a00;
  --danger: #b42318;
  --focus: #b45309;
  --shadow: 0 1px 2px rgb(15 23 42 / 0.06), 0 8px 24px rgb(15 23 42 / 0.04);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100dvh;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 16px;
  line-height: 1.5;
}
a { color: var(--primary); }
a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}
.skip-link {
  position: absolute;
  left: 12px;
  top: -48px;
  background: var(--surface);
  padding: 8px 12px;
  border: 1px solid var(--border);
  z-index: 2;
}
.skip-link:focus { top: 12px; }
.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: 240px;
  padding: 20px 14px;
  border-right: 1px solid var(--border);
  background: var(--surface);
  overflow-y: auto;
}
.brand {
  display: block;
  margin: 0 8px 20px;
  color: var(--text);
  font-weight: 700;
  text-decoration: none;
}
.mobile-shell-header {
  display: none;
}
.mobile-brand {
  margin: 0;
}
.mobile-nav {
  position: relative;
}
.mobile-nav summary {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-weight: 700;
  list-style: none;
  cursor: pointer;
}
.mobile-nav summary::-webkit-details-marker { display: none; }
.mobile-nav nav {
  position: absolute;
  inset: calc(100% + 8px) 0 auto auto;
  width: min(92vw, 320px);
  max-height: 72vh;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
  overflow: auto;
}
.nav-link {
  display: block;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 6px;
  color: var(--text);
  text-decoration: none;
}
.nav-link:hover, .nav-link.is-active { background: #e9eef7; }
.nav-heading {
  margin: 18px 12px 6px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}
.main { margin-left: 240px; padding: 24px; }
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.kicker {
  margin: 0 0 4px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
}
h1, h2 { margin: 0; letter-spacing: 0; }
h1 { font-size: 28px; line-height: 1.2; }
h2 { font-size: 20px; line-height: 1.3; }
h3 { margin: 0 0 12px; font-size: 16px; line-height: 1.35; letter-spacing: 0; }
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 12px;
  margin-bottom: 16px;
}
.toolbar .compact-field { min-width: 160px; }
.home-overview {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(320px, 0.9fr);
  gap: 20px;
  align-items: end;
  margin-bottom: 22px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border);
}
.home-overview h2 {
  margin: 0 0 6px;
  font-size: 24px;
}
.home-overview p {
  margin: 0;
}
.home-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.metric-card {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.metric-card span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}
.metric-card strong {
  font-size: 24px;
  line-height: 1.1;
}
.home-section {
  margin-bottom: 22px;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}
.section-head h2 {
  font-size: 16px;
}
.section-head span {
  color: var(--muted);
  font-size: 13px;
}
.home-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.home-link-card {
  display: grid;
  align-content: start;
  gap: 5px;
  min-height: 132px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
}
.home-link-card:hover,
.workspace-card:hover,
.kanban-card:hover {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px rgb(24 90 188 / 0.08);
}
.home-link-card p,
.home-link-card small {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
.resource-kind {
  width: fit-content;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}
.workspace-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.workspace-section { margin-bottom: 18px; }
.workspace-section h2 { margin-bottom: 10px; }
.workspace-card {
  display: grid;
  gap: 4px;
  min-height: 88px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
}
.workspace-card:hover { border-color: var(--primary); }
.workspace-card span { color: var(--muted); }
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.dashboard-card {
  display: grid;
  gap: 6px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.dashboard-card-link {
  display: grid;
  gap: 6px;
  color: inherit;
  text-decoration: none;
}
.dashboard-card:hover { border-color: var(--primary); }
.dashboard-card span,
.dashboard-card small {
  color: var(--muted);
  font-size: 13px;
}
.dashboard-card strong {
  font-size: 28px;
  line-height: 1.15;
}
.dashboard-card em {
  font-style: normal;
  color: var(--primary);
  font-weight: 700;
}
.dashboard-card p { margin: 0; color: var(--muted); }
.dashboard-chart-card { min-width: 0; }
@media (min-width: 720px) {
  .dashboard-chart-card { grid-column: span 2; }
}
.kanban-board {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
  align-items: start;
}
.board-toolbar {
  justify-content: flex-start;
  align-items: center;
}
.kanban-column {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f9fafb;
}
.kanban-column header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.kanban-column header span {
  min-width: 28px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #e9eef7;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}
.kanban-card {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
}
.kanban-card span,
.kanban-card small {
  color: var(--muted);
  font-size: 13px;
}
.kanban-card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.kanban-card-meta small {
  overflow-wrap: anywhere;
}
.kanban-board-island {
  display: block;
}
.kanban-island-columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
  align-items: start;
}
.kanban-island-instructions {
  margin: 0 0 10px;
  color: var(--muted);
  font-size: 13px;
}
.kanban-card-island {
  cursor: grab;
}
.kanban-card-island:focus-visible {
  outline: 2px solid #1f6feb;
  outline-offset: 2px;
}
.kanban-card-grabbed {
  border-color: #1f6feb;
  box-shadow: 0 0 0 2px rgba(31, 111, 235, 0.25);
}
.kanban-column-target {
  border-color: #1f6feb;
  background: #eef4ff;
}
.kanban-card-target-hint {
  color: #1f6feb;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.calendar-list {
  display: grid;
  gap: 10px;
}
.calendar-list header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f9fafb;
}
.calendar-list header span {
  min-width: 28px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #e9eef7;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}
.calendar-event {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
}
.calendar-event:hover { border-color: var(--primary); }
.calendar-event time,
.calendar-event span,
.calendar-event small {
  color: var(--muted);
  font-size: 13px;
}
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.related-resources {
  padding: 18px;
}
.related-resource-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: 20px;
}
.related-resource-group h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.related-resource-list {
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--border);
  list-style: none;
}
.related-resource-list li {
  border-bottom: 1px solid var(--border);
}
.related-resource-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: 58px;
  padding: 10px 0;
  color: var(--text);
  text-decoration: none;
}
.related-resource-link:hover strong {
  color: var(--primary);
}
.related-resource-link > span:first-child,
.related-resource-print > a {
  display: grid;
  min-width: 0;
  gap: 3px;
  color: inherit;
  text-decoration: none;
}
.related-resource-link small {
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.related-resource-kind {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}
.related-resource-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.printing-section {
  padding: 18px;
}
.printing-group + .printing-group {
  margin-top: 20px;
}
.printing-group h3,
.print-format-section h3,
.layout-comparison h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.resource-row-list,
.value-list {
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--border);
  list-style: none;
}
.resource-row-list li,
.value-list li {
  border-bottom: 1px solid var(--border);
}
.resource-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: 58px;
  padding: 10px 0;
  color: var(--text);
  text-decoration: none;
}
.resource-row > span:first-child {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.resource-row small,
.muted-copy {
  color: var(--muted);
  font-size: 12px;
}
.resource-row:hover strong {
  color: var(--primary);
}
.definition-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
  gap: 12px 18px;
  margin: 16px 0 0;
}
.definition-list div {
  min-width: 0;
}
.definition-list dt {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}
.definition-list dd {
  margin: 3px 0 0;
  overflow-wrap: anywhere;
}
.compact-definition-list {
  grid-template-columns: 1fr;
  margin-top: 0;
}
.layout-comparison {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr));
  gap: 20px;
}
.print-format-section + .print-format-section {
  margin-top: 18px;
}
.value-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
}
.value-list span {
  color: var(--muted);
  overflow-wrap: anywhere;
}
.source-preview {
  max-height: 420px;
  margin: 0;
  padding: 14px;
  overflow: auto;
  border: 1px solid var(--border);
  background: #f8fafc;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.main > .panel,
.main > form.panel,
.main > .toolbar,
.main > .desk-disclosure {
  margin-bottom: 14px;
}
.main > .panel:last-child,
.main > form.panel:last-child,
.main > .toolbar:last-child,
.main > .desk-disclosure:last-child {
  margin-bottom: 0;
}
.table-wrap { overflow-x: auto; }
.table-wrap table {
  min-width: 620px;
}
.table-wrap .document-table,
.table-wrap .responsive-table {
  min-width: 0;
}
.list-toolbar {
  justify-content: space-between;
  align-items: center;
}
.toolbar-main,
.toolbar-aside {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
#bulk-document-action {
  display: none;
}
.record-count,
.board-mode {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
}
.active-filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: -4px 0 12px;
}
.filter-chip,
.value-chip,
.status-pill,
.version-pill {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-height: 24px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.value-chip-high { background: #fef3c7; color: #92400e; }
.value-chip-medium { background: #e0f2fe; color: #075985; }
.value-chip-low { background: #ecfdf3; color: #166534; }
.value-chip-open { background: #e0f2fe; color: #075985; }
.value-chip-doing { background: #fef3c7; color: #92400e; }
.value-chip-done,
.status-pill { background: #ecfdf3; color: #166534; }
.list-table-panel {
  margin-bottom: 14px;
  overflow: hidden;
}
.document-table th,
.responsive-table th {
  background: #fbfcfe;
  white-space: nowrap;
}
.document-table td,
.responsive-table td {
  white-space: nowrap;
}
.document-table td:nth-child(2),
.document-table td[data-label="Name"] {
  min-width: 220px;
}
.document-table tbody tr:hover,
.responsive-table tbody tr:hover {
  background: #fbfcfe;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th, td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
th {
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
}
tr:last-child td { border-bottom: 0; }
.empty { color: var(--muted); }
.notice, .error {
  padding: 10px 12px;
  border-radius: 6px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
}
.error {
  color: var(--danger);
  background: #fef3f2;
  border-color: #fecdca;
}
.form { padding: 18px; max-width: 860px; }
.main > .form:not(.document-form):not(.timeline-assignment-form):not(.timeline-share-form):not(.timeline-follower-form):not(.timeline-tag-form) {
  max-width: none;
}
.document-form {
  max-width: 980px;
  padding: 0;
  overflow: clip;
}
.form-action-bar {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
  background: rgb(255 255 255 / 0.96);
}
.form-action-bar div:first-child {
  display: grid;
  gap: 2px;
}
.form-action-bar span {
  color: var(--muted);
  font-size: 13px;
}
.form-action-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.document-form .form-head,
.document-form .form-section,
.document-form > .error,
.document-form > .actions,
.document-form > .command-row {
  margin-left: 18px;
  margin-right: 18px;
}
.document-form .form-head {
  margin-top: 18px;
}
.document-form > .actions {
  padding-bottom: 18px;
}
.timeline { margin-top: 16px; max-width: 860px; }
.presence { margin-top: 16px; max-width: 860px; padding: 18px; }
.list-filters { max-width: none; }
.list-filters .actions { justify-content: flex-start; }
.quick-filter-choice {
  display: grid;
  grid-template-columns: minmax(120px, 0.75fr) minmax(180px, 1fr);
  gap: 10px;
  align-items: end;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.quick-filter-choice legend {
  grid-column: 1 / -1;
  padding: 0;
  font-weight: 650;
}
.quick-filter-choice .field span {
  color: var(--muted);
  font-size: 13px;
}
.compound-filter-builder {
  grid-column: 1 / -1;
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.compound-filter-builder legend {
  padding: 0 6px;
  color: var(--muted);
  font-weight: 700;
}
.nested-disclosure .compound-filter-builder {
  border: 0;
  padding: 14px;
}
.compound-filter-visual,
.compound-filter-items {
  display: grid;
  gap: 10px;
}
.compound-filter-group {
  display: grid;
  gap: 10px;
}
.compound-filter-group:not(.compound-filter-root) {
  border-left: 2px solid var(--border);
  padding-left: 12px;
}
.compound-filter-group-head,
.compound-filter-group-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: end;
}
.compound-filter-group-actions {
  align-self: end;
}
.compound-filter-row {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(150px, 0.8fr) minmax(180px, 1.2fr) auto;
  gap: 10px;
  align-items: end;
}
.compound-filter-row .button {
  white-space: nowrap;
}
.field.compact span,
.field.grow span,
.filter-expression-preview {
  color: var(--muted);
  font-size: 13px;
}
.field.grow {
  min-width: 0;
}
.filter-expression-group ul {
  margin: 8px 0 0 18px;
  padding: 0;
}
.report-summary {
  padding: 14px 18px;
}
.report-summary ul {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.report-summary li {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.report-summary span { color: var(--muted); font-size: 13px; }
.report-summary strong { font-size: 20px; }
.report-group {
  padding: 14px 18px;
}
.report-group h2 { margin-bottom: 10px; font-size: 16px; }
.report-charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}
.report-chart {
  padding: 14px 18px;
}
.report-chart h2 { margin-bottom: 10px; font-size: 16px; }
.chart-svg {
  width: 100%;
  max-height: 280px;
}
.chart-bar rect { fill: var(--primary); }
.chart-bar text,
.chart-line text {
  fill: var(--muted);
  font-size: 12px;
}
.chart-axis-label {
  fill: var(--text);
  font-size: 10px;
  font-weight: 600;
}
.chart-line path {
  fill: none;
  stroke: var(--primary);
  stroke-width: 3;
}
.chart-line circle {
  fill: var(--surface);
  stroke: var(--primary);
  stroke-width: 3;
}
.chart-pie-wrap {
  display: grid;
  grid-template-columns: minmax(160px, 220px) 1fr;
  gap: 16px;
  align-items: center;
}
.chart-pie {
  transform: rotate(-90deg);
}
.chart-pie circle {
  fill: none;
  stroke-width: 45;
  stroke: var(--primary);
}
.chart-pie circle:nth-child(2),
.chart-swatch-1 { stroke: #2e7d32; background: #2e7d32; }
.chart-pie circle:nth-child(3),
.chart-swatch-2 { stroke: #ad1457; background: #ad1457; }
.chart-pie circle:nth-child(4),
.chart-swatch-3 { stroke: #ef6c00; background: #ef6c00; }
.chart-pie circle:nth-child(5),
.chart-swatch-4 { stroke: #00695c; background: #00695c; }
.chart-pie circle:nth-child(6),
.chart-swatch-5 { stroke: #6a1b9a; background: #6a1b9a; }
.chart-pie-wrap ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.chart-pie-wrap li {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.chart-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--primary);
}
.saved-filters {
  max-width: none;
  margin-bottom: 16px;
  padding: 14px 18px;
}
.job-history { margin-top: 16px; }
.saved-filters h2 { margin-bottom: 10px; font-size: 16px; }
.saved-filters ul {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.saved-filters li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.saved-filter-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  text-decoration: none;
}
.saved-filter-link.is-active { background: #e9eef7; border-color: var(--primary); }
.desk-disclosure {
  margin-bottom: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.desk-disclosure > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 52px;
  padding: 12px 16px;
  color: var(--text);
  font-weight: 700;
  cursor: pointer;
}
.desk-disclosure > summary small {
  color: var(--muted);
  font-weight: 600;
}
.desk-disclosure[open] > summary {
  border-bottom: 1px solid var(--border);
}
.list-filter-form {
  max-width: none;
  padding: 16px;
}
.list-import-disclosure .list-import {
  margin: 0;
  border: 0;
  border-radius: 0 0 8px 8px;
}
.nested-disclosure {
  grid-column: 1 / -1;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fbfcfe;
}
.nested-disclosure > summary {
  min-height: 44px;
  padding: 10px 12px;
  color: var(--muted);
  font-weight: 700;
  cursor: pointer;
}
.nested-disclosure[open] > summary {
  border-bottom: 1px solid var(--border);
}
.form-head, .timeline-head, .attachment-head, .presence-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.timeline-head { padding: 18px 18px 0; }
.attachments { margin-top: 16px; max-width: 860px; }
.attachment-upload {
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.form-head p, .timeline-head p, .presence-head p, .presence-list { margin: 0; color: var(--muted); }
.timeline strong { display: block; }
.timeline small { color: var(--muted); }
.timeline-changes {
  display: grid;
  gap: 4px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}
.timeline-changes li {
  display: grid;
  grid-template-columns: minmax(64px, 0.7fr) minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  color: var(--muted);
}
.timeline-changes li span {
  overflow-wrap: anywhere;
}
.timeline-changes li span:first-child {
  color: var(--text);
  font-weight: 600;
}
.timeline-tags,
.timeline-followers,
.timeline-shares,
.timeline-assignments {
  padding: 0 18px 18px;
  border-bottom: 1px solid var(--border);
}
.timeline-tags + .timeline-followers,
.timeline-followers + .timeline-shares,
.timeline-shares + .timeline-assignments {
  padding-top: 18px;
}
.tag-list,
.follower-list,
.share-list,
.assignment-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tag-list li,
.follower-list li,
.share-list li,
.assignment-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
}
.inline-action { margin: 0; }
.data-patch-actions,
.data-patch-command-action {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.data-patch-actions {
  align-items: flex-start;
  min-width: min(100%, 440px);
}
.data-patch-queue-action {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(92px, 120px) auto;
  gap: 8px;
  align-items: center;
  width: 100%;
}
.data-patch-queue-action input {
  min-height: 38px;
}
.timeline-tag-form,
.timeline-follower-form,
.timeline-share-form,
.timeline-assignment-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px;
  margin-top: 12px;
}
.timeline-share-form .choice-grid {
  grid-column: 1 / -1;
  margin: 0;
}
.timeline-comment {
  padding: 16px 18px 18px;
  border-top: 1px solid var(--border);
}
.timeline-comment textarea { min-height: 88px; }
.form-section + .form-section {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
.fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.fields.cols-1 { grid-template-columns: 1fr; }
.field { display: grid; gap: 6px; }
.field.wide { grid-column: 1 / -1; }
.field span { font-weight: 650; }
.field small { color: var(--muted); }
.checkbox-field,
.field.checkbox {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  column-gap: 10px;
  min-height: 44px;
}
.checkbox-field input,
.field.checkbox input {
  width: 20px;
  min-height: 20px;
}
.checkbox-field small,
.field.checkbox small {
  grid-column: 2;
}
.choice-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin: 18px 0 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.choice-grid legend {
  padding: 0 6px;
  color: var(--muted);
  font-weight: 700;
}
.choice {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}
.admin-row-builder {
  grid-column: 1 / -1;
  display: grid;
  gap: 12px;
  margin: 18px 0 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.admin-row-builder legend {
  padding: 0 6px;
  color: var(--muted);
  font-weight: 700;
}
.admin-row-list {
  display: grid;
  gap: 10px;
}
.admin-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
  align-items: end;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fbfcfe;
}
.report-builder-filter {
  display: grid;
  gap: 8px;
  align-content: start;
}
.report-formula-builder {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.report-formula-builder > .field {
  grid-column: 1 / -1;
}
.report-formula-operand,
.report-formula-nested-group {
  display: grid;
  gap: 10px;
}
.report-formula-operand {
  min-width: 0;
}
.report-formula-nested {
  display: grid;
  gap: 10px;
}
.report-formula-nested-group {
  border-left: 2px solid var(--border);
  padding-left: 12px;
}
.report-builder-filter .field span {
  color: var(--muted);
  font-size: 13px;
}
.report-builder-range-filter {
  display: grid;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.choice input {
  width: auto;
  min-height: auto;
}
.bulk-select {
  width: auto;
  min-height: auto;
}
input, select, textarea {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text);
  padding: 9px 10px;
  font: inherit;
}
textarea { min-height: 120px; resize: vertical; }
input[readonly], textarea[readonly] { background: #f3f4f6; color: var(--muted); }
.actions, .command-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
.command-row {
  justify-content: flex-start;
  border-top: 1px solid var(--border);
  padding-top: 16px;
}
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 650;
  text-decoration: none;
  cursor: pointer;
}
.button.primary {
  border-color: var(--primary);
  background: var(--primary);
  color: #fff;
}
.button.primary:hover { background: var(--primary-dark); }
.button.danger {
  border-color: #fecdca;
  color: var(--danger);
}
@media (max-width: 760px) {
  body {
    font-size: 15px;
  }
  .mobile-shell-header {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .sidebar {
    display: none;
  }
  .main { margin-left: 0; padding: 16px; }
  .topbar {
    margin-bottom: 14px;
  }
  h1 { font-size: 26px; }
  .home-overview {
    grid-template-columns: 1fr;
    align-items: start;
    gap: 14px;
  }
  .home-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .home-card-grid,
  .workspace-grid {
    grid-template-columns: 1fr;
  }
  .list-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .toolbar-main,
  .toolbar-aside {
    align-items: stretch;
  }
  .toolbar-main .button,
  .toolbar-main form,
  .toolbar-main button {
    flex: 1 1 auto;
  }
  .record-count {
    justify-content: center;
    width: 100%;
  }
  .document-table,
  .document-table thead,
  .document-table tbody,
  .document-table tr,
  .document-table th,
  .document-table td,
  .responsive-table,
  .responsive-table thead,
  .responsive-table tbody,
  .responsive-table tr,
  .responsive-table th,
  .responsive-table td {
    display: block;
  }
  .document-table thead,
  .responsive-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .document-table tbody,
  .responsive-table tbody {
    display: grid;
    gap: 10px;
    padding: 10px;
  }
  .document-table tr,
  .responsive-table tr {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }
  .document-table td,
  .responsive-table td {
    display: grid;
    grid-template-columns: minmax(88px, 0.36fr) minmax(0, 1fr);
    align-items: start;
    gap: 12px;
    min-width: 0;
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .document-table td:last-child,
  .responsive-table td:last-child {
    border-bottom: 0;
  }
  .document-table td::before,
  .responsive-table td::before {
    content: attr(data-label);
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    overflow-wrap: normal;
  }
  .document-table td[data-label="Name"],
  .responsive-table td[data-label="Name"],
  .responsive-table td[data-label="Document"],
  .responsive-table td[data-label="Filename"],
  .responsive-table td[data-label="Report"],
  .responsive-table td[data-label="Build Report"],
  .responsive-table td[data-label="Dashboard"],
  .responsive-table td[data-label="Kanban"],
  .responsive-table td[data-label="Calendar"],
  .responsive-table td[data-label="Saved Report"],
  .responsive-table td[data-label="Job"],
  .responsive-table td[data-label="Patch"],
  .responsive-table td[data-label="Description"],
  .responsive-table td[data-label="Columns"],
  .responsive-table td[data-label="Applicable DocTypes"],
  .responsive-table td[data-label="Recipients"],
  .responsive-table td[data-label="Assignees"],
  .responsive-table td[data-label="Condition"],
  .responsive-table td[data-label="Subject"],
  .responsive-table td[data-label="Event"],
  .responsive-table td[data-label="Action"],
  .responsive-table td[data-label="Actions"],
  .responsive-table td[data-label="Result / Error"],
  .responsive-table td[data-label="Retry"] {
    align-items: flex-start;
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .responsive-table td[data-label="Action"] .inline-action,
  .responsive-table td[data-label="Actions"] .inline-action,
  .responsive-table td[data-label="Action"] .data-patch-actions,
  .responsive-table td[data-label="Actions"] .data-patch-actions {
    width: 100%;
  }
  .responsive-table .data-patch-queue-action {
    grid-template-columns: 1fr;
  }
  .responsive-table .data-patch-command-action {
    flex-wrap: wrap;
  }
  .desk-disclosure > summary {
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }
  .form-action-bar {
    top: 61px;
    align-items: stretch;
    flex-direction: column;
  }
  .form-action-buttons {
    justify-content: flex-start;
  }
  .actions {
    justify-content: flex-start;
  }
  .actions .button {
    flex: 1 1 128px;
  }
  .topbar, .form-head { align-items: flex-start; flex-direction: column; }
  .fields { grid-template-columns: 1fr; }
  .quick-filter-choice { grid-template-columns: 1fr; }
  .report-formula-builder { grid-template-columns: 1fr; }
  .compound-filter-group-head,
  .compound-filter-group-actions { align-items: stretch; flex-direction: column; }
  .compound-filter-row { grid-template-columns: 1fr; }
  .timeline-assignment-form { grid-template-columns: 1fr; }
}`;
}
