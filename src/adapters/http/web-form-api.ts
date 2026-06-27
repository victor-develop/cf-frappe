import { Hono } from "hono";
import { badRequest } from "../../core/errors.js";
import type { Actor, JsonValue } from "../../core/types.js";
import type { WebFormResolvedField, WebFormService } from "../../application/web-form-service.js";
import type { ActorResolver } from "./actor.js";
import { readJsonObject, requestMetadata } from "./request.js";
import { escapeHtml, resolveWebsitePresentation, websitePage, type WebsitePresentation, type WebsiteSettingsReader } from "./website-rendering.js";

export interface WebFormApiOptions {
  readonly webForms: WebFormService;
  readonly websiteSettings?: WebsiteSettingsReader;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

const DEFAULT_MAX_JSON_BYTES = 1_000_000;

export function createWebFormApi(options: WebFormApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? DEFAULT_MAX_JSON_BYTES;

  app.get("/api/meta/web-forms", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.webForms.listWebForms(actor) });
  });

  app.get("/api/meta/web-forms/:webForm", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.webForms.getWebForm(actor, c.req.param("webForm")) });
  });

  app.post("/api/web-form/:webForm/submit", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = webFormDataFromBody(body);
    const result = await options.webForms.submitWebForm(actor, c.req.param("webForm"), {
      data,
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: result }, 201);
  });

  app.get("/web-forms", async (c) => {
    const actor = await options.actor(c.req.raw);
    const forms = await options.webForms.listWebForms(actor);
    return html(renderWebFormList(forms.map((form) => ({
      name: form.name,
      label: form.label ?? form.name,
      ...(form.route === undefined ? {} : { route: form.route }),
      description: form.description ?? form.module ?? ""
    })), await resolveWebsitePresentation(options.websiteSettings, actor)));
  });

  app.get("/web-forms/:webForm{.+}", async (c) => {
    const actor = await options.actor(c.req.raw);
    const metadata = await getPublicWebForm(options.webForms, actor, c.req.param("webForm"));
    return html(renderWebForm(metadata, await resolveWebsitePresentation(options.websiteSettings, actor)));
  });

  app.get("/web-forms/:webForm", async (c) => {
    const actor = await options.actor(c.req.raw);
    const metadata = await getPublicWebForm(options.webForms, actor, c.req.param("webForm"));
    return html(renderWebForm(metadata, await resolveWebsitePresentation(options.websiteSettings, actor)));
  });

  app.post("/web-forms/:webForm{.+}", async (c) => {
    const actor = await options.actor(c.req.raw);
    return submitPublicWebForm(options, actor, c.req.raw, c.req.param("webForm"));
  });

  app.post("/web-forms/:webForm", async (c) => {
    const actor = await options.actor(c.req.raw);
    return submitPublicWebForm(options, actor, c.req.raw, c.req.param("webForm"));
  });

  return app;
}

function webFormDataFromBody(body: Record<string, JsonValue | undefined>): Record<string, JsonValue | undefined> {
  const data = body.data;
  if (data === undefined) {
    return body;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw badRequest("Web form data must be an object");
  }
  return data as Record<string, JsonValue | undefined>;
}

function dataFromFormData(
  formData: FormData,
  fields: readonly WebFormResolvedField[]
): Record<string, JsonValue | undefined> {
  const data: Record<string, JsonValue | undefined> = {};
  for (const field of fields) {
    const raw = formData.get(field.field);
    data[field.field] = valueFromFormData(raw, field);
  }
  return data;
}

function valueFromFormData(value: FormDataEntryValue | null, field: WebFormResolvedField): JsonValue | undefined {
  if (field.type === "boolean") {
    return value !== null;
  }
  if (value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw badRequest(`Web form field '${field.field}' must be text`);
  }
  if (value === "") {
    return undefined;
  }
  if (field.type === "integer") {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      throw badRequest(`Web form field '${field.field}' must be an integer`);
    }
    return parsed;
  }
  if (field.type === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw badRequest(`Web form field '${field.field}' must be a number`);
    }
    return parsed;
  }
  if (field.type === "json") {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      throw badRequest(`Web form field '${field.field}' must contain valid JSON`);
    }
  }
  return value;
}

interface WebFormListItem {
  readonly name: string;
  readonly label: string;
  readonly route?: string;
  readonly description: string;
}

function renderWebFormList(forms: readonly WebFormListItem[], presentation: WebsitePresentation): string {
  const rows = forms
    .map(
      (form) => `<li><a href="${escapeHtml(webFormPublicHref(form))}">${escapeHtml(form.label)}</a>${form.description ? `<span>${escapeHtml(form.description)}</span>` : ""}</li>`
    )
    .join("");
  return websitePage("Web Forms", `<main class="web-form-main"><h1>Web Forms</h1><ul class="web-form-list">${rows || "<li>No web forms.</li>"}</ul></main>`, presentation, {
    styles: WEB_FORM_STYLES
  });
}

async function getPublicWebForm(
  webForms: WebFormService,
  actor: Actor,
  identifier: string
): Promise<Awaited<ReturnType<WebFormService["getWebForm"]>>> {
  try {
    return await webForms.getWebFormByRoute(actor, identifier);
  } catch (error) {
    if (!isWebFormNotFound(error)) {
      throw error;
    }
  }
  return webForms.getWebForm(actor, identifier);
}

async function submitPublicWebForm(
  options: WebFormApiOptions,
  actor: Actor,
  request: Request,
  identifier: string
): Promise<Response> {
  const metadata = await getPublicWebForm(options.webForms, actor, identifier);
  const formData = await request.formData();
  const result = await options.webForms.submitWebForm(actor, metadata.form.name, {
    data: dataFromFormData(formData, metadata.fields),
    metadata: requestMetadata(request)
  });
  return html(renderWebFormSuccess(
    metadata.form.label ?? metadata.form.name,
    result.document.name,
    metadata.form.successMessage,
    metadata.form.successUrl,
    await resolveWebsitePresentation(options.websiteSettings, actor)
  ), 201);
}

function webFormPublicHref(form: WebFormListItem): string {
  return `/web-forms/${form.route ?? encodeURIComponent(form.name)}`;
}

function isWebFormNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "WEB_FORM_NOT_FOUND";
}

function renderWebForm(metadata: Awaited<ReturnType<WebFormService["getWebForm"]>>, presentation: WebsitePresentation): string {
  const title = metadata.form.label ?? metadata.form.name;
  const fields = metadata.fields.map(renderWebFormField).join("");
  const description = metadata.form.description ? `<p>${escapeHtml(metadata.form.description)}</p>` : "";
  return websitePage(title, `<main class="web-form-main"><h1>${escapeHtml(title)}</h1>${description}<form method="post">${fields}<button type="submit">${escapeHtml(metadata.form.submitLabel ?? "Submit")}</button></form></main>`, presentation, {
    styles: WEB_FORM_STYLES
  });
}

function renderWebFormField(field: WebFormResolvedField): string {
  const required = field.required ? " required" : "";
  const help = field.description === undefined ? "" : `<small>${escapeHtml(field.description)}</small>`;
  const label = `<span>${escapeHtml(field.label)}${field.required ? " *" : ""}</span>`;
  const name = escapeHtml(field.field);
  if (field.type === "longText" || field.type === "json") {
    return `<label>${label}<textarea name="${name}"${required}></textarea>${help}</label>`;
  }
  if (field.type === "select") {
    const options = (field.options ?? [])
      .map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
      .join("");
    return `<label>${label}<select name="${name}"${required}><option value=""></option>${options}</select>${help}</label>`;
  }
  if (field.type === "boolean") {
    return `<label class="checkbox"><input type="checkbox" name="${name}" value="1"><span>${escapeHtml(field.label)}</span>${help}</label>`;
  }
  return `<label>${label}<input name="${name}" type="${inputType(field.type)}"${required}>${help}</label>`;
}

function renderWebFormSuccess(
  title: string,
  documentName: string,
  message: string | undefined,
  successUrl: string | undefined,
  presentation: WebsitePresentation
): string {
  const continueLink = successUrl === undefined ? "" : `<p><a class="web-form-continue" href="${escapeHtml(successUrl)}">Continue</a></p>`;
  return websitePage(title, `<main class="web-form-main"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message ?? "Submitted successfully.")}</p><p>Document: ${escapeHtml(documentName)}</p>${continueLink}</main>`, presentation, {
    styles: WEB_FORM_STYLES
  });
}

function inputType(type: WebFormResolvedField["type"]): string {
  if (type === "integer" || type === "number") {
    return "number";
  }
  if (type === "date") {
    return "date";
  }
  if (type === "datetime") {
    return "datetime-local";
  }
  return "text";
}

const WEB_FORM_STYLES = `
.web-form-main { width: min(720px, calc(100vw - 32px)); padding: 24px; background: var(--cf-frappe-surface); border: 1px solid color-mix(in srgb, var(--cf-frappe-muted-text) 28%, transparent); border-radius: 8px; }
.web-form-main h1 { font-size: 28px; line-height: 1.2; }
form { display: grid; gap: 16px; }
label { display: grid; gap: 6px; font-weight: 600; }
input, textarea, select { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; }
textarea { min-height: 120px; resize: vertical; }
small, .web-form-list span { color: var(--cf-frappe-muted-text); font-weight: 400; }
.checkbox { display: flex; align-items: center; gap: 8px; }
.checkbox input { width: auto; }
button { width: fit-content; padding: 10px 14px; border: 0; border-radius: 6px; color: #fff; background: var(--cf-frappe-primary); font: inherit; font-weight: 700; cursor: pointer; }
.web-form-continue { display: inline-flex; width: fit-content; padding: 10px 14px; border-radius: 6px; color: #fff; background: var(--cf-frappe-primary); font-weight: 700; text-decoration: none; }
.web-form-list { display: grid; gap: 12px; padding: 0; list-style: none; }
.web-form-list li { display: grid; gap: 2px; }
`;

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}
