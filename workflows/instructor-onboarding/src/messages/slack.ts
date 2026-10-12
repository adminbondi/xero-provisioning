import type { SlackMessage } from "../types.ts";

export { buildSlackMessage, setupCheckLines, type SetupFacts, type SetupCheckLine } from "./setup-check.ts";

function escapeMrkdwn(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Person-check flag. No TFN, bank, BSB, ABN, or super member number. */
export function buildXeroHoldMessage(input: {
  recordId: string;
  firstName: string;
  lastName: string;
  employeeIds: readonly string[];
  contactIds: readonly string[];
  channel: string;
}): SlackMessage {
  const name = escapeMrkdwn(`${input.firstName} ${input.lastName}`.trim());
  const lines = [
    "Instructor onboarding is held for a person to check.",
    `Airtable record: ${escapeMrkdwn(input.recordId)}`,
    `Name: ${name}`,
    `Xero employees: ${input.employeeIds.length > 0 ? input.employeeIds.map(escapeMrkdwn).join(", ") : "none"}`,
    `Xero contacts: ${input.contactIds.length > 0 ? input.contactIds.map(escapeMrkdwn).join(", ") : "none"}`,
    "The name matched in Xero and the email did not. Nothing was created.",
  ];
  return { channel: input.channel, text: lines.join("\n") };
}
