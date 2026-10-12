import { EMAIL_SUBJECT, type WorkflowConfig } from "../config.ts";
import { airtableFieldText } from "../airtable/parse-record.ts";
import { MissingFieldsError } from "../errors.ts";
import type { InstructorRecord, OutboundEmail } from "../types.ts";

/**
 * Zap 364623444 step 7 body, copied from Thiago's verbatim export (12 Oct 2026).
 * The parenthetical on Superannuation Fund Name in that note is an instruction, not email copy.
 * The export says the admin@ Gmail signature is appended with the signature delimiter on.
 * The signature HTML itself was not in the export, so it is not invented here.
 */
export const INSTRUCTOR_EMAIL_FIELDS = {
  firstName: "First Name",
  email: "Email",
  bankAccountNumber: "Bank Account Number",
  bsb: "BSB",
  abn: "ABN",
  tfn: "TFN",
  superannuationFundName: "Superannuation Fund Name",
  memberNumber: "Superannuation Member Number",
} as const;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export interface InstructorEmailValues {
  firstName: string;
  email: string;
  bankAccountNumber: string;
  bsb: string;
  abn: string;
  tfn: string;
  superannuationFundName: string;
  memberNumber: string;
}

/** Raw Airtable values. Superannuation Fund Name is not the Xero super-fund lookup. */
export function instructorEmailValues(record: InstructorRecord): InstructorEmailValues {
  const fields = record.rawFields;
  const values: InstructorEmailValues = {
    firstName: airtableFieldText(fields, INSTRUCTOR_EMAIL_FIELDS.firstName),
    email: airtableFieldText(fields, INSTRUCTOR_EMAIL_FIELDS.email),
    bankAccountNumber: airtableFieldText(fields, INSTRUCTOR_EMAIL_FIELDS.bankAccountNumber),
    bsb: airtableFieldText(fields, INSTRUCTOR_EMAIL_FIELDS.bsb),
    abn: airtableFieldText(fields, INSTRUCTOR_EMAIL_FIELDS.abn),
    tfn: airtableFieldText(fields, INSTRUCTOR_EMAIL_FIELDS.tfn),
    superannuationFundName: airtableFieldText(fields, INSTRUCTOR_EMAIL_FIELDS.superannuationFundName),
    memberNumber: airtableFieldText(fields, INSTRUCTOR_EMAIL_FIELDS.memberNumber),
  };
  const missing = Object.entries(values)
    .filter(([, value]) => value.length === 0)
    .map(([key]) => INSTRUCTOR_EMAIL_FIELDS[key as keyof typeof INSTRUCTOR_EMAIL_FIELDS]);
  if (missing.length > 0) throw new MissingFieldsError(missing);
  return values;
}

export function renderInstructorEmailHtml(values: InstructorEmailValues): string {
  const firstName = escapeHtml(values.firstName);
  const bankAccountNumber = escapeHtml(values.bankAccountNumber);
  const bsb = escapeHtml(values.bsb);
  const abn = escapeHtml(values.abn);
  const tfn = escapeHtml(values.tfn);
  const superannuationFundName = escapeHtml(values.superannuationFundName);
  const memberNumber = escapeHtml(values.memberNumber);
  return [
    `<p>Hello ${firstName}, </p>`,
    `<p>Welcome again to Balance Moves! Thanks for submitting your details - we're looking forward to working with you!</p>`,
    `<p>We would like to kindly request that you to review and confirm the following details you've provided for payroll. Once you've done it, could you please reply to us confirming that it all looks right or if anything needs adjusting?</p>`,
    `<h3><strong>Tax Details</strong></h3>`,
    `<ul>`,
    `<li><strong>Bank Account Number:</strong> ${bankAccountNumber}</li>`,
    `<li><strong>BSB:</strong> ${bsb}</li>`,
    `<li><strong>ABN:</strong> ${abn}</li>`,
    `<li><strong>Confirm ABN is Registered for GST or NOT:</strong> https://abr.business.gov.au/ABN/View?id=${abn}</li>`,
    `<li><strong>TFN:</strong> ${tfn}</li>`,
    `</ul>`,
    `<h3><strong>Superannuation Information</strong></h3>`,
    `<ul>`,
    `<li><strong>Superannuation Fund Name:</strong> ${superannuationFundName}</li>`,
    `<li><strong>Superannuation Member Number:</strong> ${memberNumber}</li>`,
    `</ul>`,
    `<p>Please reply to this email confirming that all the above details are correct.</p>`,
    `<p>Thank you again.</p>`,
    `<p>Best regards,</p>`,
  ].join("\n");
}

export function buildInstructorEmail(record: InstructorRecord, config: WorkflowConfig): OutboundEmail {
  const values = instructorEmailValues(record);
  return {
    from: config.emailFrom,
    fromName: config.emailFromName,
    to: values.email,
    cc: [config.emailCc],
    bcc: [config.emailBcc],
    subject: EMAIL_SUBJECT,
    html: renderInstructorEmailHtml(values),
  };
}
