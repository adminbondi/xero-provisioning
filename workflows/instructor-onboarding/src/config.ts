/**
 * Values copied from Zap 364623444. They are not secrets.
 * Optional env overrides exist so a host can change them without editing code.
 */

export const AIRTABLE_BASE_ID = "appePgXVPIIkgnvBQ";
export const AIRTABLE_TABLE_ID = "tblageJRycUMiyKGr";

/**
 * Hourly Instructors poll. One cron only: this replaces the Airtable automation and the
 * daily safety-net cron (`0 21 * * *`), which was never attached.
 * `0 * * * *` is minute 0 of every hour, UTC. 24 runs a day.
 */
export const AIRTABLE_POLL_CRON = "0 * * * *";

/** One list call per hourly run, when that run does not page. 24 × 30. */
export const AIRTABLE_POLL_CALLS_PER_30_DAY_MONTH = 24 * 30;

/** One list call per hourly run, when that run does not page. 24 × 31. */
export const AIRTABLE_POLL_CALLS_PER_31_DAY_MONTH = 24 * 31;

export const XERO_ORG_SHORTCODE = "!hGL34";
export const SLACK_CHANNEL_ID = "C09BK6Y2WHL";
export const EMAIL_FROM = "admin@balancemoves.com.au";
export const EMAIL_FROM_NAME = "Thiago & Yvette";
export const EMAIL_SUBJECT = "Instructor Onboarding: Please Confirm Your Details";

export const CONFLUENCE_GUIDE_URL = "https://balancemovesbondi.atlassian.net/wiki/x/CgBmH";
export const AIRTABLE_INBOX_URL_PREFIX =
  "https://airtable.com/appePgXVPIIkgnvBQ/pagwdybqbkTKfuNQX?sh4iX=";
export const ABR_ABN_URL_PREFIX = "https://abr.business.gov.au/ABN/View?id=";

export const CONTRACTORS_GROUP_NAME = "Contractors";
export const EMPLOYEE_HOME_STATE = "NSW";
export const ADDRESS_COUNTRY = "Australia";
export const START_DATE_TIMEZONE = "Australia/Sydney";

/** The published Zap's StartDate expression. The map says this means "today" and to verify it. */
export const ZAPIER_START_DATE_EXPRESSION = "{{=)}}";

export const STUDIO_PHONE = "0424 133 544";
export const STUDIO_WEB = "balancemoves.com.au";
export const STUDIO_ADDRESS = "72A-74 Hall Street Bondi Beach NSW 2026";

export interface WorkflowConfig {
  airtableBaseId: string;
  airtableTableId: string;
  orgShortCode: string;
  slackChannelId: string;
  emailFrom: string;
  emailFromName: string;
  emailCc: string;
  emailBcc: string;
  startDateTimeZone: string;
  confluenceGuideUrl: string;
  /** Weekly Xero payroll calendar. Set so the employee step is one POST, not a calendar list. */
  payrollCalendarId?: string;
  /** From `PATTY_WEBHOOK_URL`. Unset means the live webhook step is skipped. */
  pattyWebhookUrl?: string;
}

export function defaultConfig(): WorkflowConfig {
  return {
    airtableBaseId: AIRTABLE_BASE_ID,
    airtableTableId: AIRTABLE_TABLE_ID,
    orgShortCode: XERO_ORG_SHORTCODE,
    slackChannelId: SLACK_CHANNEL_ID,
    emailFrom: EMAIL_FROM,
    emailFromName: EMAIL_FROM_NAME,
    emailCc: EMAIL_FROM,
    emailBcc: EMAIL_FROM,
    startDateTimeZone: START_DATE_TIMEZONE,
    confluenceGuideUrl: CONFLUENCE_GUIDE_URL,
  };
}

/**
 * Channel for this run. Dry-run never falls through to the live channel.
 * A missing id fails closed so a preview cannot post into #management.
 */
export function slackChannelForRun(
  env: Readonly<{ SLACK_CHANNEL_ID?: string; SLACK_DRY_RUN_CHANNEL_ID?: string }>,
  dryRun: boolean,
): string {
  if (dryRun) {
    const channel = env.SLACK_DRY_RUN_CHANNEL_ID?.trim() ?? "";
    if (!channel) throw new Error("SLACK_DRY_RUN_CHANNEL_ID is not set.");
    return channel;
  }
  const channel = env.SLACK_CHANNEL_ID?.trim() ?? "";
  if (!channel) throw new Error("SLACK_CHANNEL_ID is not set.");
  return channel;
}

export function resolveConfig(env: Readonly<Record<string, string | undefined>> = {}): WorkflowConfig {
  const base = defaultConfig();
  return {
    airtableBaseId: env.AIRTABLE_BASE_ID || base.airtableBaseId,
    airtableTableId: env.AIRTABLE_TABLE_ID || base.airtableTableId,
    orgShortCode: env.XERO_ORG_SHORTCODE || base.orgShortCode,
    slackChannelId: env.SLACK_CHANNEL_ID || base.slackChannelId,
    emailFrom: env.EMAIL_FROM || base.emailFrom,
    emailFromName: env.EMAIL_FROM_NAME || base.emailFromName,
    emailCc: env.EMAIL_CC || env.EMAIL_FROM || base.emailCc,
    emailBcc: env.EMAIL_BCC || env.EMAIL_FROM || base.emailBcc,
    startDateTimeZone: env.START_DATE_TIMEZONE || base.startDateTimeZone,
    confluenceGuideUrl: env.CONFLUENCE_GUIDE_URL || base.confluenceGuideUrl,
    payrollCalendarId: env.XERO_WEEKLY_PAYROLL_CALENDAR_ID || undefined,
    pattyWebhookUrl: env.PATTY_WEBHOOK_URL?.trim() || undefined,
  };
}

export function employeeDetailsUrl(employeeId: string, shortcode: string): string {
  return `https://go.xero.com/app/${shortcode}/payroll/employee/${employeeId}/details`;
}

export function contactActivityUrl(contactId: string, shortcode: string): string {
  return `https://go.xero.com/app/${shortcode}/contacts/contact/${contactId}/activity`;
}

export function airtableInboxUrl(recordId: string): string {
  return `${AIRTABLE_INBOX_URL_PREFIX}${encodeURIComponent(recordId)}`;
}

export function abrAbnUrl(abn: string): string {
  return `${ABR_ABN_URL_PREFIX}${encodeURIComponent(abn)}`;
}
