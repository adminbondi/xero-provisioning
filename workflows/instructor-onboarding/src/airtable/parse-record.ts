import { AirtableFieldTypeError } from "../errors.ts";
import type { AirtableApiRecord, AirtableAttachment, InstructorRecord } from "../types.ts";

/** Labels as written in the Zap map. Not confirmed Airtable field ids. */
export const AIRTABLE_FIELDS = {
  firstName: "First Name",
  lastName: "Last Name",
  dateOfBirth: "DOB",
  email: "Email",
  gender: "Gender",
  mobile: "Mobile",
  superFund: "Super Fund",
  memberNumber: "Superannuation Member Number",
  tfn: "TFN",
  residentialAddress: "Residential Address",
  city: "City/Suburb",
  state: "State",
  postalCode: "Postal Code",
  abn: "ABN",
  bsb: "BSB",
  account: "Account",
} as const;

export const REQUIRED_FIELD_LABELS = [
  AIRTABLE_FIELDS.firstName,
  AIRTABLE_FIELDS.lastName,
  AIRTABLE_FIELDS.dateOfBirth,
  AIRTABLE_FIELDS.email,
  AIRTABLE_FIELDS.gender,
  AIRTABLE_FIELDS.mobile,
  AIRTABLE_FIELDS.superFund,
  AIRTABLE_FIELDS.memberNumber,
  AIRTABLE_FIELDS.tfn,
  AIRTABLE_FIELDS.residentialAddress,
  AIRTABLE_FIELDS.city,
  AIRTABLE_FIELDS.state,
  AIRTABLE_FIELDS.postalCode,
  AIRTABLE_FIELDS.abn,
  AIRTABLE_FIELDS.bsb,
  AIRTABLE_FIELDS.account,
] as const;

function readText(fields: Record<string, unknown>, key: string): string {
  if (!Object.prototype.hasOwnProperty.call(fields, key) || fields[key] == null) {
    return "";
  }
  const value = fields[key];
  if (typeof value === "string") {
    return value;
  }
  const type = Array.isArray(value) ? "array" : typeof value;
  throw new AirtableFieldTypeError(key, type);
}

function extractAttachments(fields: Record<string, unknown>): AirtableAttachment[] {
  const attachments: AirtableAttachment[] = [];
  for (const [field, value] of Object.entries(fields)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      if (typeof record.url !== "string" || typeof record.filename !== "string") continue;
      attachments.push({
        field,
        id: typeof record.id === "string" ? record.id : null,
        url: record.url,
        filename: record.filename,
      });
    }
  }
  return attachments;
}

export function parseAirtableRecord(raw: AirtableApiRecord): InstructorRecord {
  const fields =
    raw.fields && typeof raw.fields === "object" && !Array.isArray(raw.fields)
      ? (raw.fields as Record<string, unknown>)
      : {};
  return {
    recordId: typeof raw.id === "string" ? raw.id : "",
    createdTime: typeof raw.createdTime === "string" ? raw.createdTime : null,
    firstName: readText(fields, AIRTABLE_FIELDS.firstName),
    lastName: readText(fields, AIRTABLE_FIELDS.lastName),
    dateOfBirth: readText(fields, AIRTABLE_FIELDS.dateOfBirth),
    email: readText(fields, AIRTABLE_FIELDS.email),
    gender: readText(fields, AIRTABLE_FIELDS.gender),
    mobile: readText(fields, AIRTABLE_FIELDS.mobile),
    superFund: readText(fields, AIRTABLE_FIELDS.superFund),
    memberNumber: readText(fields, AIRTABLE_FIELDS.memberNumber),
    tfn: readText(fields, AIRTABLE_FIELDS.tfn),
    residentialAddress: readText(fields, AIRTABLE_FIELDS.residentialAddress),
    city: readText(fields, AIRTABLE_FIELDS.city),
    state: readText(fields, AIRTABLE_FIELDS.state),
    postalCode: readText(fields, AIRTABLE_FIELDS.postalCode),
    abn: readText(fields, AIRTABLE_FIELDS.abn),
    bsb: readText(fields, AIRTABLE_FIELDS.bsb),
    account: readText(fields, AIRTABLE_FIELDS.account),
    attachments: extractAttachments(fields),
    rawFields: structuredClone(fields),
  };
}

const REQUIRED_ON_RECORD: readonly { key: keyof InstructorRecord; label: string }[] = [
  { key: "recordId", label: "record id" },
  { key: "firstName", label: AIRTABLE_FIELDS.firstName },
  { key: "lastName", label: AIRTABLE_FIELDS.lastName },
  { key: "dateOfBirth", label: AIRTABLE_FIELDS.dateOfBirth },
  { key: "email", label: AIRTABLE_FIELDS.email },
  { key: "gender", label: AIRTABLE_FIELDS.gender },
  { key: "mobile", label: AIRTABLE_FIELDS.mobile },
  { key: "superFund", label: AIRTABLE_FIELDS.superFund },
  { key: "memberNumber", label: AIRTABLE_FIELDS.memberNumber },
  { key: "tfn", label: AIRTABLE_FIELDS.tfn },
  { key: "residentialAddress", label: AIRTABLE_FIELDS.residentialAddress },
  { key: "city", label: AIRTABLE_FIELDS.city },
  { key: "state", label: AIRTABLE_FIELDS.state },
  { key: "postalCode", label: AIRTABLE_FIELDS.postalCode },
  { key: "abn", label: AIRTABLE_FIELDS.abn },
  { key: "bsb", label: AIRTABLE_FIELDS.bsb },
  { key: "account", label: AIRTABLE_FIELDS.account },
];

export function missingFieldLabels(record: InstructorRecord): string[] {
  const missing: string[] = [];
  for (const field of REQUIRED_ON_RECORD) {
    const value = record[field.key];
    if (typeof value !== "string" || value.length === 0) {
      missing.push(field.label);
    }
  }
  if (record.dateOfBirth.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(record.dateOfBirth)) {
    missing.push("DOB (expected YYYY-MM-DD)");
  }
  return missing;
}
