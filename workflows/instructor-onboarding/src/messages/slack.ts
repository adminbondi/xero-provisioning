import {
  abrAbnUrl,
  airtableInboxUrl,
  contactActivityUrl,
  employeeDetailsUrl,
  type WorkflowConfig,
} from "../config.ts";
import { instructorFullName } from "../mappings/contact.ts";
import type { InstructorRecord, SlackMessage } from "../types.ts";

function escapeMrkdwn(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function buildSlackMessage(input: {
  record: InstructorRecord;
  employeeId: string;
  contactId: string;
  config: WorkflowConfig;
}): SlackMessage {
  const { record, config } = input;
  const fullName = instructorFullName(record);
  const abr = abrAbnUrl(record.abn);
  const lines = [
    `${escapeMrkdwn(fullName)} has successfully been created in Xero`,
    "",
    employeeDetailsUrl(input.employeeId, config.orgShortCode),
    contactActivityUrl(input.contactId, config.orgShortCode),
    config.confluenceGuideUrl,
    airtableInboxUrl(record.recordId),
    "",
    `Name: ${escapeMrkdwn(fullName)}`,
    `Email: ${escapeMrkdwn(record.email)}`,
    `Mobile: ${escapeMrkdwn(record.mobile)}`,
    `Bank: ${escapeMrkdwn(record.account)}`,
    `BSB: ${escapeMrkdwn(record.bsb)}`,
    `ABN: ${escapeMrkdwn(record.abn)} (${abr})`,
    `TFN: ${escapeMrkdwn(record.tfn)}`,
    `Super fund: ${escapeMrkdwn(record.superFund)}`,
    `Member no: ${escapeMrkdwn(record.memberNumber)}`,
    "",
    "Note: admin@balancemoves.com.au emails the instructor to confirm these details.",
  ];
  return { channel: config.slackChannelId, text: lines.join("\n") };
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
