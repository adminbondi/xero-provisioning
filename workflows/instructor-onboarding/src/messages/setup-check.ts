import { airtableInboxUrl, contactActivityUrl, employeeDetailsUrl } from "../config.ts";
import type { SlackMessage } from "../types.ts";

/** True when the contact phone is `+61` plus a space and does not keep the trunk 0. */
export function contactMobileOk(mobile: string | null): boolean {
  return typeof mobile === "string" && /^\+61 [1-9]/.test(mobile);
}

export interface SetupFacts {
  superFundId: string | null;
  expectedSuperFundId: string;
  contributionType: string | null;
  calculationType: string | null;
  expenseAccountCode: string | null;
  liabilityAccountCode: string | null;
  /** Blank is the intended Fixed Amount. It must not fail this check. */
  fixedAmountBlank: boolean;
  memberNumberPresent: boolean;
  abnPresent: boolean;
  employmentType: string | null;
  incomeType: string | null;
  genderPresent: boolean;
  weeklyCalendar: boolean;
  residencyStatus: string | null;
  tfnPresent: boolean;
  mobile: string | null;
  /** Ivan's contact has no default purchase account, so blank is a pass. */
  purchaseAccountCode: string | null;
  bankDetailsPresent: boolean;
  gstOnExpenses: boolean;
}

export interface SetupCheckLine {
  label: string;
  ok: boolean;
}

export function setupCheckLines(facts: SetupFacts): SetupCheckLine[] {
  const superLineOk =
    facts.superFundId === facts.expectedSuperFundId &&
    facts.contributionType === "SGC" &&
    facts.calculationType === "FIXEDAMOUNT" &&
    facts.expenseAccountCode === "478" &&
    facts.liabilityAccountCode === "826";
  void facts.fixedAmountBlank;
  return [
    { label: "Super line AustralianSuper SGC Fixed Amount accounts 478 and 826", ok: superLineOk },
    { label: "Super member number", ok: facts.memberNumberPresent },
    { label: "ABN", ok: facts.abnPresent },
    {
      label: "Contractor with Non-Employee income type",
      ok: facts.employmentType === "CONTRACTOR" && facts.incomeType === "NONEMPLOYEE",
    },
    { label: "Gender", ok: facts.genderPresent },
    { label: "Weekly pay calendar", ok: facts.weeklyCalendar },
    { label: "Residency", ok: facts.residencyStatus === "AUSTRALIANRESIDENT" },
    { label: "TFN on file", ok: facts.tfnPresent },
    { label: "Mobile format", ok: contactMobileOk(facts.mobile) },
    { label: "Default purchase account", ok: facts.purchaseAccountCode == null || facts.purchaseAccountCode === "" },
    { label: "Bank details", ok: facts.bankDetailsPresent },
    { label: "GST on Expenses", ok: facts.gstOnExpenses },
  ];
}

function escapeMrkdwn(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Completion Slack message. Sensitive fields are PASS or MISSING, never the value.
 * Emergency contact stays in Airtable and is not a check, so it never changes this header.
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
  const attention = input.checks.some((check) => !check.ok);
  const title = attention
    ? `⚠️ *Onboarding needs attention*\n*${name}*`
    : `*${name}* has been fully onboarded in Xero ✅`;
  const lines = [
    title,
    `1. View ${name}'s Profile on Xero (${employeeDetailsUrl(input.employeeId, input.orgShortCode)})`,
    `2. Check ${name}'s Contact on Xero (${contactActivityUrl(input.contactId, input.orgShortCode)})`,
    `3. Open their Airtable record (${airtableInboxUrl(input.recordId)})`,
    "4. Check their ABN (https://abr.business.gov.au/)",
    "*Automatic checks*",
    ...input.checks.map((check) => `${check.ok ? "PASS" : "MISSING"} ${check.label}`),
    "*NOTE: they should have received an email from admin@balancemoves.com.au*",
  ];
  return { channel: input.channel, text: lines.join("\n") };
}
