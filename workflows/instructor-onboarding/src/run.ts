import { missingFieldLabels, parseAirtableRecord } from "./airtable/parse-record.ts";
import { resolveStartDate } from "./clock.ts";
import { ZAPIER_START_DATE_EXPRESSION, defaultConfig, type WorkflowConfig } from "./config.ts";
import { MissingFieldsError, PayrollCalendarError } from "./errors.ts";
import { STEP_CONFIG, type StepDo } from "./host/step-config.ts";
import { lookupGender } from "./lookups/gender.ts";
import { lookupSuperFund } from "./lookups/super-funds.ts";
import { buildContactPayload } from "./mappings/contact.ts";
import { buildEmployeePayload, employeeIdempotencyKey } from "./mappings/employee.ts";
import { buildInstructorEmail } from "./messages/email.ts";
import { buildSlackMessage } from "./messages/slack.ts";
import { ODDITIES } from "./oddities.ts";
import type { Ports, XeroEmployeePort } from "./ports.ts";
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
}

interface EmployeeStepResult {
  action: "create" | "reuse";
  employeeId: string | null;
  created: boolean;
  payload: XeroEmployeePayload;
  startDate: string;
}

interface ContactStepResult {
  action: "create" | "update";
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
    return parsed;
  });

  const superFundId = await step.do("super-fund", STEP_CONFIG["super-fund"], async () => lookupSuperFund(record.superFund));

  const genderCode = await step.do("gender", STEP_CONFIG.gender, async () => lookupGender(record.gender));

  const employee = await step.do("xero-employee", STEP_CONFIG["xero-employee"], async () =>
    createEmployee(record, superFundId, genderCode, config, deps, now),
  );

  const contact = await step.do("xero-contact", STEP_CONFIG["xero-contact"], async () => upsertContact(record, deps));

  const slack = await step.do("slack", STEP_CONFIG.slack, async () =>
    postSlack(record, employee.employeeId, contact.contactId, config, deps),
  );

  const email = await step.do("email", STEP_CONFIG.email, async () => sendEmail(record, config, deps));

  return {
    ok: true,
    mode: deps.mode,
    recordId: record.recordId,
    steps: [
      "airtable-record",
      "super-fund",
      "gender",
      "xero-employee",
      "xero-contact",
      "slack",
      "email",
    ],
    superFundId,
    genderCode,
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
    flags: activeFlags(genderCode),
  };
}

export async function runInstructorOnboarding(raw: AirtableApiRecord, deps: RunDeps): Promise<WorkflowSuccess> {
  return runOnboardingSteps(raw, deps);
}

async function createEmployee(
  record: InstructorRecord,
  superFundId: string,
  genderCode: string,
  config: WorkflowConfig,
  deps: RunDeps,
  now: Date,
): Promise<EmployeeStepResult> {
  const payrollCalendarId = requireCalendarId(config);
  const startDate = resolveStartDate(now, config.startDateTimeZone);
  const payload = buildEmployeePayload({ record, genderCode, superFundId, payrollCalendarId, startDate });
  if (deps.mode === "shadow") {
    return { action: "create", employeeId: null, created: false, payload, startDate };
  }
  const result = await deps.ports.employees.createEmployee(payload, employeeIdempotencyKey(record.recordId));
  return {
    action: result.created ? "create" : "reuse",
    employeeId: result.employeeId,
    created: result.created,
    payload,
    startDate,
  };
}

async function upsertContact(record: InstructorRecord, deps: RunDeps): Promise<ContactStepResult> {
  const payload = buildContactPayload(record);
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

async function postSlack(
  record: InstructorRecord,
  employeeId: string | null,
  contactId: string | null,
  config: WorkflowConfig,
  deps: RunDeps,
): Promise<SlackStepResult> {
  const message = buildSlackMessage({
    record,
    employeeId: employeeId ?? "{EmployeeID}",
    contactId: contactId ?? "{ContactID}",
    config,
  });
  if (deps.mode === "shadow") return { ...message, sent: false };
  await deps.ports.slack.postMessage(message);
  return { ...message, sent: true };
}

async function sendEmail(record: InstructorRecord, config: WorkflowConfig, deps: RunDeps): Promise<EmailStepResult> {
  const message = buildInstructorEmail(record, config);
  if (deps.mode === "shadow") return { sent: false, message };
  await deps.ports.email.send(message);
  return { sent: true, message };
}

function activeFlags(genderCode: string): string[] {
  return ODDITIES.map((oddity) => oddity.id).filter((id) => {
    if (id === "gender-not-stated-empty") return genderCode === "";
    return true;
  });
}
