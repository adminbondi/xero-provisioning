import { missingFieldLabels, parseAirtableRecord } from "./airtable/parse-record.ts";
import { resolveStartDate } from "./clock.ts";
import { ZAPIER_START_DATE_EXPRESSION, defaultConfig, type WorkflowConfig } from "./config.ts";
import { passthroughCustomCode, type CustomCodeStep } from "./custom-code.ts";
import {
  AmbiguousContactError,
  AmbiguousEmployeeError,
  CustomCodeError,
  MissingFieldsError,
  PayrollCalendarError,
  WorkflowError,
} from "./errors.ts";
import { blankRun, type IdempotencyRecord, type WorkflowStore } from "./idempotency.ts";
import { lookupGender } from "./lookups/gender.ts";
import { lookupSuperFund } from "./lookups/super-funds.ts";
import { buildContactPayload } from "./mappings/contact.ts";
import { buildEmployeePayload, employeeIdempotencyKey } from "./mappings/employee.ts";
import { buildInstructorEmail } from "./messages/email.ts";
import { buildSlackMessage } from "./messages/slack.ts";
import { ODDITIES } from "./oddities.ts";
import type { Ports, XeroEmployeePort } from "./ports.ts";
import type { AirtableApiRecord, InstructorRecord, RunMode, WorkflowSuccess } from "./types.ts";

export const PIPELINE_STEPS = [
  "airtable-record",
  "super-fund",
  "gender",
  "custom-code",
  "xero-employee",
  "xero-contact",
  "slack",
  "email",
] as const;

export type PipelineStepName = (typeof PIPELINE_STEPS)[number];

export interface Step {
  name: string;
  run(ctx: RunContext): Promise<void>;
}

export interface RunDeps {
  ports: Ports;
  store: WorkflowStore;
  mode: RunMode;
  now?: () => Date;
  customCode?: CustomCodeStep;
  steps?: Step[];
  config?: WorkflowConfig;
}

export interface RunContext {
  raw: AirtableApiRecord;
  deps: RunDeps;
  config: WorkflowConfig;
  record?: InstructorRecord;
  superFundId?: string;
  genderCode?: string;
  startDate?: string;
  startDateOverridden: boolean;
  customCodeApplied: boolean;
  prior: IdempotencyRecord;
  employee?: WorkflowSuccess["employee"];
  contact?: WorkflowSuccess["contact"];
  slack?: WorkflowSuccess["slack"];
  email?: WorkflowSuccess["email"];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENDER_CODES = new Set(["M", "F", "I", ""]);

export async function resolveWeeklyPayrollCalendar(employees: XeroEmployeePort): Promise<string> {
  const calendars = await employees.listPayrollCalendars();
  const weekly = calendars.filter((calendar) => calendar.calendarType === "WEEKLY");
  if (weekly.length === 0) {
    throw new PayrollCalendarError("No Xero payroll calendar with CalendarType WEEKLY.");
  }
  if (weekly.length > 1) {
    const names = weekly.map((calendar) => calendar.name).join(", ");
    throw new PayrollCalendarError(
      `Multiple WEEKLY payroll calendars (${names}). The Zap says Weekly and does not give an id.`,
    );
  }
  return weekly[0]!.payrollCalendarId;
}

async function stepRecord(ctx: RunContext): Promise<void> {
  const record = parseAirtableRecord(ctx.raw);
  const missing = missingFieldLabels(record);
  if (missing.length > 0) {
    throw new MissingFieldsError(missing);
  }
  ctx.record = record;
  ctx.prior = (await ctx.deps.store.getRun(record.recordId)) ?? blankRun(record.recordId);
}

async function stepSuperFund(ctx: RunContext): Promise<void> {
  ctx.superFundId = lookupSuperFund(requireRecord(ctx).superFund);
}

async function stepGender(ctx: RunContext): Promise<void> {
  ctx.genderCode = lookupGender(requireRecord(ctx).gender);
}

async function stepCustomCode(ctx: RunContext, customCode: CustomCodeStep): Promise<void> {
  const now = ctx.deps.now?.() ?? new Date();
  const resolved = resolveStartDate(now, ctx.config.startDateTimeZone);
  ctx.startDate = resolved;
  ctx.customCodeApplied = customCode !== passthroughCustomCode;
  let next;
  try {
    next = await customCode({
      record: requireRecord(ctx),
      superFundId: requireString(ctx.superFundId, "super-fund"),
      genderCode: requireString(ctx.genderCode, "gender"),
      startDate: resolved,
    });
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    throw new CustomCodeError(error instanceof Error ? error.message : String(error), error);
  }
  ctx.record = next.record;
  ctx.superFundId = next.superFundId;
  ctx.genderCode = next.genderCode;
  ctx.startDate = next.startDate;
  ctx.startDateOverridden = next.startDate !== resolved;
  const missing = missingFieldLabels(next.record);
  if (missing.length > 0) {
    throw new MissingFieldsError(missing);
  }
  if (!GENDER_CODES.has(next.genderCode)) {
    throw new CustomCodeError(`genderCode must be M, F, I, or empty. Received ${JSON.stringify(next.genderCode)}.`);
  }
  if (!UUID_PATTERN.test(next.superFundId)) {
    throw new CustomCodeError("superFundId must be a UUID.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next.startDate)) {
    throw new CustomCodeError("startDate must be YYYY-MM-DD.");
  }
}

async function stepEmployee(ctx: RunContext): Promise<void> {
  const record = requireRecord(ctx);
  const payrollCalendarId = await resolveWeeklyPayrollCalendar(ctx.deps.ports.employees);
  const payload = buildEmployeePayload({
    record,
    genderCode: requireString(ctx.genderCode, "gender"),
    superFundId: requireString(ctx.superFundId, "super-fund"),
    payrollCalendarId,
    startDate: requireString(ctx.startDate, "xero-employee"),
  });
  let employeeId = ctx.prior.employeeId ?? null;
  let action: "create" | "reuse" = employeeId ? "reuse" : "create";
  if (!employeeId) {
    const matches = await ctx.deps.ports.employees.findEmployeesByEmail(record.email);
    if (matches.length > 1) {
      throw new AmbiguousEmployeeError(record.email, matches.length);
    }
    if (matches.length === 1) {
      employeeId = matches[0]!.employeeId;
      action = "reuse";
    }
  }
  let created = false;
  if (ctx.deps.mode === "live" && action === "create") {
    const result = await ctx.deps.ports.employees.createEmployee(payload, employeeIdempotencyKey(record.recordId));
    employeeId = result.employeeId;
    created = result.created;
    if (!created) action = "reuse";
  }
  if (ctx.deps.mode === "live" && employeeId) {
    ctx.prior.employeeId = employeeId;
    await ctx.deps.store.saveRun(ctx.prior);
  }
  ctx.employee = { action, employeeId, created, payload };
}

async function stepContact(ctx: RunContext): Promise<void> {
  const record = requireRecord(ctx);
  const payload = buildContactPayload(record);
  let contactId = ctx.prior.contactId ?? null;
  let action: "create" | "update" = contactId ? "update" : "create";
  if (!contactId) {
    const byNumber = await ctx.deps.ports.contacts.findContactByNumber(payload.ContactNumber);
    if (byNumber) {
      contactId = byNumber.contactId;
      action = "update";
    } else {
      const byName = await ctx.deps.ports.contacts.findContactsByName(payload.Name);
      if (byName.length > 1) {
        throw new AmbiguousContactError(payload.Name, byName.length);
      }
      if (byName.length === 1) {
        contactId = byName[0]!.contactId;
        action = "update";
      }
    }
  }
  let created = false;
  if (ctx.deps.mode === "live") {
    const result = await ctx.deps.ports.contacts.upsertContact(payload, contactId ?? undefined);
    contactId = result.contactId;
    created = result.created;
    action = created ? "create" : "update";
    ctx.prior.contactId = contactId;
    await ctx.deps.store.saveRun(ctx.prior);
  }
  ctx.contact = { action, contactId, created, payload };
}

async function stepSlack(ctx: RunContext): Promise<void> {
  const record = requireRecord(ctx);
  const message = buildSlackMessage({
    record,
    employeeId: ctx.employee?.employeeId ?? "{EmployeeID}",
    contactId: ctx.contact?.contactId ?? "{ContactID}",
    config: ctx.config,
  });
  let sent = false;
  if (ctx.deps.mode === "live" && !ctx.prior.slackSent) {
    await ctx.deps.ports.slack.postMessage(message);
    ctx.prior.slackSent = true;
    await ctx.deps.store.saveRun(ctx.prior);
    sent = true;
  }
  ctx.slack = { ...message, sent };
}

async function stepEmail(ctx: RunContext): Promise<void> {
  const message = buildInstructorEmail(requireRecord(ctx), ctx.config);
  let sent = false;
  if (ctx.deps.mode === "live" && !ctx.prior.emailSent) {
    await ctx.deps.ports.email.send(message);
    ctx.prior.emailSent = true;
    await ctx.deps.store.saveRun(ctx.prior);
    sent = true;
  }
  ctx.email = { sent, message };
}

export function createDefaultSteps(customCode: CustomCodeStep = passthroughCustomCode): Step[] {
  return [
    { name: "airtable-record", run: stepRecord },
    { name: "super-fund", run: stepSuperFund },
    { name: "gender", run: stepGender },
    { name: "custom-code", run: (ctx) => stepCustomCode(ctx, customCode) },
    { name: "xero-employee", run: stepEmployee },
    { name: "xero-contact", run: stepContact },
    { name: "slack", run: stepSlack },
    { name: "email", run: stepEmail },
  ];
}

function requireRecord(ctx: RunContext): InstructorRecord {
  if (!ctx.record) {
    throw new WorkflowError("airtable-record", "Instructor record was not parsed.");
  }
  return ctx.record;
}

function requireString(value: string | undefined, step: string): string {
  if (value === undefined) {
    throw new WorkflowError(step, "Expected this step to have run already.");
  }
  return value;
}

function activeFlags(ctx: RunContext): string[] {
  const flags = ODDITIES.map((oddity) => oddity.id).filter((id) => {
    if (id === "gender-not-stated-empty") return ctx.genderCode === "";
    if (id === "possible-missing-code-step") return !ctx.customCodeApplied;
    return true;
  });
  return flags;
}

function toResult(ctx: RunContext, steps: string[]): WorkflowSuccess {
  if (!ctx.record || !ctx.employee || !ctx.contact || !ctx.slack || !ctx.email || ctx.superFundId === undefined || ctx.genderCode === undefined || !ctx.startDate) {
    throw new WorkflowError("airtable-record", "Pipeline finished before every step had produced a result.");
  }
  return {
    ok: true,
    mode: ctx.deps.mode,
    recordId: ctx.record.recordId,
    steps,
    superFundId: ctx.superFundId,
    genderCode: ctx.genderCode,
    startDate: {
      zapierExpression: ZAPIER_START_DATE_EXPRESSION,
      timeZone: ctx.config.startDateTimeZone,
      resolved: ctx.startDate,
      overriddenByCustomCode: ctx.startDateOverridden,
    },
    customCodeApplied: ctx.customCodeApplied,
    employee: ctx.employee,
    contact: ctx.contact,
    slack: ctx.slack,
    email: ctx.email,
    flags: activeFlags(ctx),
  };
}

export async function runInstructorOnboarding(raw: AirtableApiRecord, deps: RunDeps): Promise<WorkflowSuccess> {
  const customCode = deps.customCode ?? passthroughCustomCode;
  const steps = deps.steps ?? createDefaultSteps(customCode);
  const ctx: RunContext = {
    raw,
    deps,
    config: deps.config ?? defaultConfig(),
    startDateOverridden: false,
    customCodeApplied: false,
    prior: blankRun(typeof raw.id === "string" ? raw.id : ""),
  };
  for (const step of steps) {
    try {
      await step.run(ctx);
    } catch (error) {
      if (error instanceof WorkflowError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new WorkflowError(step.name, message, { cause: error });
    }
  }
  return toResult(ctx, steps.map((step) => step.name));
}
