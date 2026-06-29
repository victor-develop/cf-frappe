import {
  defineDocType,
  defineWebForm,
  isMissingRequiredWebFormValue,
  isPublishedWebFormForActor,
  resolveWebFormMetadata,
  SYSTEM_MANAGER_ROLE,
  webFormSubmissionData,
  webFormSubmitResult,
  type DocumentSnapshot
} from "../../src";
import { guest, owner } from "../helpers";

const Lead = defineDocType({
  name: "Lead",
  fields: [
    { name: "title", type: "text", label: "Title", required: true, placeholder: "Jane Buyer" },
    { name: "email", type: "text", placeholder: "jane@example.com" },
    { name: "priority", type: "select", options: ["Low", "High"] },
    { name: "account", type: "link", linkTo: "Account" },
    { name: "accepted", type: "boolean" },
    { name: "created_by", type: "text", readOnly: true }
  ]
});

const LeadForm = defineWebForm({
  name: "Lead Intake",
  route: "lead/intake",
  doctype: "Lead",
  fields: [
    { field: "title", label: "Name", description: "Your full name", required: true },
    { field: "email" },
    { field: "priority" },
    { field: "account" },
    { field: "accepted" }
  ]
});

describe("web form policy", () => {
  it("allows unpublished forms only for system managers", () => {
    const draft = defineWebForm({
      ...LeadForm,
      name: "Draft Lead Intake",
      published: false
    });

    expect(isPublishedWebFormForActor(guest, draft)).toBe(false);
    expect(isPublishedWebFormForActor(owner, draft)).toBe(false);
    expect(isPublishedWebFormForActor({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE] }, draft)).toBe(true);
  });

  it("resolves Web Form metadata from effective create metadata", () => {
    expect(resolveWebFormMetadata(LeadForm, Lead)).toEqual({
      form: LeadForm,
      doctype: "Lead",
      fields: [
        {
          field: "title",
          label: "Name",
          description: "Your full name",
          placeholder: "Jane Buyer",
          type: "text",
          required: true
        },
        {
          field: "email",
          label: "email",
          placeholder: "jane@example.com",
          type: "text",
          required: false
        },
        {
          field: "priority",
          label: "priority",
          type: "select",
          required: false,
          options: ["Low", "High"]
        },
        {
          field: "account",
          label: "account",
          type: "link",
          required: false,
          linkTo: "Account"
        },
        {
          field: "accepted",
          label: "accepted",
          type: "boolean",
          required: false
        }
      ]
    });
  });

  it("builds submission document data only from declared fields", () => {
    const metadata = resolveWebFormMetadata(LeadForm, Lead);

    expect(webFormSubmissionData(metadata, {
      data: {
        title: "Jane Buyer",
        email: "jane@example.com",
        priority: "High",
        account: "Acme",
        accepted: true,
        created_by: "attacker@example.com"
      }
    })).toEqual({
      title: "Jane Buyer",
      email: "jane@example.com",
      priority: "High",
      account: "Acme",
      accepted: true
    });
  });

  it("rejects missing required Web Form values before command execution", () => {
    const metadata = resolveWebFormMetadata(LeadForm, Lead);

    expect(isMissingRequiredWebFormValue(undefined)).toBe(true);
    expect(isMissingRequiredWebFormValue(null)).toBe(true);
    expect(isMissingRequiredWebFormValue("")).toBe(true);
    expect(isMissingRequiredWebFormValue(false)).toBe(false);
    expect(() => webFormSubmissionData(metadata, { data: { email: "jane@example.com" } }))
      .toThrow("Web form field 'title' is required");
  });

  it("shapes submit results with the resolved form identity", () => {
    const metadata = resolveWebFormMetadata(LeadForm, Lead);
    const document = snapshot({ title: "Jane Buyer" });

    expect(webFormSubmitResult(metadata, document)).toEqual({
      form: LeadForm,
      document
    });
  });
});

function snapshot(data: DocumentSnapshot["data"]): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Lead",
    name: "Jane Buyer",
    version: 1,
    docstatus: "draft",
    data,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
