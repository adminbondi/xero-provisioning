import { airtableInboxUrl, contactActivityUrl, employeeDetailsUrl } from "../config.ts";
import type { SlackMessage, XeroContactPayload, XeroEmployeePayload } from "../types.ts";

/**
 * Omitted, blank, whitespace, or numeric zero. A non-zero Fixed Amount is set.
 * `0`, `"0"`, and `"0.00"` match a blank amount.
 */
export function fixedAmountIsBlank(amount: unknown): boolean {
  if (amount == null) return true;
  if (typeof amount === "number") return Number.isFinite(amount) && amount === 0;
  if (typeof amount !== "string") return false;
  const trimmed = amount.trim();
  if (trimmed === "") return true;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return false;
  return Number(trimmed) === 0;
}

export interface SetupFacts {
  superFundId: string | null;
  expectedSuperFundId: string;
  superFundName: string | null;
  contributionType: string | null;
  calculationType: string | null;
  expenseAccountCode: string | null;
  liabilityAccountCode: string | null;
  /** Blank or zero matches the Fixed Amount live leaves off the super line. */
  fixedAmountBlank: boolean;
  memberNumberPresent: boolean;
  abnPresent: boolean;
  employmentType: string | null;
  incomeType: string | null;
  genderPresent: boolean;
  weeklyCalendar: boolean;
  residencyStatus: string | null;
  tfnPresent: boolean;
  /** Phone read back from the contact. Compared with `expectedMobile`, not reformatted. */
  mobile: string | null;
  /** `+61` concatenated with the Airtable mobile. That is what live writes. */
  expectedMobile: string;
  /** Blank matches the contact live creates, which omits a purchase account. */
  purchaseAccountCode: string | null;
  bankDetailsPresent: boolean;
  gstOnExpenses: boolean;
  /** False when these facts were not read back from Xero. */
  readBack: boolean;
}

export type SetupCheckStatus = "pass" | "missing" | "not-checked";

export interface SetupCheckLine {
  label: string;
  ok: boolean;
  status: SetupCheckStatus;
}

export function superLineLabel(superFundName: string | null): string {
  const fund = superFundName?.trim() ? superFundName.trim() : "(unmapped fund)";
  return `Super line ${fund} SGC Fixed Amount accounts 478 and 826`;
}

function readBackLine(label: string, ok: boolean, readBack: boolean): SetupCheckLine {
  if (!readBack) return { label, ok: false, status: "not-checked" };
  return { label, ok, status: ok ? "pass" : "missing" };
}

export function setupCheckLines(facts: SetupFacts): SetupCheckLine[] {
  const superLineOk =
    facts.superFundId === facts.expectedSuperFundId &&
    facts.contributionType === "SGC" &&
    facts.calculationType === "FIXEDAMOUNT" &&
    facts.expenseAccountCode === "478" &&
    facts.liabilityAccountCode === "826" &&
    facts.fixedAmountBlank;
  const purchaseBlank = facts.purchaseAccountCode == null || facts.purchaseAccountCode === "";
  return [
    readBackLine(superLineLabel(facts.superFundName), superLineOk, facts.readBack),
    readBackLine("Super member number", facts.memberNumberPresent, facts.readBack),
    readBackLine("ABN", facts.abnPresent, facts.readBack),
    readBackLine(
      "Contractor with Non-Employee income type",
      facts.employmentType === "CONTRACTOR" && facts.incomeType === "NONEMPLOYEE",
      facts.readBack,
    ),
    readBackLine("Gender", facts.genderPresent, facts.readBack),
    readBackLine("Weekly pay calendar", facts.weeklyCalendar, facts.readBack),
    readBackLine("Residency", facts.residencyStatus === "AUSTRALIANRESIDENT", facts.readBack),
    readBackLine("TFN on file", facts.tfnPresent, facts.readBack),
    readBackLine("Mobile", facts.mobile === facts.expectedMobile, facts.readBack),
    readBackLine("Default purchase account", purchaseBlank, facts.readBack),
    readBackLine("Bank details", facts.bankDetailsPresent, facts.readBack),
    readBackLine("GST on Expenses", facts.gstOnExpenses, facts.readBack),
  ];
}

export function checkStatusText(status: SetupCheckStatus): string {
  if (status === "pass") return "PASS";
  if (status === "not-checked") return "not checked (dry run)";
  return "MISSING";
}

/** Facts Xero would return if it stored the employee, template, and contact just written. */
export function setupFactsFromWritten(input: {
  superFundId: string;
  superFundName: string | null;
  employee: XeroEmployeePayload;
  contact: XeroContactPayload;
  amount: unknown;
  calendarType: string | null;
  purchaseAccountCode: string | null;
}): SetupFacts {
  const membership = input.employee.SuperMemberships[0];
  const line = input.contact.Phones[0];
  return {
    superFundId: membership?.SuperFundID ?? null,
    expectedSuperFundId: input.superFundId,
    superFundName: input.superFundName,
    contributionType: "SGC",
    calculationType: "FIXEDAMOUNT",
    expenseAccountCode: "478",
    liabilityAccountCode: "826",
    fixedAmountBlank: fixedAmountIsBlank(input.amount),
    memberNumberPresent: Boolean(membership && membership.EmployeeNumber.trim().length > 0),
    abnPresent: input.employee.TaxDeclaration.ABN.trim().length > 0,
    employmentType: input.employee.EmploymentType,
    incomeType: input.employee.IncomeType,
    genderPresent: input.employee.Gender.trim().length > 0,
    weeklyCalendar: input.calendarType === "WEEKLY",
    residencyStatus: input.employee.TaxDeclaration.ResidencyStatus,
    tfnPresent: input.employee.TaxDeclaration.TaxFileNumber.trim().length > 0,
    mobile: line?.PhoneNumber ?? null,
    expectedMobile: line?.PhoneNumber ?? "",
    purchaseAccountCode: input.purchaseAccountCode,
    bankDetailsPresent: input.contact.BankAccountDetails.trim().length > 0,
    gstOnExpenses: input.contact.AccountsPayableTaxType === "INPUT",
    readBack: true,
  };
}

function escapeMrkdwn(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * End-check Slack report. Sensitive fields are PASS, MISSING, or not checked (dry run).
 * Never the value. "Fully onboarded" is only for a live read-back where every line passed.
 */
export function buildSlackMessage(input: {
  name: string;
  employeeId: string;
  contactId: string;
  recordId: string;
  orgShortCode: string;
  channel: string;
  checks: SetupCheckLine[];
}): SlackMessage {
  const name = escapeMrkdwn(input.name);
  const unread = input.checks.some((check) => check.status === "not-checked");
  const title = unread
    ? `*${name}* — not checked (dry run)`
    : input.checks.some((check) => check.status !== "pass")
      ? `⚠️ *Onboarding needs attention*\n*${name}*`
      : `*${name}* has been fully onboarded in Xero ✅`;
  const lines = [
    title,
    `1. View ${name}'s Profile on Xero (${employeeDetailsUrl(input.employeeId, input.orgShortCode)})`,
    `2. Check ${name}'s Contact on Xero (${contactActivityUrl(input.contactId, input.orgShortCode)})`,
    `3. Open their Airtable record (${airtableInboxUrl(input.recordId)})`,
    "4. Check their ABN (https://abr.business.gov.au/)",
    "*Automatic checks*",
    ...input.checks.map((check) => `${checkStatusText(check.status)} ${check.label}`),
    "*NOTE: they should have received an email from admin@balancemoves.com.au*",
  ];
  return { channel: input.channel, text: lines.join("\n") };
}
