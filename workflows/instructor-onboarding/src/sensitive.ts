import { airtableFieldText } from "./airtable/parse-record.ts";
import { contactBankAccount } from "./mappings/contact.ts";
import type { InstructorRecord } from "./types.ts";

/** Which payroll fields were on the row. The values themselves are not logged. */
export interface PayrollFieldPresence {
  tfn: boolean;
  bankAccount: boolean;
  bsb: boolean;
  abn: boolean;
  memberNumber: boolean;
}

interface Replacement {
  value: string;
  token: string;
}

const ERROR_KEYS = [
  "TaxFileNumber",
  "ABN",
  "TaxNumber",
  "EmployeeNumber",
  "BankAccountDetails",
  "BSB",
  "AccountNumber",
  "BankAccountNumber",
] as const;

export function payrollFieldPresence(record: InstructorRecord): PayrollFieldPresence {
  return {
    tfn: record.tfn.length > 0,
    bankAccount: record.account.length > 0 || bankAccountNumber(record).length > 0,
    bsb: record.bsb.length > 0,
    abn: record.abn.length > 0,
    memberNumber: record.memberNumber.length > 0,
  };
}

export function payrollReplacements(record: InstructorRecord): Replacement[] {
  const items: Replacement[] = [
    { value: record.tfn, token: "[TFN]" },
    { value: record.account, token: "[bank account]" },
    { value: bankAccountNumber(record), token: "[bank account]" },
    { value: contactBankAccount(record.bsb, record.account), token: "[bank account]" },
    { value: record.bsb, token: "[BSB]" },
    { value: record.abn, token: "[ABN]" },
    { value: record.memberNumber, token: "[member number]" },
  ];
  const seen = new Set<string>();
  return items.filter((item) => {
    if (item.value.length === 0 || seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
}

export function maskText(text: string, replacements: readonly Replacement[]): string {
  const ordered = [...replacements].sort((left, right) => right.value.length - left.value.length);
  let masked = text;
  for (const item of ordered) {
    masked = masked.split(item.value).join(item.token);
  }
  return masked;
}

/** Deep copy with payroll values replaced. Numbers that are exactly one of those values are replaced too. */
export function maskSecretsDeep(value: unknown, replacements: readonly Replacement[]): unknown {
  if (typeof value === "string") return maskText(value, replacements);
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    const hit = replacements.find((item) => item.value === String(value));
    return hit ? hit.token : value;
  }
  if (Array.isArray(value)) return value.map((item) => maskSecretsDeep(item, replacements));
  if (value && typeof value === "object") {
    const masked: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      masked[key] = maskSecretsDeep(item, replacements);
    }
    return masked;
  }
  return value;
}

/**
 * Error text from Xero or Google. TFN was already replaced here.
 * Bank account, BSB, ABN, and member number use the same JSON-field replacement.
 */
export function redactSensitiveError(text: string): string {
  let redacted = text
    .replace(/"access_token"\s*:\s*"[^"]*"/g, '"access_token":"[redacted]"')
    .replace(/"refresh_token"\s*:\s*"[^"]*"/g, '"refresh_token":"[redacted]"');
  for (const key of ERROR_KEYS) {
    redacted = redacted.replace(
      new RegExp(`"${key}"\\s*:\\s*(?:"[^"]*"|-?\\d+(?:\\.\\d+)?)`, "g"),
      `"${key}":"[redacted]"`,
    );
  }
  return redacted.slice(0, 300);
}

function bankAccountNumber(record: InstructorRecord): string {
  return airtableFieldText(record.rawFields, "Bank Account Number");
}
