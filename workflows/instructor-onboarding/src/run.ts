import { missingFieldLabels, parseAirtableRecord } from "./airtable/parse-record.ts";
import { resolveStartDate } from "./clock.ts";
import { ZAPIER_START_DATE_EXPRESSION, defaultConfig, type WorkflowConfig } from "./config.ts";
import { MissingFieldsError, PayrollCalendarError } from "./errors.ts";
import { PIPELINE_STEPS, STEP_CONFIG, type StepDo } from "./host/step-config.ts";
import { lookupGender } from "./lookups/gender.ts";
import { lookupSuperFund } from "./lookups/super-funds.ts";
import { buildContactPayload, instructorFullName } from "./mappings/contact.ts";
import { buildEmployeePayload, buildPayTemplate, employeeIdempotencyKey } from "./mappings/employee.ts";
import { buildInstructorEmail } from "./messages/email.ts";
import { buildSlackMessage, buildXeroHoldMessage, setupCheckLines, type SetupFacts } from "./messages/slack.ts";
import { ODDITIES } from "./oddities.ts";
import { maskSecretsDeep, maskText, payrollFieldPresence, payrollReplacements } from "./sensitive.ts";
import type { EmployeeDetails, Ports, XeroEmployeePort } from "./ports.ts";
import type {
  AirtableApiRecord,
  InstructorRecord,
  RunMode,
  SlackMessage,
  WorkflowSuccess,
  XeroContactPayload,
  XeroEmployeePayload,
} from "./types.ts";

export { PIPELINE_STEPS } from "./host/step-config.ts";
export type { PipelineStepName, StepConfig, StepDo } from "./host/step-config.ts";

export interface RunDeps {
  ports: Ports;
  mode: RunMode;
  now?: () => Date;
  config?: WorkflowConfig;
  /**
   * Persisted `step.do` results for one Workflow instance.
   * Cloudflare Workflows does this itself. Tests pass a Map to resume a failed step
   * without repeating earlier steps. A fresh Map is a new instance.
   */
  stepCache?: Map<string, unknown>;
  /**
   * Workflow instance id. Included in the Xero employee idempotency key so a
   * retry instance is not refused for reusing the failed request's key.
   * Defaults to the Airtable record id, which is the first live instance id.
   */
  instanceId?: string;
}

export interface XeroMatchResult {
  disposition: "create" | "skip-email" | "hold-name";
  reason: "dry-run" | "no-match" | "email" | "name";
  employeeIds: string[];
  contactIds: string[];
}

interface EmployeeStepResult {
  action: "create" | "reuse" | "skip-email" | "hold-name";
  employeeId: string | null;
  created: boolean;
  payload: XeroEmployeePayload;
  startDate: string;
}

interface ContactStepResult {
  action: "create" | "update" | "skip-email" | "hold-name";
  contactId: string | null;
  created: boolean;
  payload: XeroContactPayload;
}

interface SlackStepResult extends SlackMessage {
  sent: boolean;
}

interface EmailStepResult {
  sent: boolean;
  message: WorkflowSuccess["email"]["message"];
}

type EmployeeReadResult = WorkflowSuccess["employeeRead"];
type PayTemplateResult = WorkflowSuccess["payTemplate"];

function configOf(deps: RunDeps): WorkflowConfig {
  return deps.config ?? defaultConfig();
}

function memoStep(cache: Map<string, unknown>): StepDo {
  return {
    async do(name, _config, callback) {
      if (cache.has(name)) return cache.get(name) as Awaited<ReturnType<typeof callback>>;
      const value = await callback();
      cache.set(name, value);
      return value;
    },
  };
}

/** One GET. Used by an operator to copy the weekly calendar id into XERO_WEEKLY_PAYROLL_CALENDAR_ID. Not called from a workflow step. */
export async function resolveWeeklyPayrollCalendar(employees: XeroEmployeePort): Promise<string> {
  const calendars = await employees.listPayrollCalendars();
  const weekly = calendars.filter((calendar) => calendar.calendarType === "WEEKLY");
  if (weekly.length === 0) {
    throw new PayrollCalendarError("No WEEKLY payroll calendar in this Xero org. The Zap says Weekly and does not give an id.");
  }
  if (weekly.length > 1) {
    const names = weekly.map((calendar) => calendar.name).join(", ");
    throw new PayrollCalendarError(
      `Multiple WEEKLY payroll calendars (${names}). The Zap says Weekly and does not give an id.`,
    );
  }
  return weekly[0]!.payrollCalendarId;
}

function requireCalendarId(config: WorkflowConfig): string {
  if (!config.payrollCalendarId) {
    throw new PayrollCalendarError(
      "XERO_WEEKLY_PAYROLL_CALENDAR_ID is not set. The employee step does not list calendars.",
    );
  }
  return config.payrollCalendarId;
}

export async function runOnboardingSteps(
  raw: AirtableApiRecord,
  deps: RunDeps,
  step: StepDo = memoStep(deps.stepCache ?? new Map()),
): Promise<WorkflowSuccess> {
  const config = configOf(deps);
  const now = deps.now?.() ?? new Date();

  const record = await step.do("airtable-record", STEP_CONFIG["airtable-record"], async () => {
    const parsed = parseAirtableRecord(raw);
    const missing = missingFieldLabels(parsed);
    if (missing.length > 0) throw new MissingFieldsError(missing);
    logDryRun("airtable-record", parsed, parsed, deps);
    return parsed;
  });

  const superFundId = await step.do("super-fund", STEP_CONFIG["super-fund"], async () => {
    const id = lookupSuperFund(record.superFund);
    logDryRun("super-fund", { superFund: record.superFund, superFundId: id }, record, deps);
    return id;
  });

  const genderCode = await step.do("gender", STEP_CONFIG.gender, async () => {
    const code = lookupGender(record.gender);
    logDryRun("gender", { gender: record.gender, genderCode: code }, record, deps);
    return code;
  });

  const match = await step.do("xero-match", STEP_CONFIG["xero-match"], async () => {
    const result = await matchExistingXero(record, deps);
    logDryRun("xero-match", result, record, deps);
    return result;
  });

  const employee = await step.do("xero-employee", STEP_CONFIG["xero-employee"], async () => {
    const result = await createEmployee(record, superFundId, genderCode, config, deps, now, match);
    logDryRun("xero-employee", result.payload, record, deps);
    return result;
  });

  const employeeRead = await step.do("xero-employee-read", STEP_CONFIG["xero-employee-read"], async () => {
    const result = await readEmployee(employee.employeeId, superFundId, deps, match);
    logDryRun("xero-employee-read", result, record, deps);
    return result;
  });

  const payTemplate = await step.do("xero-employee-finalise", STEP_CONFIG["xero-employee-finalise"], async () => {
    const result = await finalisePayTemplate(employee.employeeId, employeeRead.superMembershipId, deps, match);
    logDryRun("xero-employee-finalise", result.template, record, deps);
    return result;
  });

  const contact = await step.do("xero-contact", STEP_CONFIG["xero-contact"], async () => {
    const result = await upsertContact(record, deps, match);
    logDryRun("xero-contact", result.payload, record, deps);
    return result;
  });

  const slack = await step.do("slack", STEP_CONFIG.slack, async () => {
    const result = await postSlack(record, employee.employeeId, contact.contactId, config, deps, match);
    logDryRun("slack", { channel: result.channel, text: result.text }, record, deps);
    return result;
  });

  const email = await step.do("email", STEP_CONFIG.email, async () => {
    const result = await sendEmail(record, config, deps, match);
    logDryRun("email", result.message, record, deps);
    return result;
  });

  return {
    ok: true,
    mode: deps.mode,
    recordId: record.recordId,
    steps: [...PIPELINE_STEPS],
    superFundId,
    genderCode,
    match,
    startDate: {
      zapierExpression: ZAPIER_START_DATE_EXPRESSION,
      timeZone: config.startDateTimeZone,
      resolved: employee.startDate,
    },
    employee: {
      action: employee.action,
      employeeId: employee.employeeId,
      created: employee.created,
      payload: employee.payload,
    },
    contact,
    slack,
    email,
    employeeRead,
    payTemplate,
    flags: activeFlags(genderCode),
  };
}

export async function runInstructorOnboarding(raw: AirtableApiRecord, deps: RunDeps): Promise<WorkflowSuccess> {
  return runOnboardingSteps(raw, deps);
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function blocked(match: XeroMatchResult): boolean {
  return match.disposition !== "create";
}

/**
 * Email first, then name. Dry run does not call Xero (a token refresh would rotate the live secret).
 * An email match skips. A name-only match is held. Neither path creates.
 */
async function matchExistingXero(record: InstructorRecord, deps: RunDeps): Promise<XeroMatchResult> {
  if (deps.mode === "shadow") {
    return { disposition: "create", reason: "dry-run", employeeIds: [], contactIds: [] };
  }
  const employeesByEmail = await deps.ports.employees.findEmployeesByEmail(record.email);
  const contactsByEmail = await deps.ports.contacts.findContactsByEmail(record.email);
  if (employeesByEmail.length > 0 || contactsByEmail.length > 0) {
    const result: XeroMatchResult = {
      disposition: "skip-email",
      reason: "email",
      employeeIds: uniqueIds(employeesByEmail.map((employee) => employee.employeeId)),
      contactIds: uniqueIds(contactsByEmail.map((contact) => contact.contactId)),
    };
    console.log(
      JSON.stringify({
        event: "xero-email-skip",
        recordId: record.recordId,
        employeeIds: result.employeeIds,
        contactIds: result.contactIds,
      }),
    );
    return result;
  }
  const employeesByName = await deps.ports.employees.findEmployeesByName(record.firstName, record.lastName);
  const contactsByName = await deps.ports.contacts.findContactsByName(instructorFullName(record));
  if (employeesByName.length > 0 || contactsByName.length > 0) {
    const result: XeroMatchResult = {
      disposition: "hold-name",
      reason: "name",
      employeeIds: uniqueIds(employeesByName.map((employee) => employee.employeeId)),
      contactIds: uniqueIds(contactsByName.map((contact) => contact.contactId)),
    };
    console.log(
      JSON.stringify({
        event: "xero-name-hold",
        recordId: record.recordId,
        employeeIds: result.employeeIds,
        contactIds: result.contactIds,
      }),
    );
    return result;
  }
  return { disposition: "create", reason: "no-match", employeeIds: [], contactIds: [] };
}

async function createEmployee(
  record: InstructorRecord,
  superFundId: string,
  genderCode: string,
  config: WorkflowConfig,
  deps: RunDeps,
  now: Date,
  match: XeroMatchResult,
): Promise<EmployeeStepResult> {
  const payrollCalendarId = requireCalendarId(config);
  const startDate = resolveStartDate(now, config.startDateTimeZone);
  const payload = buildEmployeePayload({ record, genderCode, superFundId, payrollCalendarId, startDate });
  if (blocked(match)) {
    return {
      action: match.disposition,
      employeeId: match.employeeIds[0] ?? null,
      created: false,
      payload,
      startDate,
    };
  }
  if (deps.mode === "shadow") {
    return { action: "create", employeeId: null, created: false, payload, startDate };
  }
  const instanceId = deps.instanceId?.trim() || record.recordId;
  const result = await deps.ports.employees.createEmployee(payload, employeeIdempotencyKey(instanceId));
  return {
    action: result.created ? "create" : "reuse",
    employeeId: result.employeeId,
    created: result.created,
    payload,
    startDate,
  };
}

function isUnset(value: string | null): boolean {
  return value == null || value === "";
}

function membershipForFund(details: EmployeeDetails, superFundId: string): string {
  const matches = details.superMemberships.filter(
    (membership) => membership.superFundId === superFundId && membership.superMembershipId.length > 0,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Employee GET returned ${matches.length} SuperMembershipID values for the form's super fund.`,
    );
  }
  return matches[0]!.superMembershipId;
}

async function readEmployee(
  employeeId: string | null,
  superFundId: string,
  deps: RunDeps,
  match: XeroMatchResult,
): Promise<EmployeeReadResult> {
  if (deps.mode === "shadow" || blocked(match)) {
    return {
      checked: false,
      employeeId: null,
      superMembershipId: null,
      gender: null,
      incomeType: null,
      genderUnset: false,
      incomeTypeUnset: false,
    };
  }
  if (!employeeId) {
    throw new Error("xero-employee-read needs the employee id from the create step.");
  }
  const details = await deps.ports.employees.getEmployee(employeeId);
  return {
    checked: true,
    employeeId,
    superMembershipId: membershipForFund(details, superFundId),
    gender: details.gender,
    incomeType: details.incomeType,
    genderUnset: isUnset(details.gender),
    incomeTypeUnset: isUnset(details.incomeType),
  };
}

async function finalisePayTemplate(
  employeeId: string | null,
  superMembershipId: string | null,
  deps: RunDeps,
  match: XeroMatchResult,
): Promise<PayTemplateResult> {
  if (deps.mode === "shadow" || blocked(match)) {
    return { updated: false, template: buildPayTemplate(null) };
  }
  if (!employeeId || !superMembershipId) {
    throw new Error("xero-employee-finalise needs an employee id and the form fund's SuperMembershipID.");
  }
  const template = buildPayTemplate(superMembershipId);
  await deps.ports.employees.updatePayTemplate(employeeId, template);
  return { updated: true, template };
}

async function upsertContact(record: InstructorRecord, deps: RunDeps, match: XeroMatchResult): Promise<ContactStepResult> {
  const payload = buildContactPayload(record);
  if (blocked(match)) {
    return {
      action: match.disposition,
      contactId: match.contactIds[0] ?? null,
      created: false,
      payload,
    };
  }
  if (deps.mode === "shadow") {
    return { action: "create", contactId: null, created: false, payload };
  }
  const result = await deps.ports.contacts.upsertContact(payload);
  return {
    action: result.created ? "create" : "update",
    contactId: result.contactId,
    created: result.created,
    payload,
  };
}

function emptyEmail(record: InstructorRecord, config: WorkflowConfig): EmailStepResult {
  return {
    sent: false,
    message: {
      from: config.emailFrom,
      fromName: config.emailFromName,
      to: record.email,
      cc: [],
      bcc: [],
      subject: "",
      html: "",
    },
  };
}

async function postSlack(
  record: InstructorRecord,
  employeeId: string | null,
  contactId: string | null,
  config: WorkflowConfig,
  deps: RunDeps,
  match: XeroMatchResult,
): Promise<SlackStepResult> {
  if (match.disposition === "hold-name") {
    const held = buildXeroHoldMessage({
      recordId: record.recordId,
      firstName: record.firstName,
      lastName: record.lastName,
      employeeIds: match.employeeIds,
      contactIds: match.contactIds,
      channel: config.slackChannelId,
    });
    if (deps.mode === "shadow") {
      return { channel: held.channel, text: maskText(held.text, payrollReplacements(record)), sent: false };
    }
    await deps.ports.slack.postMessage(held);
    return { ...held, sent: true };
  }
  if (match.disposition === "skip-email") {
    return { channel: config.slackChannelId, text: "", sent: false };
  }
  const facts = await setupFacts(record, employeeId, contactId, config, deps);
  const message = buildSlackMessage({
    name: instructorFullName(record),
    employeeId: employeeId ?? "{EmployeeID}",
    contactId: contactId ?? "{ContactID}",
    recordId: record.recordId,
    orgShortCode: config.orgShortCode,
    channel: config.slackChannelId,
    checks: setupCheckLines(facts),
  });
  const missing = setupCheckLines(facts)
    .filter((check) => !check.ok)
    .map((check) => check.label);
  console.log(JSON.stringify({ event: "xero-setup-check", recordId: record.recordId, missing }));
  if (deps.mode === "shadow") {
    return { channel: message.channel, text: maskText(message.text, payrollReplacements(record)), sent: false };
  }
  await deps.ports.slack.postMessage(message);
  return { ...message, sent: true };
}

async function setupFacts(
  record: InstructorRecord,
  employeeId: string | null,
  contactId: string | null,
  config: WorkflowConfig,
  deps: RunDeps,
): Promise<SetupFacts> {
  const expectedSuperFundId = lookupSuperFund(record.superFund);
  const payload = buildEmployeePayload({
    record,
    genderCode: lookupGender(record.gender),
    superFundId: expectedSuperFundId,
    payrollCalendarId: config.payrollCalendarId ?? "",
    startDate: "",
  });
  const contactPayload = buildContactPayload(record);
  const intended: SetupFacts = {
    superFundId: expectedSuperFundId,
    expectedSuperFundId,
    contributionType: "SGC",
    calculationType: "FIXEDAMOUNT",
    expenseAccountCode: "478",
    liabilityAccountCode: "826",
    fixedAmountBlank: true,
    memberNumberPresent: record.memberNumber.trim().length > 0,
    abnPresent: record.abn.trim().length > 0,
    employmentType: payload.EmploymentType,
    incomeType: payload.IncomeType,
    genderPresent: payload.Gender.trim().length > 0,
    weeklyCalendar: Boolean(config.payrollCalendarId?.trim()),
    residencyStatus: payload.TaxDeclaration.ResidencyStatus,
    tfnPresent: record.tfn.trim().length > 0,
    mobile: contactPayload.Phones[0].PhoneNumber,
    purchaseAccountCode: null,
    bankDetailsPresent: contactPayload.BankAccountDetails.trim().length > 0,
    gstOnExpenses: contactPayload.AccountsPayableTaxType === "INPUT",
  };
  if (deps.mode === "shadow" || !employeeId || !contactId) return intended;
  const details = await deps.ports.employees.getEmployee(employeeId);
  const calendars = await deps.ports.employees.listPayrollCalendars();
  const calendar = calendars.find((item) => item.payrollCalendarId === details.payrollCalendarId);
  const membership = details.superMemberships.find((item) => item.superFundId === expectedSuperFundId);
  const contact = await deps.ports.contacts.getContact(contactId);
  return {
    superFundId: membership?.superFundId ?? null,
    expectedSuperFundId,
    contributionType: details.superLine?.contributionType ?? null,
    calculationType: details.superLine?.calculationType ?? null,
    expenseAccountCode: details.superLine?.expenseAccountCode ?? null,
    liabilityAccountCode: details.superLine?.liabilityAccountCode ?? null,
    fixedAmountBlank: details.superLine?.amountBlank ?? true,
    memberNumberPresent: Boolean(membership && membership.employeeNumber.trim().length > 0),
    abnPresent: details.abnPresent,
    employmentType: details.employmentType,
    incomeType: details.incomeType,
    genderPresent: Boolean(details.gender && details.gender.trim().length > 0),
    weeklyCalendar: calendar?.calendarType === "WEEKLY",
    residencyStatus: details.residencyStatus,
    tfnPresent: details.tfnPresent,
    mobile: contact.mobile,
    purchaseAccountCode: contact.purchasesDefaultAccountCode,
    bankDetailsPresent: contact.bankDetailsPresent,
    gstOnExpenses: contact.accountsPayableTaxType === "INPUT",
  };
}

async function sendEmail(
  record: InstructorRecord,
  config: WorkflowConfig,
  deps: RunDeps,
  match: XeroMatchResult,
): Promise<EmailStepResult> {
  if (blocked(match)) return emptyEmail(record, config);
  const message = buildInstructorEmail(record, config);
  if (deps.mode === "shadow") {
    return {
      sent: false,
      message: { ...message, html: maskText(message.html, payrollReplacements(record)) },
    };
  }
  await deps.ports.email.send(message);
  return { sent: true, message };
}

function logDryRun(step: string, wouldSend: unknown, record: InstructorRecord, deps: RunDeps): void {
  if (deps.mode !== "shadow") return;
  const replacements = payrollReplacements(record);
  console.log(
    JSON.stringify({
      event: "dry-run-would-send",
      step,
      present: payrollFieldPresence(record),
      wouldSend: maskSecretsDeep(wouldSend, replacements),
    }),
  );
}

function activeFlags(genderCode: string): string[] {
  return ODDITIES.map((oddity) => oddity.id).filter((id) => {
    if (id === "gender-not-stated-empty") return genderCode === "";
    return true;
  });
}
